import { Router } from 'express';
import { actor, body, validateBody } from '../http.js';
import { joinSchema, type JoinDto } from '../schemas.js';
import { randomToken, tokenHash } from '../security.js';
import type { AccessGuards } from '../access-guards.js';
import type { AppRuntime } from '../runtime.js';
import type { Actor, CustomerRow } from '../types.js';

export function customerRoutes(runtime: AppRuntime, guards: AccessGuards) {
  const router = Router();

  router.get('/api/queues/:queueId', guards.queue, (req, res) => {
    const queue = res.locals.queue;
    const period = runtime.periodFor(queue);
    if (period.lifecycleStatus === 'ended') runtime.finalizeWaiting(queue, req, 'queue_period_ended');
    const waitingCount = (runtime.db.prepare("SELECT count(*) count FROM customers WHERE queue_id=? AND status='waiting'").get(queue.id) as { count: number }).count;
    res.json({ queueId: queue.slug, name: queue.name, waitingCount, ...runtime.brandingFor(queue), ...period });
  });

  router.post('/api/queues/:queueId/join', guards.queue, guards.activeQueue, validateBody(joinSchema), (req, res) => {
    const queue = res.locals.queue;
    const dto = body<JoinDto>(res);
    const leaveToken = randomToken();
    const info = runtime.db.prepare('INSERT INTO customers(queue_id,name,phone,message,token_hash) VALUES(?,?,?,?,?)')
      .run(queue.id, dto.name, dto.phone || null, dto.message || null, tokenHash(leaveToken));
    const customer = runtime.db.prepare('SELECT * FROM customers WHERE id=?').get(info.lastInsertRowid) as CustomerRow;
    runtime.writeAudit(req, 'customer', 'CUSTOMER_JOINED', queue.id, customer.id, { name: customer.name });
    runtime.emit(queue.slug);
    res.status(201).json({ ...runtime.statusFor(customer), leaveToken });
  });

  router.get('/api/queues/:queueId/status', ...guards.customer('query', 404, 'Ticket not found'), (_req, res) => {
    const { queue, customer } = actor<Extract<Actor, { type: 'customer' }>>(res);
    res.json({ ...runtime.statusFor(customer), queueStatus: runtime.periodFor(queue) });
  });

  router.delete('/api/queues/:queueId/customers/me', ...guards.customer('bearer', 401, 'Invalid leave token'), (req, res) => {
    const { queue, customer } = actor<Extract<Actor, { type: 'customer' }>>(res);
    runtime.db.prepare("UPDATE customers SET status='left',ended_at=CURRENT_TIMESTAMP,ended_reason='customer_left' WHERE id=? AND status='waiting'").run(customer.id);
    runtime.writeAudit(req, 'customer', 'CUSTOMER_LEFT', queue.id, customer.id);
    runtime.emit(queue.slug);
    res.json({ ok: true });
  });

  router.get('/api/queues/:queueId/events', ...guards.customer('query', 401, 'Valid ticket required'), (req, res) => {
    const { queue, customer } = actor<Extract<Actor, { type: 'customer' }>>(res);
    if (customer.status === 'served') { res.status(204).end(); return; }
    res.set({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(`event: status\ndata: ${JSON.stringify({ ...runtime.statusFor(customer), queueStatus: runtime.periodFor(queue) })}\n\n`);
    runtime.addClient(queue, customer, req, res);
  });

  return router;
}
