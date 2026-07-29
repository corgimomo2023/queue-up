import { Router, type RequestHandler } from 'express';
import { EventAssetError, parseEventLogo, removeEventLogo, storeEventLogo } from '../event-assets.js';
import { hongKongEndDateToUtc, hongKongLocalToUtc, queueLifecycle } from '../queue-period.js';
import { actor, asyncErrors, body, validateBody } from '../http.js';
import {
  archiveEventSchema, createQueueSchema, editEventSchema, vendorAdminLoginSchema,
  type ArchiveEventDto, type CreateQueueDto, type EditEventDto, type VendorAdminLoginDto,
} from '../schemas.js';
import { safeSlug, secretsMatch, signVendorAdminSession, slowHash } from '../security.js';
import type { AccessGuards } from '../access-guards.js';
import type { AppRuntime } from '../runtime.js';
import type { QueueRow } from '../types.js';

type EditableEventValues = {
  name: string;
  description: string | null;
  startAt: string;
  endAt: string | null;
  passwordHash: string | null;
};

export function updateEditableEvent(db: AppRuntime['db'], queue: QueueRow, values: EditableEventValues): void {
  const result = db.prepare(`UPDATE queues SET name=?,description=?,start_at=?,end_at=?,password_hash=COALESCE(?,password_hash)
    WHERE id=? AND removed_at IS NULL`)
    .run(values.name, values.description, values.startAt, values.endAt, values.passwordHash, queue.id);
  if (result.changes === 1) return;
  const latest = db.prepare('SELECT removed_at FROM queues WHERE id=?').get(queue.id) as { removed_at: string | null } | undefined;
  if (latest?.removed_at) {
    throw new EventAssetError(409, 'EVENT_ARCHIVED', 'Archived events cannot be edited');
  }
  throw new EventAssetError(409, 'EVENT_UPDATE_CONFLICT', 'Event changed; reload and retry');
}

export function archiveEvent(
  db: AppRuntime['db'],
  queueId: number,
  removedAt: string,
  writeAudit: (removedWaiting: number) => void,
): number {
  return db.transaction(() => {
    const archived = db.prepare('UPDATE queues SET removed_at=? WHERE id=? AND removed_at IS NULL').run(removedAt, queueId);
    if (archived.changes !== 1) {
      throw new EventAssetError(409, 'EVENT_ALREADY_ARCHIVED', 'Event is already archived');
    }
    const tickets = db.prepare("UPDATE customers SET status='removed',ended_at=?,ended_reason='queue_soft_removed' WHERE queue_id=? AND status='waiting'")
      .run(removedAt, queueId);
    writeAudit(tickets.changes);
    return tickets.changes;
  })();
}

