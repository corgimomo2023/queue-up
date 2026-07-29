import type { RequestHandler } from 'express';
import { setActor } from './http.js';
import { cookieValue, verifyStaffSession, verifyVendorAdminSession } from './security.js';
import type { AppRuntime } from './runtime.js';

export function createAccessGuards(runtime: AppRuntime) {
  const vendorAdmin: RequestHandler = (req, res, next) => {
    if (!runtime.options.superAdminKey || !verifyVendorAdminSession(cookieValue(req, 'qf_super_admin'), runtime.options.sessionSecret)) {
      res.status(401).json({ error: 'Vendor Admin authentication required' });
      return;
    }
    setActor(res, { type: 'vendor_admin' });
    next();
  };

  const queue: RequestHandler = (req, res, next) => {
    const found = runtime.getQueue(req.params.queueId as string);
    if (!found || found.removed_at) {
      res.status(404).json({ error: 'Queue not found' });
      return;
    }
    res.locals.queue = found;
    next();
  };

  const activeQueue: RequestHandler = (req, res, next) => {
    const found = res.locals.queue;
    if (!found || !runtime.requireActive(req, res, found)) return;
    next();
  };

  const staffAdmin: RequestHandler[] = [queue, (req, res, next) => {
    const found = res.locals.queue;
    if (!verifyStaffSession(cookieValue(req, 'qf_vendor'), found.id, runtime.options.sessionSecret)) {
      res.status(401).json({ error: 'Staff Admin authentication required' });
      return;
    }
    setActor(res, { type: 'staff_admin', queue: found });
    next();
  }, activeQueue];

  const customer = (source: 'query' | 'bearer', invalidStatus: 401 | 404, invalidError: string): RequestHandler[] => [queue, activeQueue, (req, res, next) => {
    const token = source === 'query'
      ? (req.query.token as string | undefined)
      : (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined);
    const found = runtime.customerByToken(res.locals.queue.id, token);
    if (!found) {
      res.status(invalidStatus).json({ error: invalidError });
      return;
    }
    setActor(res, { type: 'customer', queue: res.locals.queue, customer: found });
    next();
  }];

  return { vendorAdmin, queue, activeQueue, staffAdmin, customer };
}

export type AccessGuards = ReturnType<typeof createAccessGuards>;
