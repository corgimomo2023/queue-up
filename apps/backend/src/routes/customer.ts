import { Router } from 'express';
import {
  CustomerEndReason,
  CustomerStatus,
  QueueLifecycleStatus,
  RealtimeEvent,
} from '../domain/constants';
import { actor, body, validateBody } from '../http';
import { joinSchema, type JoinDto } from '../schemas';
import { randomToken, tokenHash } from '../security';
import type { AccessGuards } from '../access-guards';
import type { AppRuntime } from '../runtime';
import type { Actor } from '../types';

export function customerRoutes(runtime: AppRuntime, guards: AccessGuards) {
  const router = Router();

  router.get('/api/queues/:queueId', guards.queue, async (req, res) => {
    const queue = res.locals.queue;
    const period = runtime.periodFor(queue);
    if (period.lifecycleStatus === QueueLifecycleStatus.Ended) {
      await runtime.finalizeWaiting(queue, req, CustomerEndReason.QueuePeriodEnded);
    }
    const waitingCount = await runtime.repositories.customers.waitingCount(queue.id);
    res.json({
      queueId: queue.slug,
      name: queue.name,
      waitingCount,
      ...runtime.brandingFor(queue),
      ...period,
    });
  });

  router.post(
    '/api/queues/:queueId/join',
    guards.queue,
    guards.activeQueue,
    validateBody(joinSchema),
    async (req, res) => {
      const queue = res.locals.queue;
      const dto = body<JoinDto>(res);
      const leaveToken = randomToken();
      const customer = await runtime.services.customers.joinQueue({
        queueId: queue.id,
        name: dto.name,
        phone: dto.phone || null,
        message: dto.message || null,
        tokenHash: tokenHash(leaveToken),
        audit: runtime.auditFields(req),
      });
      await runtime.emit(queue.slug);
      res.status(201).json({ ...(await runtime.statusFor(customer)), leaveToken });
    },
  );

  router.get(
    '/api/queues/:queueId/status',
    ...guards.customer('query', 404, 'Ticket not found'),
    async (_req, res) => {
      const { queue, customer } = actor<Extract<Actor, { customer: unknown }>>(res);
      res.json({ ...(await runtime.statusFor(customer)), queueStatus: runtime.periodFor(queue) });
    },
  );

  router.delete(
    '/api/queues/:queueId/customers/me',
    ...guards.customer('bearer', 401, 'Invalid leave token'),
    async (req, res) => {
      const { queue, customer } = actor<Extract<Actor, { customer: unknown }>>(res);
      await runtime.services.customers.leaveQueue(
        queue.id,
        customer.id,
        runtime.now().toISOString(),
        runtime.auditFields(req),
      );
      await runtime.emit(queue.slug);
      res.json({ ok: true });
    },
  );

  router.get(
    '/api/queues/:queueId/events',
    ...guards.customer('query', 401, 'Valid ticket required'),
    async (req, res) => {
      const { queue, customer } = actor<Extract<Actor, { customer: unknown }>>(res);
      if (customer.status === CustomerStatus.Served) {
        res.status(204).end();
        return;
      }
      res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      res.flushHeaders();
      res.write(
        `event: ${RealtimeEvent.Status}\ndata: ${JSON.stringify({ ...(await runtime.statusFor(customer)), queueStatus: runtime.periodFor(queue) })}\n\n`,
      );
      runtime.addClient(queue, customer, req, res);
    },
  );

  return router;
}
