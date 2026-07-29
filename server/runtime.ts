import type { Request, Response } from 'express';
import Database from 'better-sqlite3';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { reconcileEventAssets } from './event-assets.js';
import { BUSINESS_TIME_ZONE, queueLifecycle } from './queue-period.js';
import { slowHash, tokenHash } from './security.js';
import type { AppOptions, CustomerRow, QueueRow } from './types.js';

export function createRuntime(options: AppOptions) {
  const now = options.now ?? (() => new Date());
  const ownsAssetDir = !options.assetDir && options.dbPath === ':memory:';
  const assetDir = options.assetDir
    ?? (ownsAssetDir ? mkdtempSync(path.join(tmpdir(), 'nextq-event-assets-')) : path.join(path.dirname(options.dbPath), 'event-assets'));
  mkdirSync(assetDir, { recursive: true });
  const db = new Database(options.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS queues (
      id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      email_hash TEXT, phone_hash TEXT, password_hash TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      start_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, end_at TEXT, removed_at TEXT,
      description TEXT, logo_path TEXT
    );
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY, queue_id INTEGER NOT NULL REFERENCES queues(id) ON DELETE CASCADE,
      name TEXT NOT NULL, phone TEXT, message TEXT, joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      status TEXT NOT NULL DEFAULT 'waiting', token_hash TEXT NOT NULL UNIQUE,
      ended_at TEXT, ended_reason TEXT
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY, queue_id INTEGER REFERENCES queues(id) ON DELETE SET NULL,
      customer_id INTEGER, actor_type TEXT NOT NULL, action TEXT NOT NULL,
      metadata_json TEXT NOT NULL DEFAULT '{}', ip_address TEXT, user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_customers_queue_status ON customers(queue_id, status, id);
    CREATE INDEX IF NOT EXISTS idx_audit_logs_queue_created ON audit_logs(queue_id, created_at DESC, id DESC);
  `);
  const queueColumns = new Set((db.prepare('PRAGMA table_info(queues)').all() as { name: string }[]).map(column => column.name));
  if (!queueColumns.has('start_at')) db.exec('ALTER TABLE queues ADD COLUMN start_at TEXT');
  if (!queueColumns.has('end_at')) db.exec('ALTER TABLE queues ADD COLUMN end_at TEXT');
  if (!queueColumns.has('removed_at')) db.exec('ALTER TABLE queues ADD COLUMN removed_at TEXT');
  if (!queueColumns.has('password_hash')) db.exec('ALTER TABLE queues ADD COLUMN password_hash TEXT');
  if (!queueColumns.has('description')) db.exec('ALTER TABLE queues ADD COLUMN description TEXT');
  if (!queueColumns.has('logo_path')) db.exec('ALTER TABLE queues ADD COLUMN logo_path TEXT');
  db.exec('UPDATE queues SET start_at=created_at WHERE start_at IS NULL');
  const customerColumns = new Set((db.prepare('PRAGMA table_info(customers)').all() as { name: string }[]).map(column => column.name));
  if (!customerColumns.has('ended_at')) db.exec('ALTER TABLE customers ADD COLUMN ended_at TEXT');
  if (!customerColumns.has('ended_reason')) db.exec('ALTER TABLE customers ADD COLUMN ended_reason TEXT');
  reconcileEventAssets({ assetDir, db });

  const seedEmailHash = options.seedEmail ? slowHash(options.seedEmail) : null;
  const seedPhoneHash = options.seedPhone ? slowHash(options.seedPhone) : null;
  if (seedEmailHash || seedPhoneHash) {
    db.prepare('INSERT INTO queues(slug,name,email_hash,phone_hash) VALUES(?,?,?,?) ON CONFLICT(slug) DO NOTHING')
      .run('test-demo-t7dn', 'Test Demo', seedEmailHash, seedPhoneHash);
  }

  const clients = new Map<string, Map<number, Set<Response>>>();
  const getQueue = (slug: string) => db.prepare('SELECT * FROM queues WHERE slug=?').get(slug) as QueueRow | undefined;
  const customerByToken = (queueId: number, token: string | undefined) => token
    ? db.prepare("SELECT * FROM customers WHERE queue_id=? AND token_hash=? AND status IN ('waiting','served')").get(queueId, tokenHash(token)) as CustomerRow | undefined
    : undefined;
  const periodFor = (queue: QueueRow) => ({
    startAt: queue.start_at,
    endAt: queue.end_at,
    lifecycleStatus: queueLifecycle({ startAt: queue.start_at, endAt: queue.end_at }, now()),
    timeZone: BUSINESS_TIME_ZONE,
    isRemoved: Boolean(queue.removed_at),
    removedAt: queue.removed_at,
  });
  const brandingFor = (queue: QueueRow) => ({
    description: queue.description,
    logoUrl: queue.logo_path ? `/event-assets/${encodeURIComponent(queue.logo_path)}` : null,
  });
  const writeAudit = (req: Request, actorType: string, action: string, queueId?: number, customerId?: number, metadata: Record<string, unknown> = {}) => {
    db.prepare(`INSERT INTO audit_logs(queue_id,customer_id,actor_type,action,metadata_json,ip_address,user_agent)
      VALUES(?,?,?,?,?,?,?)`).run(queueId ?? null, customerId ?? null, actorType, action, JSON.stringify(metadata), req.ip || null, req.get('user-agent')?.slice(0, 500) || null);
  };
  const maskPhone = (phone: string | null) => {
    if (!phone) return null;
    const compact = phone.replace(/\s+/g, '');
    return compact.length <= 4 ? '****' : `${compact.slice(0, 3)}****${compact.slice(-2)}`;
  };
  const statusFor = (customer: CustomerRow) => {
    const position = customer.status === 'waiting'
      ? (db.prepare("SELECT count(*) count FROM customers WHERE queue_id=? AND status='waiting' AND id<=?").get(customer.queue_id, customer.id) as { count: number }).count : 0;
    const waitingCount = (db.prepare("SELECT count(*) count FROM customers WHERE queue_id=? AND status='waiting'").get(customer.queue_id) as { count: number }).count;
    const peopleAhead = customer.status === 'waiting' ? Math.max(0, position - 1) : 0;
    return { customerId: customer.id, name: customer.name, status: customer.status, position, peopleAhead, waitingCount, isNext: position === 1 };
  };
  const emit = (slug: string, excludeCustomerId?: number) => {
    const queue = db.prepare('SELECT id FROM queues WHERE slug=?').get(slug) as { id: number } | undefined;
    if (!queue) return;
    const waitingCount = (db.prepare("SELECT count(*) count FROM customers WHERE queue_id=? AND status='waiting'").get(queue.id) as { count: number }).count;
    for (const [customerId, responses] of clients.get(slug) ?? []) {
      if (customerId === excludeCustomerId) continue;
      for (const response of responses) response.write(`event: update\ndata: ${JSON.stringify({ waitingCount })}\n\n`);
    }
  };
  const callCustomer = (slug: string, customerId: number) => {
    const eventClients = clients.get(slug);
    const group = eventClients?.get(customerId);
    if (!group) return;
    const data = JSON.stringify({ message: '現正輪到你，請於5分鐘到回到活動場地入場' });
    for (const response of group) {
      response.write(`event: queue.called\ndata: ${data}\n\n`);
      response.end();
    }
    eventClients!.delete(customerId);
    if (!eventClients!.size && clients.get(slug) === eventClients) clients.delete(slug);
  };
  const closeQueueClients = (slug: string, event: string, data: Record<string, unknown>) => {
    const eventClients = clients.get(slug);
    for (const responses of eventClients?.values() ?? []) {
      for (const response of responses) {
        response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        response.end();
      }
    }
    if (clients.get(slug) === eventClients) clients.delete(slug);
  };
  const finalizeWaiting = (queue: QueueRow, req: Request, reason: 'queue_period_ended' | 'queue_soft_removed') => {
    const changes = db.transaction(() => {
      const result = db.prepare("UPDATE customers SET status='removed',ended_at=?,ended_reason=? WHERE queue_id=? AND status='waiting'")
        .run(now().toISOString(), reason, queue.id);
      if (result.changes) writeAudit(req, 'system', reason === 'queue_period_ended' ? 'QUEUE_PERIOD_ENDED' : 'QUEUE_SOFT_REMOVED', queue.id, undefined, { removed: result.changes });
      return result.changes;
    })();
    if (changes) emit(queue.slug);
    return changes;
  };
  const requireActive = (req: Request, res: Response, queue: QueueRow): boolean => {
    const state = queueLifecycle({ startAt: queue.start_at, endAt: queue.end_at }, now());
    if (state === 'active') return true;
    if (state === 'ended') finalizeWaiting(queue, req, 'queue_period_ended');
    res.status(409).json({ error: 'Queue is not active', code: state === 'scheduled' ? 'QUEUE_SCHEDULED' : 'QUEUE_ENDED', startAt: queue.start_at, endAt: queue.end_at });
    return false;
  };
  const addClient = (queue: QueueRow, customer: CustomerRow, req: Request, res: Response) => {
    const eventClients = clients.get(queue.slug) ?? new Map<number, Set<Response>>();
    const responses = eventClients.get(customer.id) ?? new Set<Response>();
    responses.add(res);
    eventClients.set(customer.id, responses);
    clients.set(queue.slug, eventClients);
    const heartbeat = setInterval(() => {
      const latest = getQueue(queue.slug);
      if (!latest || latest.removed_at) {
        res.write(`event: queue_archived\ndata: ${JSON.stringify({ code: 'EVENT_ARCHIVED' })}\n\n`);
        res.end();
        return;
      }
      const state = queueLifecycle({ startAt: latest.start_at, endAt: latest.end_at }, now());
      if (state === 'ended') {
        finalizeWaiting(latest, req, 'queue_period_ended');
        res.write(`event: queue_ended\ndata: ${JSON.stringify({ code: 'QUEUE_ENDED' })}\n\n`);
        res.end();
        return;
      }
      res.write(': heartbeat\n\n');
    }, 20_000);
    req.on('close', () => {
      clearInterval(heartbeat);
      responses.delete(res);
      if (!responses.size) eventClients.delete(customer.id);
      if (!eventClients.size && clients.get(queue.slug) === eventClients) clients.delete(queue.slug);
    });
  };
  const close = () => {
    for (const eventClients of clients.values()) {
      for (const responses of eventClients.values()) for (const client of responses) client.end();
    }
    clients.clear();
    db.close();
    if (ownsAssetDir) rmSync(assetDir, { recursive: true, force: true });
  };

  return {
    options, now, db, assetDir, clients, getQueue, customerByToken, periodFor, brandingFor, writeAudit, maskPhone,
    statusFor, emit, callCustomer, closeQueueClients, finalizeWaiting, requireActive, addClient, close,
  };
}

export type AppRuntime = ReturnType<typeof createRuntime>;
