import { Router } from 'express';
import type { AccessGuards } from '../../access-guards';
import type { AppRuntime } from '../../runtime';

const DEFAULT_AUDIT_LIMIT = 100;
const MINIMUM_AUDIT_LIMIT = 20;
const MAXIMUM_AUDIT_LIMIT = 200;

export function vendorAdminAuditRoutes(runtime: AppRuntime, guards: AccessGuards) {
  const router = Router();

  router.get('/api/super-admin/audit', guards.vendorAdmin, async (req, res) => {
    const limit = Math.min(
      MAXIMUM_AUDIT_LIMIT,
      Math.max(MINIMUM_AUDIT_LIMIT, Number(req.query.limit) || DEFAULT_AUDIT_LIMIT),
    );
    const queueSlug = typeof req.query.queueId === 'string' ? req.query.queueId : undefined;
    const events = await runtime.readModels.admin.listAuditEvents(limit, queueSlug);
    res.json({ events });
  });

  return router;
}