export function vendorAdminRoutes(runtime: AppRuntime, guards: AccessGuards) {
  const router = Router();
  const requireEditableEvent: RequestHandler = (req, res, next) => {
    const queue = runtime.getQueue(req.params.queueId as string);
    if (!queue) { res.status(404).json({ error: 'Event not found' }); return; }
    if (queue.removed_at) { res.status(409).json({ error: 'Archived events cannot be edited', code: 'EVENT_ARCHIVED' }); return; }
    res.locals.editableQueue = queue;
    next();
  };

  router.post('/api/super-admin/login', validateBody(vendorAdminLoginSchema), asyncErrors((req, res) => {
    const { key } = body<VendorAdminLoginDto>(res);
    if (!runtime.options.superAdminKey || !secretsMatch(key, runtime.options.superAdminKey)) {
      runtime.writeAudit(req, 'anonymous', 'VENDOR_ADMIN_LOGIN_FAILED');
      res.status(401).json({ error: 'Invalid Vendor Admin key' });
      return;
    }
    res.cookie('qf_super_admin', signVendorAdminSession(runtime.options.sessionSecret), {
      httpOnly: true, secure: runtime.options.secureCookie !== false, sameSite: 'strict', maxAge: 8 * 60 * 60_000, path: '/',
    });
    runtime.writeAudit(req, 'vendor_admin', 'VENDOR_ADMIN_LOGIN_SUCCESS');
    res.json({ ok: true });
  }));
  router.post('/api/super-admin/logout', (_req, res) => {
    res.clearCookie('qf_super_admin', { httpOnly: true, secure: runtime.options.secureCookie !== false, sameSite: 'strict', path: '/' });
    res.json({ ok: true });
  });

  router.post('/api/queues', guards.vendorAdmin, validateBody(createQueueSchema), asyncErrors((req, res) => {
    void actor(res);
    const dto = body<CreateQueueDto>(res);
    const startAt = dto.startMode === 'scheduled' ? hongKongLocalToUtc(dto.startLocal!) : runtime.now().toISOString();
    const endAt = dto.endDate ? hongKongEndDateToUtc(dto.endDate) : null;
    queueLifecycle({ startAt, endAt }, runtime.now());
    let slug = safeSlug(dto.businessName);
    while (runtime.getQueue(slug)) slug = safeSlug(dto.businessName);
    const description = dto.description?.trim() || null;
    const result = runtime.db.prepare('INSERT INTO queues(slug,name,password_hash,start_at,end_at,description) VALUES(?,?,?,?,?,?)')
      .run(slug, dto.businessName, slowHash(dto.password, false), startAt, endAt, description);
    const queue = runtime.getQueue(slug)!;
    runtime.writeAudit(req, 'vendor_admin', 'EVENT_CREATED', Number(result.lastInsertRowid), undefined, { queueId: slug, name: dto.businessName, startAt, endAt });
    res.status(201).json({ queueId: slug, name: dto.businessName, vendorUrl: `/vendor/${slug}`, customerUrl: `/q/${slug}`, ...runtime.brandingFor(queue), ...runtime.periodFor(queue) });
  }));

  router.get('/api/super-admin/overview', guards.vendorAdmin, (req, res) => {
    const allLive = runtime.db.prepare('SELECT * FROM queues WHERE removed_at IS NULL').all() as QueueRow[];
    for (const queue of allLive) {
      if (queueLifecycle({ startAt: queue.start_at, endAt: queue.end_at }, runtime.now()) === 'ended') runtime.finalizeWaiting(queue, req, 'queue_period_ended');
    }
    const showRemoved = req.query.status === 'removed';
    const rows = runtime.db.prepare(`
      SELECT q.id,q.slug AS queueId,q.slug,q.name,q.description,q.logo_path,q.created_at AS createdAt,q.created_at,
        q.start_at,q.end_at,q.removed_at,
        SUM(CASE WHEN c.status='waiting' THEN 1 ELSE 0 END) AS waitingCount,
        SUM(CASE WHEN c.status='served' THEN 1 ELSE 0 END) AS servedCount,
        COUNT(c.id) AS totalCustomers, MAX(c.joined_at) AS lastActivityAt
      FROM queues q LEFT JOIN customers c ON c.queue_id=q.id
      WHERE q.removed_at IS ${showRemoved ? 'NOT NULL' : 'NULL'}
      GROUP BY q.id ORDER BY COALESCE(lastActivityAt, q.created_at) DESC
    `).all() as Array<Record<string, unknown> & QueueRow>;
    const queues = rows.map(row => ({ ...row, ...runtime.brandingFor(row), ...runtime.periodFor(row) }));
    const summary = runtime.db.prepare(`
      SELECT (SELECT COUNT(*) FROM queues WHERE removed_at IS NULL) AS queues,
        (SELECT COUNT(*) FROM queues WHERE removed_at IS NOT NULL) AS removedQueues,
        SUM(CASE WHEN status='waiting' THEN 1 ELSE 0 END) AS waiting,
        SUM(CASE WHEN status='served' THEN 1 ELSE 0 END) AS served, COUNT(*) AS totalCustomers
      FROM customers
    `).get() as { queues: number; removedQueues: number; waiting: number | null; served: number | null; totalCustomers: number };
    const lifecycleCounts = { scheduledQueues: 0, activeQueues: 0, endedQueues: 0 };
    for (const queue of allLive) {
      const key = `${queueLifecycle({ startAt: queue.start_at, endAt: queue.end_at }, runtime.now())}Queues` as keyof typeof lifecycleCounts;
      lifecycleCounts[key] += 1;
    }
    res.json({ summary: { ...summary, ...lifecycleCounts, waiting: summary.waiting ?? 0, served: summary.served ?? 0 }, queues });
  });

  router.get('/api/super-admin/queues/:queueId', guards.vendorAdmin, (req, res) => {
    const queue = runtime.getQueue(req.params.queueId as string);
    if (!queue) { res.status(404).json({ error: 'Queue not found' }); return; }
    const customers = (runtime.db.prepare(`
      SELECT id AS customerId,name,phone,message,joined_at AS joinedAt,status,
        ended_at AS endedAt,ended_reason AS endedReason
      FROM customers WHERE queue_id=? ORDER BY id DESC LIMIT 500
    `).all(queue.id) as Array<{ customerId: number; name: string; phone: string | null; message: string | null; joinedAt: string; status: string; endedAt: string | null; endedReason: string | null }>)
      .map(customer => ({ ...customer, phoneMasked: runtime.maskPhone(customer.phone), phone: undefined }));
    const counts = runtime.db.prepare(`SELECT
      SUM(CASE WHEN status='waiting' THEN 1 ELSE 0 END) AS waiting,
      SUM(CASE WHEN status='served' THEN 1 ELSE 0 END) AS served,
      SUM(CASE WHEN status IN ('left','removed') THEN 1 ELSE 0 END) AS ended,
      COUNT(*) AS total FROM customers WHERE queue_id=?`).get(queue.id) as { waiting: number | null; served: number | null; ended: number | null; total: number };
    res.json({
      queue: { queueId: queue.slug, name: queue.name, vendorUrl: `/vendor/${queue.slug}`, customerUrl: `/q/${queue.slug}`, ...runtime.brandingFor(queue), ...runtime.periodFor(queue) },
      counts: { ...counts, waiting: counts.waiting ?? 0, served: counts.served ?? 0, ended: counts.ended ?? 0 }, customers,
    });
  });

  router.patch('/api/super-admin/queues/:queueId', guards.vendorAdmin, validateBody(editEventSchema), asyncErrors((req, res) => {
    const queue = runtime.getQueue(req.params.queueId as string);
    if (!queue) { res.status(404).json({ error: 'Event not found' }); return; }
    if (queue.removed_at) { res.status(409).json({ error: 'Archived events cannot be edited', code: 'EVENT_ARCHIVED' }); return; }
    const dto = body<EditEventDto>(res);
    const nextName = dto.name ?? queue.name;
    const nextDescription = dto.description !== undefined ? (dto.description?.trim() || null) : queue.description;
    const nextStart = dto.startLocal ? hongKongLocalToUtc(dto.startLocal) : queue.start_at;
    const nextEnd = dto.endDate !== undefined ? (dto.endDate ? hongKongEndDateToUtc(dto.endDate) : null) : queue.end_at;
    const currentLifecycle = queueLifecycle({ startAt: queue.start_at, endAt: queue.end_at }, runtime.now());
    const nextLifecycle = queueLifecycle({ startAt: nextStart, endAt: nextEnd }, runtime.now());
    if (currentLifecycle === 'active' && nextLifecycle === 'scheduled') {
      res.status(409).json({ error: 'An active event cannot be moved back to scheduled', code: 'EVENT_ACTIVE_CANNOT_BE_RESCHEDULED' });
      return;
    }
    updateEditableEvent(runtime.db, queue, {
      name: nextName, description: nextDescription, startAt: nextStart, endAt: nextEnd,
      passwordHash: dto.password ? slowHash(dto.password, false) : null,
    });
    runtime.writeAudit(req, 'vendor_admin', 'EVENT_UPDATED', queue.id, undefined, { name: nextName, description: nextDescription, startAt: nextStart, endAt: nextEnd });
    const updated = runtime.getQueue(queue.slug)!;
    if (queueLifecycle({ startAt: updated.start_at, endAt: updated.end_at }, runtime.now()) === 'ended') {
      runtime.finalizeWaiting(updated, req, 'queue_period_ended');
      runtime.closeQueueClients(updated.slug, 'queue_ended', { code: 'QUEUE_ENDED' });
    }
    res.json({ queueId: updated.slug, name: updated.name, vendorUrl: `/vendor/${updated.slug}`, customerUrl: `/q/${updated.slug}`, ...runtime.brandingFor(updated), ...runtime.periodFor(updated) });
  }));

  router.put('/api/super-admin/queues/:queueId/logo', guards.vendorAdmin, requireEditableEvent, parseEventLogo, asyncErrors(async (req, res) => {
    const queue = res.locals.editableQueue as QueueRow;
    const filename = await storeEventLogo(runtime, queue, req.body, req.get('content-type'));
    runtime.writeAudit(req, 'vendor_admin', 'EVENT_LOGO_UPLOADED', queue.id, undefined, { mediaType: req.get('content-type')?.split(';', 1)[0], filename });
    res.json({ logoUrl: `/event-assets/${filename}` });
  }));

  router.delete('/api/super-admin/queues/:queueId/logo', guards.vendorAdmin, requireEditableEvent, (req, res) => {
    const queue = res.locals.editableQueue as QueueRow;
    if (removeEventLogo(runtime, queue)) runtime.writeAudit(req, 'vendor_admin', 'EVENT_LOGO_REMOVED', queue.id);
    res.json({ logoUrl: null });
  });

  router.delete('/api/super-admin/queues/:queueId', guards.vendorAdmin, validateBody(archiveEventSchema), asyncErrors((req, res) => {
    const queue = runtime.getQueue(req.params.queueId as string);
    if (!queue) { res.status(404).json({ error: 'Queue not found' }); return; }
    if (queue.removed_at) { res.status(409).json({ error: 'Event is already archived', code: 'EVENT_ALREADY_ARCHIVED' }); return; }
    if (body<ArchiveEventDto>(res).confirmationName !== queue.name) { res.status(400).json({ error: 'Event name does not match' }); return; }
    const removedAt = runtime.now().toISOString();
    const removedWaiting = archiveEvent(runtime.db, queue.id, removedAt, count => {
      runtime.writeAudit(req, 'vendor_admin', 'EVENT_ARCHIVED', queue.id, undefined, { removedWaiting: count, removedAt });
    });
    runtime.closeQueueClients(queue.slug, 'queue_archived', { code: 'EVENT_ARCHIVED' });
    res.json({ ok: true, removedAt, removedWaiting });
  }));

  router.post('/api/super-admin/queues/:queueId/restore', guards.vendorAdmin, (req, res) => {
    if (!req.is('application/json')) { res.status(415).json({ error: 'JSON content type required', code: 'JSON_REQUIRED' }); return; }
    const queue = runtime.getQueue(req.params.queueId as string);
    if (!queue) { res.status(404).json({ error: 'Queue not found' }); return; }
    if (!queue.removed_at) { res.status(409).json({ error: 'Event is not archived', code: 'EVENT_NOT_ARCHIVED' }); return; }
    runtime.db.prepare('UPDATE queues SET removed_at=NULL WHERE id=?').run(queue.id);
    runtime.writeAudit(req, 'vendor_admin', 'EVENT_RESTORED', queue.id, undefined, { previousRemovedAt: queue.removed_at });
    res.json({ ok: true, ...runtime.periodFor(runtime.getQueue(queue.slug)!) });
  });

  router.get('/api/super-admin/audit', guards.vendorAdmin, (req, res) => {
    const limit = Math.min(200, Math.max(20, Number(req.query.limit) || 100));
    const queueSlug = typeof req.query.queueId === 'string' ? req.query.queueId : undefined;
    const rows = queueSlug
      ? runtime.db.prepare(`SELECT a.id,q.slug AS queueId,q.name AS queueName,a.customer_id AS customerId,a.actor_type AS actorType,
          a.action,a.metadata_json AS metadataJson,a.ip_address AS ipAddress,a.user_agent AS userAgent,a.created_at AS createdAt
          FROM audit_logs a LEFT JOIN queues q ON q.id=a.queue_id WHERE q.slug=? ORDER BY a.id DESC LIMIT ?`).all(queueSlug, limit)
      : runtime.db.prepare(`SELECT a.id,q.slug AS queueId,q.name AS queueName,a.customer_id AS customerId,a.actor_type AS actorType,
          a.action,a.metadata_json AS metadataJson,a.ip_address AS ipAddress,a.user_agent AS userAgent,a.created_at AS createdAt
          FROM audit_logs a LEFT JOIN queues q ON q.id=a.queue_id ORDER BY a.id DESC LIMIT ?`).all(limit);
    const events = (rows as Array<Record<string, unknown> & { metadataJson: string }>).map(({ metadataJson, ...row }) => {
      let metadata: unknown = {};
      try { metadata = JSON.parse(metadataJson); } catch { metadata = {}; }
      return { ...row, metadata };
    });
    res.json({ events });
  });

  return router;
}
