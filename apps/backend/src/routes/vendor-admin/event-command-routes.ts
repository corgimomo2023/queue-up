import { Router } from 'express';
import {
  ApiErrorCode,
  QueueLifecycleStatus,
  QueueStartMode,
  RealtimeEvent,
} from '../../domain/constants';
import { body, validateBody } from '../../http';
import { hongKongEndDateToUtc, hongKongLocalToUtc, queueLifecycle } from '../../queue-period';
import {
  archiveEventSchema,
  createQueueSchema,
  editEventSchema,
  type ArchiveEventDto,
  type CreateQueueDto,
  type EditEventDto,
} from '../../schemas';
import { safeSlug, slowHash } from '../../security';
import type { AccessGuards } from '../../access-guards';
import type { AppRuntime } from '../../runtime';

export function vendorAdminEventCommandRoutes(runtime: AppRuntime, guards: AccessGuards) {
  const router = Router();

  router.post(
    '/api/queues',
    guards.vendorAdmin,
    validateBody(createQueueSchema),
    async (req, res) => {
      const dto = body<CreateQueueDto>(res);
      let startAt: string;
      if (dto.startMode === QueueStartMode.Scheduled) {
        if (!dto.startLocal) throw new Error('Scheduled events require a start time');
        startAt = hongKongLocalToUtc(dto.startLocal);
      } else {
        startAt = runtime.now().toISOString();
      }
      const endAt = dto.endDate ? hongKongEndDateToUtc(dto.endDate) : null;
      queueLifecycle({ startAt, endAt }, runtime.now());
      let slug = safeSlug(dto.businessName);
      while (await runtime.getQueue(slug)) slug = safeSlug(dto.businessName);
      const queue = await runtime.services.events.create(
        {
          slug,
          name: dto.businessName,
          passwordHash: slowHash(dto.password, false),
          startAt,
          endAt,
          description: dto.description?.trim() || null,
        },
        runtime.auditFields(req),
      );
      res.status(201).json({
        queueId: slug,
        name: dto.businessName,
        vendorUrl: `/vendor/${slug}`,
        customerUrl: `/q/${slug}`,
        ...runtime.brandingFor(queue),
        ...runtime.periodFor(queue),
      });
    },
  );

  router.patch(
    '/api/super-admin/queues/:queueId',
    guards.vendorAdmin,
    validateBody(editEventSchema),
    async (req, res) => {
      const queue = await runtime.getQueue(req.params.queueId as string);
      if (!queue) {
        res.status(404).json({ error: 'Event not found' });
        return;
      }
      if (queue.removed_at) {
        res
          .status(409)
          .json({ error: 'Archived events cannot be edited', code: ApiErrorCode.EventArchived });
        return;
      }
      const dto = body<EditEventDto>(res);
      const nextName = dto.name ?? queue.name;
      const nextDescription =
        dto.description !== undefined ? dto.description?.trim() || null : queue.description;
      const nextStart = dto.startLocal ? hongKongLocalToUtc(dto.startLocal) : queue.start_at;
      const nextEnd =
        dto.endDate !== undefined
          ? dto.endDate
            ? hongKongEndDateToUtc(dto.endDate)
            : null
          : queue.end_at;
      const currentLifecycle = queueLifecycle(
        { startAt: queue.start_at, endAt: queue.end_at },
        runtime.now(),
      );
      const nextLifecycle = queueLifecycle({ startAt: nextStart, endAt: nextEnd }, runtime.now());
      if (
        currentLifecycle === QueueLifecycleStatus.Active &&
        nextLifecycle === QueueLifecycleStatus.Scheduled
      ) {
        res.status(409).json({
          error: 'An active event cannot be moved back to scheduled',
          code: ApiErrorCode.EventActiveCannotBeRescheduled,
        });
        return;
      }
      const updateResult = await runtime.services.events.update({
        queue,
        values: {
          name: nextName,
          description: nextDescription,
          startAt: nextStart,
          endAt: nextEnd,
          passwordHash: dto.password ? slowHash(dto.password, false) : null,
        },
        finalizeEndedAt:
          nextLifecycle === QueueLifecycleStatus.Ended ? runtime.now().toISOString() : undefined,
        audit: runtime.auditFields(req),
      });
      const updated = updateResult.queue;
      if (nextLifecycle === QueueLifecycleStatus.Ended) {
        if (updateResult.finalizedWaiting) await runtime.emit(updated.slug);
        runtime.closeQueueClients(updated.slug, RealtimeEvent.QueueEnded, {
          code: ApiErrorCode.QueueEnded,
        });
      }
      res.json({
        queueId: updated.slug,
        name: updated.name,
        vendorUrl: `/vendor/${updated.slug}`,
        customerUrl: `/q/${updated.slug}`,
        ...runtime.brandingFor(updated),
        ...runtime.periodFor(updated),
      });
    },
  );

  router.delete(
    '/api/super-admin/queues/:queueId',
    guards.vendorAdmin,
    validateBody(archiveEventSchema),
    async (req, res) => {
      const queue = await runtime.getQueue(req.params.queueId as string);
      if (!queue) {
        res.status(404).json({ error: 'Queue not found' });
        return;
      }
      if (queue.removed_at) {
        res
          .status(409)
          .json({ error: 'Event is already archived', code: ApiErrorCode.EventAlreadyArchived });
        return;
      }
      if (body<ArchiveEventDto>(res).confirmationName !== queue.name) {
        res.status(400).json({ error: 'Event name does not match' });
        return;
      }
      const removedAt = runtime.now().toISOString();
      const removedWaiting = await runtime.services.events.archive(
        queue.id,
        removedAt,
        runtime.auditFields(req),
      );
      runtime.closeQueueClients(queue.slug, RealtimeEvent.QueueArchived, {
        code: ApiErrorCode.EventArchived,
      });
      res.json({ ok: true, removedAt, removedWaiting });
    },
  );

  router.post('/api/super-admin/queues/:queueId/restore', guards.vendorAdmin, async (req, res) => {
    if (!req.is('application/json')) {
      res
        .status(415)
        .json({ error: 'JSON content type required', code: ApiErrorCode.JsonRequired });
      return;
    }
    const queue = await runtime.getQueue(req.params.queueId as string);
    if (!queue) {
      res.status(404).json({ error: 'Queue not found' });
      return;
    }
    if (!queue.removed_at) {
      res.status(409).json({ error: 'Event is not archived', code: ApiErrorCode.EventNotArchived });
      return;
    }
    const restored = await runtime.services.events.restore(queue, runtime.auditFields(req));
    res.json({ ok: true, ...runtime.periodFor(restored) });
  });

  return router;
}
