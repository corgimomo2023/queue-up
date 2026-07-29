import { Router, type RequestHandler } from 'express';
import { ActorType, ApiErrorCode, AuditAction } from '../../domain/constants';
import { parseEventLogo, removeEventLogo, storeEventLogo } from '../../event-assets';
import type { AccessGuards } from '../../access-guards';
import type { AppRuntime } from '../../runtime';
import type { QueueRow } from '../../types';

export function vendorAdminBrandingRoutes(runtime: AppRuntime, guards: AccessGuards) {
  const router = Router();
  const requireEditableEvent: RequestHandler = async (req, res, next) => {
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
    res.locals.editableQueue = queue;
    next();
  };

  router.put(
    '/api/super-admin/queues/:queueId/logo',
    guards.vendorAdmin,
    requireEditableEvent,
    parseEventLogo,
    async (req, res) => {
      const queue = res.locals.editableQueue as QueueRow;
      const filename = await storeEventLogo(runtime, queue, req.body, req.get('content-type'));
      await runtime.writeAudit(
        req,
        ActorType.VendorAdmin,
        AuditAction.EventLogoUploaded,
        queue.id,
        undefined,
        { mediaType: req.get('content-type')?.split(';', 1)[0], filename },
      );
      res.json({ logoUrl: `/event-assets/${filename}` });
    },
  );

  router.delete(
    '/api/super-admin/queues/:queueId/logo',
    guards.vendorAdmin,
    requireEditableEvent,
    async (req, res) => {
      const queue = res.locals.editableQueue as QueueRow;
      if (removeEventLogo(runtime, queue)) {
        await runtime.writeAudit(
          req,
          ActorType.VendorAdmin,
          AuditAction.EventLogoRemoved,
          queue.id,
        );
      }
      res.json({ logoUrl: null });
    },
  );

  return router;
}
