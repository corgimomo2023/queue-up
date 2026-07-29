import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { CookieName, RateLimit, Session } from '../config/http-constants';
import { ActorType, AuditAction } from '../domain/constants';
import { actor, body, params, validateBody, validateParams } from '../http';
import { customerParamsSchema, unlockSchema, type UnlockDto } from '../schemas';
import { signStaffSession, verifySlowHash } from '../security';
import type { AccessGuards } from '../access-guards';
import type { AppRuntime } from '../runtime';
import type { Actor } from '../types';

export function staffAdminRoutes(runtime: AppRuntime, guards: AccessGuards) {
  const router = Router();
  const unlockRateLimiter = rateLimit({
    windowMs: RateLimit.WindowMilliseconds,
    limit: RateLimit.LoginFailuresPerWindow,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
  });
  const unlockMiddleware = runtime.options.rateLimit === false ? [] : [unlockRateLimiter];

  router.post(
    '/api/queues/:queueId/unlock',
    guards.queue,
    guards.activeQueue,
    ...unlockMiddleware,
    validateBody(unlockSchema),
    async (req, res) => {
      const queue = res.locals.queue;
      const { credential } = body<UnlockDto>(res);
      const valid =
        verifySlowHash(credential, queue.password_hash, false) ||
        verifySlowHash(credential, queue.email_hash) ||
        verifySlowHash(credential, queue.phone_hash);
      if (!valid) {
        await runtime.writeAudit(
          req,
          ActorType.Anonymous,
          AuditAction.ClientAdminLoginFailed,
          queue.id,
        );
        res.status(401).json({ error: 'Invalid credential' });
        return;
      }
      res.cookie(CookieName.StaffAdmin, signStaffSession(queue.id, runtime.options.sessionSecret), {
        httpOnly: true,
        secure: runtime.options.secureCookie !== false,
        sameSite: 'lax',
        maxAge: Session.DurationMilliseconds,
        path: '/',
      });
      await runtime.writeAudit(
        req,
        ActorType.ClientAdmin,
        AuditAction.ClientAdminLoginSuccess,
        queue.id,
      );
      res.json({ ok: true, queueId: queue.slug });
    },
  );

  router.get('/api/vendor/:queueId', ...guards.staffAdmin, async (_req, res) => {
    const { queue } = actor<Extract<Actor, { type: typeof ActorType.StaffAdmin }>>(res);
    const customers = await runtime.repositories.customers.listWaiting(queue.id);
    res.json({
      queueId: queue.slug,
      name: queue.name,
      waitingCount: customers.length,
      customers,
      customerUrl: `/q/${queue.slug}`,
      ...runtime.brandingFor(queue),
      ...runtime.periodFor(queue),
    });
  });

  router.post('/api/vendor/:queueId/serve-next', ...guards.staffAdmin, async (req, res) => {
    const { queue } = actor<Extract<Actor, { type: typeof ActorType.StaffAdmin }>>(res);
    const customer = await runtime.services.customers.serveNext(
      queue.id,
      runtime.now().toISOString(),
      runtime.auditFields(req),
    );
    if (!customer) {
      res.status(409).json({ error: 'No customers waiting' });
      return;
    }
    runtime.callCustomer(queue.slug, customer.id);
    await runtime.emit(queue.slug, customer.id);
    res.json({ customer: { customerId: customer.id, name: customer.name } });
  });

  router.delete(
    '/api/vendor/:queueId/customers/:customerId',
    ...guards.staffAdmin,
    validateParams(customerParamsSchema),
    async (req, res) => {
      const { queue } = actor<Extract<Actor, { type: typeof ActorType.StaffAdmin }>>(res);
      const { customerId } = params<{ queueId: string; customerId: number }>(res);
      const removed = await runtime.services.customers.removeWaiting(
        queue.id,
        customerId,
        runtime.now().toISOString(),
        runtime.auditFields(req),
      );
      if (!removed) {
        res.status(404).json({ error: 'Customer not found' });
        return;
      }
      await runtime.emit(queue.slug);
      res.json({ ok: true });
    },
  );

  router.delete('/api/vendor/:queueId/customers', ...guards.staffAdmin, async (req, res) => {
    const { queue } = actor<Extract<Actor, { type: typeof ActorType.StaffAdmin }>>(res);
    const removed = await runtime.services.customers.clearWaiting(
      queue.id,
      runtime.now().toISOString(),
      runtime.auditFields(req),
    );
    await runtime.emit(queue.slug);
    res.json({ ok: true, removed });
  });

  router.post('/api/vendor/:queueId/logout', ...guards.staffAdmin, (_req, res) => {
    res.clearCookie(CookieName.StaffAdmin, {
      httpOnly: true,
      secure: runtime.options.secureCookie !== false,
      sameSite: 'lax',
      path: '/',
    });
    res.json({ ok: true });
  });

  return router;
}
