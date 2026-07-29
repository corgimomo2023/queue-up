import Database from 'better-sqlite3';
import { unlinkSync } from 'node:fs';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type AppContext } from '../server/app.js';

describe('queue access periods and soft removal', () => {
  let context: AppContext;
  let current = new Date('2026-07-22T04:00:00.000Z'); // noon Hong Kong
  let vendorAdminCookie: string;

  beforeEach(async () => {
    current = new Date('2026-07-22T04:00:00.000Z');
    context = createApp({
      dbPath: ':memory:',
      sessionSecret: 'test-secret-that-is-longer-than-32-chars',
      superAdminKey: 'admin-key',

      secureCookie: false,
      rateLimit: false,
      now: () => new Date(current),
    });
    const login = await request(context.app).post('/api/super-admin/login').send({ key: 'admin-key' }).expect(200);
    vendorAdminCookie = login.headers['set-cookie'][0].split(';')[0] as string;
  });

  afterEach(() => context.close());

  function createQueue(overrides: Record<string, unknown> = {}) {
    return request(context.app).post('/api/queues').set('Cookie', vendorAdminCookie).send({
      businessName: 'Period Shop',
      password: 'period-staff-password',
      startMode: 'now',
      ...overrides,
    });
  }

  async function adminCookie() {
    const login = await request(context.app).post('/api/super-admin/login').send({ key: 'admin-key' }).expect(200);
    return login.headers['set-cookie'];
  }

  it('converts Hong Kong scheduled start and inclusive end date to UTC', async () => {
    const created = await createQueue({
      startMode: 'scheduled',
      startLocal: '2026-07-23T09:30',
      endDate: '2026-07-24',
    }).expect(201);

    expect(created.body).toMatchObject({
      startAt: '2026-07-23T01:30:00.000Z',
      endAt: '2026-07-24T15:59:59.999Z',
      lifecycleStatus: 'scheduled',
      timeZone: 'Asia/Hong_Kong',
    });
    expect(created.body).not.toHaveProperty('id');
    const row = context.db.prepare('SELECT start_at,end_at,removed_at FROM queues WHERE slug=?').get(created.body.queueId) as Record<string, unknown>;
    expect(row).toEqual({ start_at: created.body.startAt, end_at: created.body.endAt, removed_at: null });
  });

  it('rejects invalid and reversed periods with a safe typed client error', async () => {
    const invalid = await createQueue({ startMode: 'scheduled', startLocal: '2026-02-30T09:30' }).expect(400);
    expect(invalid.body).toEqual({ error: 'Invalid event period', code: 'INVALID_EVENT_PERIOD' });
    expect(JSON.stringify(invalid.body)).not.toContain('2026-02-30');
    await createQueue({ startMode: 'scheduled', startLocal: '2026-07-24T09:30', endDate: '2026-07-23' }).expect(400)
      .expect(({ body }) => expect(body).toEqual({ error: 'Invalid event period', code: 'INVALID_EVENT_PERIOD' }));
  });

  it('blocks scheduled and ended customer/vendor access with stable codes', async () => {
    const scheduled = await createQueue({ startMode: 'scheduled', startLocal: '2026-07-23T09:30' }).expect(201);
    await request(context.app).post(`/api/queues/${scheduled.body.queueId}/join`).send({ name: 'Ada' }).expect(409).expect(({ body }) => expect(body.code).toBe('QUEUE_SCHEDULED'));
    await request(context.app).post(`/api/queues/${scheduled.body.queueId}/unlock`).send({ credential: 'owner@example.com' }).expect(409).expect(({ body }) => expect(body.code).toBe('QUEUE_SCHEDULED'));

    const active = await createQueue({ businessName: 'Ends Today', endDate: '2026-07-22' }).expect(201);
    const joined = await request(context.app).post(`/api/queues/${active.body.queueId}/join`).send({ name: 'Grace' }).expect(201);
    current = new Date('2026-07-22T16:00:00.000Z');
    await request(context.app).get(`/api/queues/${active.body.queueId}/status`).query({ token: joined.body.leaveToken }).expect(409).expect(({ body }) => expect(body.code).toBe('QUEUE_ENDED'));
    await request(context.app).delete(`/api/queues/${active.body.queueId}/customers/me`).set('Authorization', `Bearer ${joined.body.leaveToken}`).expect(409).expect(({ body }) => expect(body.code).toBe('QUEUE_ENDED'));
    await request(context.app).post(`/api/queues/${active.body.queueId}/join`).send({ name: 'Late' }).expect(409).expect(({ body }) => expect(body.code).toBe('QUEUE_ENDED'));
    const ended = context.db.prepare('SELECT status,ended_reason FROM customers WHERE id=?').get(joined.body.customerId) as Record<string, unknown>;
    expect(ended).toEqual({ status: 'removed', ended_reason: 'queue_period_ended' });
  });

  it('soft removes atomically, hides public/vendor access, preserves history, and restores without reopening tickets', async () => {
    const created = await createQueue({ businessName: 'Remove Me' }).expect(201);
    const slug = created.body.queueId as string;
    const joined = await request(context.app).post(`/api/queues/${slug}/join`).send({ name: 'Lin' }).expect(201);
    const vendorLogin = await request(context.app).post(`/api/queues/${slug}/unlock`).send({ credential: 'period-staff-password' }).expect(200);
    const vendorCookie = vendorLogin.headers['set-cookie'];
    const admin = await adminCookie();

    await request(context.app).delete(`/api/super-admin/queues/${slug}`).set('Cookie', admin).send({ confirmationName: 'Wrong' }).expect(400);
    await request(context.app).delete(`/api/super-admin/queues/${slug}`).set('Cookie', admin).send({ confirmationName: 'Remove Me' }).expect(200);
    await request(context.app).delete(`/api/super-admin/queues/${slug}`).set('Cookie', admin).send({ confirmationName: 'Remove Me' }).expect(409).expect(({ body }) => expect(body.code).toBe('EVENT_ALREADY_ARCHIVED'));

    await request(context.app).get(`/api/queues/${slug}`).expect(404);
    await request(context.app).get(`/api/vendor/${slug}`).set('Cookie', vendorCookie).expect(404);
    await request(context.app).get(`/api/queues/${slug}/status`).query({ token: joined.body.leaveToken }).expect(404);

    const ticket = context.db.prepare('SELECT status,ended_reason FROM customers WHERE id=?').get(joined.body.customerId) as Record<string, unknown>;
    expect(ticket).toEqual({ status: 'removed', ended_reason: 'queue_soft_removed' });
    const audit = context.db.prepare("SELECT count(*) count FROM audit_logs WHERE action='EVENT_ARCHIVED'").get() as { count: number };
    expect(audit.count).toBe(1);

    const normalOverview = await request(context.app).get('/api/super-admin/overview').set('Cookie', admin).expect(200);
    expect(normalOverview.body.queues).toHaveLength(0);
    const removedOverview = await request(context.app).get('/api/super-admin/overview?status=removed').set('Cookie', admin).expect(200);
    expect(removedOverview.body.queues[0]).toMatchObject({ queueId: slug, isRemoved: true });

    await request(context.app).post(`/api/super-admin/queues/${slug}/restore`).set('Cookie', admin).expect(415).expect(({ body }) => expect(body.code).toBe('JSON_REQUIRED'));
    await request(context.app).post(`/api/super-admin/queues/${slug}/restore`).set('Cookie', admin).send({}).expect(200);
    await request(context.app).post(`/api/super-admin/queues/${slug}/restore`).set('Cookie', admin).send({}).expect(409).expect(({ body }) => expect(body.code).toBe('EVENT_NOT_ARCHIVED'));
    await request(context.app).get(`/api/queues/${slug}`).expect(200);
    const restored = context.db.prepare('SELECT status,ended_reason FROM customers WHERE id=?').get(joined.body.customerId) as Record<string, unknown>;
    expect(restored).toEqual(ticket);
    const restoreAudit = context.db.prepare("SELECT count(*) count FROM audit_logs WHERE action='EVENT_RESTORED'").get() as { count: number };
    expect(restoreAudit.count).toBe(1);
  });
});

describe('legacy queue schema migration', () => {
  it('adds access period columns and backfills start_at from created_at', () => {
    const path = `/tmp/queueflow-migration-${process.pid}-${Date.now()}.sqlite`;
    const legacy = new Database(path);
    legacy.exec(`CREATE TABLE queues (id INTEGER PRIMARY KEY, slug TEXT UNIQUE, name TEXT, email_hash TEXT, phone_hash TEXT, created_at TEXT NOT NULL); INSERT INTO queues(slug,name,created_at) VALUES('legacy','Legacy','2025-01-02 03:04:05')`);
    legacy.close();
    const migrated = createApp({ dbPath: path, sessionSecret: 'migration-secret-that-is-long-enough', superAdminKey: 'admin', rateLimit: false, secureCookie: false });
    const row = migrated.db.prepare('SELECT created_at,start_at,end_at,removed_at FROM queues WHERE slug=?').get('legacy') as Record<string, unknown>;
    expect(row).toEqual({ created_at: '2025-01-02 03:04:05', start_at: '2025-01-02 03:04:05', end_at: null, removed_at: null });
    migrated.close();
    new Database(path).close();
    unlinkSync(path);
  });
});
