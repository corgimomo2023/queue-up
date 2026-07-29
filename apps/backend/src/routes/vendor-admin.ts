import { Router } from 'express';
import { vendorAdminAuditRoutes } from './vendor-admin/audit-routes';
import { vendorAdminAuthRoutes } from './vendor-admin/auth-routes';
import { vendorAdminBrandingRoutes } from './vendor-admin/branding-routes';
import { vendorAdminEventCommandRoutes } from './vendor-admin/event-command-routes';
import { vendorAdminEventQueryRoutes } from './vendor-admin/event-query-routes';
import type { AccessGuards } from '../access-guards';
import type { AppRuntime } from '../runtime';

export { archiveEvent, updateEditableEvent } from '../application/events/event-management-service';

export function vendorAdminRoutes(runtime: AppRuntime, guards: AccessGuards) {
  const router = Router();
  router.use(vendorAdminAuthRoutes(runtime));
  router.use(vendorAdminEventCommandRoutes(runtime, guards));
  router.use(vendorAdminBrandingRoutes(runtime, guards));
  router.use(vendorAdminEventQueryRoutes(runtime, guards));
  router.use(vendorAdminAuditRoutes(runtime, guards));
  return router;
}
