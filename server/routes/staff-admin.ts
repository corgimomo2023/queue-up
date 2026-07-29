import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { actor, body, params, validateBody, validateParams } from '../http.js';
import { customerParamsSchema, unlockSchema, type UnlockDto } from '../schemas.js';
import { signStaffSession, verifySlowHash } from '../security.js';
import type { AccessGuards } from '../access-guards.js';
import type { AppRuntime } from '../runtime.js';
import type { Actor, CustomerRow } from '../types.js';

export function staffAdminRoutes(runtime: AppRuntime, guards: AccessGuards) {
  const router = Router();
  const unlockRateLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 10, skipSuccessfulRequests: true, standardHeaders: 'draft-8', legacyHeaders: false });
  const unlockMiddleware = runtime.options.rateLimit === false ? [] : [unlockRateLimiter];

  router.post('/api/queues/:queueId/unlock', guards.queue, guards.activeQueue, ...unlockMiddleware, validateBody(unlockSchema), (req, res) => {
    const queue = res.locals.queue;
    const { credential } = body<UnlockDto>(res);
    const valid = verifySlowHash(credential, queue.password_hash, false)
      || verifySlowHash(credential, queue.email_hash)
      || verifySlowHash(credential, queue.phone_hash);
    if (!valid) {
      runtime.writeAudit(req, 'anonymous', 'CLIENT_ADMIN_LOGIN_FAILED', queue.id);
      res.status(401).json({ error: 'Invalid credential' });
      return;
    }
    res.cookie('qf_vendor', signStaffSession(queue.id, runtime.options.sessionSecret), {
      httpOnly: true, secure: runtime.options.secureCookie !== false, sameSite: 'lax', maxAge: 8 * 60 * 60_000, path: '/',
    });
    runtime.writeAudit(req, 'client_admin', 'CLIENT_ADMIN_LOGIN_SUCCESS', queue.id);
    res.json({ ok: true, queueId: queue.slug });
  });

  router.get('/api/vendor/:queueId', ...guards.staffAdmin, (_req, res) => {
    const { queue } = actor<Extract<Actor, { type: 'staff_admin' }>>(res);
    const customers = runtime.db.prepare("SELECT id AS customerId,name,phone,message,joined_at AS joinedAt FROM customers WHERE queue_id=? AND status='waiting' ORDER BY id").all(queue.id);
    res.json({ queueId: queue.slug, name: queue.name, waitingCount: customers.length, customers, customerUrl: `/q/${queue.slug}`, ...runtime.brandingFor(queue), ...runtime.periodFor(queue) });
  });

  router.post('/api/vendor/:queueId/serve-next', ...guards.staffAdmin, (req, res) => {
    const { queue } = actor<Extract<Actor, { type: 'staff_admin' }>>(res);
    const customer = runtime.db.prepare("SELECT * FROM customers WHERE queue_id=? AND status='waiting' ORDER BY id LIMIT 1").get(queue.id) as CustomerRow | undefined;
    if (!customer) { res.status(409).json({ error: 'No customers waiting' }); return; }
    runtime.db.prepare("UPDATE customers SET status='served',ended_at=CURRENT_TIMESTAMP,ended_reason='served' WHERE id=?").run(customer.id);
    runtime.writeAudit(req, 'client_admin', 'CUSTOMER_SERVED', queue.id, customer.id, { name: customer.name });
    runtime.callCustomer(queue.slug, customer.id);
    runtime.emit(queue.slug, customer.id);
    res.json({ customer: { customerId: customer.id, name: customer.name } });
  });

  router.delete('/api/vendor/:queueId/customers/:customerId', ...guards.staffAdmin, validateParams(customerParamsSchema), (req, res) => {
    const { queue } = actor<Extract<Actor, { type: 'staff_admin' }>>(res);
    const { customerId } = params<{ queueId: string; customerId: number }>(res);
    const result = runtime.db.prepare("UPDATE customers SET status='removed',ended_at=CURRENT_TIMESTAMP,ended_reason='vendor_removed' WHERE id=? AND queue_id=? AND status='waiting'").run(customerId, queue.id);
    if (!result.changes) { res.status(404).json({ error: 'Customer not found' }); return; }
    runtime.writeAudit(req, 'client_admin', 'CUSTOMER_REMOVED', queue.id, customerId);
    runtime.emit(queue.slug);
    res.json({ ok: true });
  });

  router.delete('/api/vendor/:queueId/customers', ...guards.staffAdmin, (req, res) => {
    const { queue } = actor<Extract<Actor, { type: 'staff_admin' }>>(res);
    const result = runtime.db.prepare("UPDATE customers SET status='removed',ended_at=CURRENT_TIMESTAMP,ended_reason='queue_cleared' WHERE queue_id=? AND status='waiting'").run(queue.id);
    runtime.writeAudit(req, 'client_admin', 'QUEUE_CLEARED', queue.id, undefined, { removed: result.changes });
    runtime.emit(queue.slug);
    res.json({ ok: true, removed: result.changes });
  });

  router.post('/api/vendor/:queueId/logout', ...guards.staffAdmin, (_req, res) => {
    res.clearCookie('qf_vendor', { httpOnly: true, secure: runtime.options.secureCookie !== false, sameSite: 'lax', path: '/' });
    res.json({ ok: true });
  });

  return router;
}
