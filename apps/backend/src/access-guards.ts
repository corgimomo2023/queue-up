import type { RequestHandler } from 'express';
import { CookieName } from './config/http-constants';
import { ActorType } from './domain/constants';
import { setActor } from './http';
import { cookieValue, verifyStaffSession, verifyVendorAdminSession } from './security';
import type { AppRuntime } from './runtime';

export function createAccessGuards(runtime: AppRuntime) {
  const vendorAdmin: RequestHandler = (req, res, next) => {
    if (
      !runtime.options.superAdminKey ||
      !verifyVendorAdminSession(
        cookieValue(req, CookieName.VendorAdmin),
        runtime.options.sessionSecret,
      )
    ) {
      res.status(401).json({ error: 'Vendor Admin authentication required' });
      return;
    }
    setActor(res, { type: ActorType.VendorAdmin });
    next();
  };

  const queue: RequestHandler = async (req, res, next) => {
    const found = await runtime.getQueue(req.params.queueId as string);
    if (!found || found.removed_at) {
      res.status(404).json({ error: 'Queue not found' });
      return;
    }
    res.locals.queue = found;
    next();
  };

  const activeQueue: RequestHandler = async (req, res, next) => {
    const found = res.locals.queue;
    if (!found || !(await runtime.requireActive(req, res, found))) return;
    next();
  };

  const staffAdmin: RequestHandler[] = [
    queue,
    async (req, res, next) => {
      const found = res.locals.queue;
      if (
        !verifyStaffSession(
          cookieValue(req, CookieName.StaffAdmin),
          found.id,
          runtime.options.sessionSecret,
        )
      ) {
        res.status(401).json({ error: 'Staff Admin authentication required' });
        return;
      }
      setActor(res, { type: ActorType.StaffAdmin, queue: found });
      next();
    },
    activeQueue,
  ];

  const customer = (
    source: 'query' | 'bearer',
    invalidStatus: 401 | 404,
    invalidError: string,
  ): RequestHandler[] => [
    queue,
    activeQueue,
    async (req, res, next) => {
      const token =
        source === 'query'
          ? (req.query.token as string | undefined)
          : req.headers.authorization?.startsWith('Bearer ')
            ? req.headers.authorization.slice(7)
            : undefined;
      const found = await runtime.customerByToken(res.locals.queue.id, token);
      if (!found) {
        res.status(invalidStatus).json({ error: invalidError });
        return;
      }
      setActor(res, { type: ActorType.Customer, queue: res.locals.queue, customer: found });
      next();
    },
  ];

  return { vendorAdmin, queue, activeQueue, staffAdmin, customer };
}

export type AccessGuards = ReturnType<typeof createAccessGuards>;
