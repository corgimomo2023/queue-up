// Tests are deliberately written before src/app.ts (strict RED phase).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join as pathJoin } from 'node:path';
import { createApp, type AppContext } from '../src/app';

const EMAIL = 'vendor@example.test';
const PHONE = '+852 5111 0222';
const ADMIN_KEY = 'test-super-admin-key-at-least-32-chars';
let dir: string;
let dbPath: string;
let ctx: AppContext;

beforeEach(async () => {
  dir = mkdtempSync(pathJoin(tmpdir(), 'queueflow-'));
  dbPath = pathJoin(dir, 'test.sqlite');
  ctx = await createApp({
    dbPath,
    sessionSecret: 'test-secret-at-least-32-characters!!',
    seedEmail: EMAIL,
    seedPhone: PHONE,
    secureCookie: true,
    rateLimit: false,
    superAdminKey: ADMIN_KEY,
  } as Parameters<typeof createApp>[0] & { superAdminKey: string });
});
afterEach(async () => {
  await ctx.close();
  rmSync(dir, { recursive: true, force: true });
});

async function unlock(credential = EMAIL, queueId = 'test-demo-t7dn') {
  const res = await request(ctx.app).post(`/api/queues/${queueId}/unlock`).send({ credential });
  return { res, cookie: res.headers['set-cookie']?.[0]?.split(';')[0] as string };
}
async function joinCustomer(name: string, message?: string, queueId = 'test-demo-t7dn') {
  return request(ctx.app).post(`/api/queues/${queueId}/join`).send({ name, message });
}
async function superAdminCookie() {
  const login = await request(ctx.app)
    .post('/api/super-admin/login')
    .send({ key: ADMIN_KEY })
    .expect(200);
  return login.headers['set-cookie'][0].split(';')[0] as string;
}

describe('health and queue creation', () => {
  it('reports health without exposing secrets', async () => {
    const res = await request(ctx.app).get('/health').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
    expect(JSON.stringify(res.body)).not.toContain(EMAIL);
  });
  it('migrates existing event data with a password hash column without data loss', async () => {
    await ctx.close();
    rmSync(dbPath, { force: true });
    const legacy = new Database(dbPath);
    legacy.exec(`CREATE TABLE queues (
      id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      email_hash TEXT, phone_hash TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      start_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, end_at TEXT, removed_at TEXT
    );`);
    legacy.prepare('INSERT INTO queues(slug,name) VALUES(?,?)').run('legacy-event', 'Legacy Event');
    legacy.close();
    ctx = await createApp({
      dbPath,
      sessionSecret: 'test-secret-at-least-32-characters!!',
      secureCookie: true,
      rateLimit: false,
      superAdminKey: ADMIN_KEY,
    });
    const columns = ctx.db.prepare('PRAGMA table_info(queues)').all() as Array<{ name: string }>;
    expect(columns.map(column => column.name)).toContain('password_hash');
    expect(
      (
        ctx.db.prepare('SELECT name FROM queues WHERE slug=?').get('legacy-event') as {
          name: string;
        }
      ).name,
    ).toBe('Legacy Event');
    const cookie = await superAdminCookie();
    await request(ctx.app)
      .patch('/api/super-admin/queues/legacy-event')
      .set('Cookie', cookie)
      .send({ password: 'new-staff-password' })
      .expect(200);
    await request(ctx.app)
      .post('/api/queues/legacy-event/unlock')
      .send({ credential: 'new-staff-password' })
      .expect(200);
  });
  it('allows only Vendor Admin to create unique event links and validates Staff Admin passwords', async () => {
    await request(ctx.app)
      .post('/api/queues')
      .send({ businessName: 'Public Event', password: 'public-password' })
      .expect(401);
    await request(ctx.app).post('/api/queues').send({ unexpected: 'payload' }).expect(401);
    const cookie = await superAdminCookie();
    const password = ' staff-password-123 ';
    const one = await request(ctx.app)
      .post('/api/queues')
      .set('Cookie', cookie)
      .send({ businessName: 'Morning Event', password })
      .expect(201);
    const two = await request(ctx.app)
      .post('/api/queues')
      .set('Cookie', cookie)
      .send({ businessName: 'Morning Event', password: 'second-staff-password' })
      .expect(201);
    expect(one.body.queueId).toMatch(/^morning-event-[a-z0-9]{4}$/);
    expect(two.body.queueId).not.toBe(one.body.queueId);
    expect(one.body.vendorUrl).toBe(`/vendor/${one.body.queueId}`);
    expect(one.body.customerUrl).toBe(`/q/${one.body.queueId}`);
    const login = await request(ctx.app)
      .post(`/api/queues/${one.body.queueId}/unlock`)
      .send({ credential: password })
      .expect(200);
    expect(login.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(JSON.stringify(login.body)).not.toContain(password);
    const stored = ctx.db
      .prepare('SELECT password_hash,email_hash,phone_hash FROM queues WHERE slug=?')
      .get(one.body.queueId) as {
      password_hash: string;
      email_hash: string | null;
      phone_hash: string | null;
    };
    expect(stored.password_hash).toMatch(/^scrypt\$/);
    expect(stored.password_hash).not.toContain(password);
    expect(stored.email_hash).toBeNull();
    expect(stored.phone_hash).toBeNull();
    const createdAudit = ctx.db
      .prepare(
        "SELECT metadata_json FROM audit_logs WHERE queue_id=(SELECT id FROM queues WHERE slug=?) AND action='EVENT_CREATED' ORDER BY id DESC LIMIT 1",
      )
      .get(one.body.queueId) as { metadata_json: string };
    expect(createdAudit.metadata_json).not.toContain(password);
    await request(ctx.app)
      .post(`/api/queues/${one.body.queueId}/unlock`)
      .send({ credential: password.trim() })
      .expect(401);
    await request(ctx.app)
      .post(`/api/queues/${one.body.queueId}/unlock`)
      .send({ credential: password.replaceAll('-', '') })
      .expect(401);
    expect(readFileSync(dbPath).toString('latin1')).not.toContain(password);
    await request(ctx.app)
      .post('/api/queues')
      .set('Cookie', cookie)
      .send({ businessName: 'No admin' })
      .expect(400);
    await request(ctx.app)
      .post('/api/queues')
      .set('Cookie', cookie)
      .send({ businessName: 'Legacy only', phone: '+852 9000 1234' })
      .expect(400);
    await request(ctx.app)
      .post('/api/queues')
      .set('Cookie', cookie)
      .send({
        businessName: 'Legacy field injection',
        password: 'valid-staff-password',
        phone: '+852 9000 1234',
      })
      .expect(400);
    await request(ctx.app)
      .post('/api/queues')
      .set('Cookie', cookie)
      .send({ businessName: '', password: 'short' })
      .expect(400);
    await request(ctx.app)
      .post('/api/queues')
      .set('Cookie', cookie)
      .send({ businessName: 'Blank password', password: '        ' })
      .expect(400);
  });
});

describe('vendor authentication and mutations', () => {
  it.each([EMAIL, PHONE])(
    'unlocks using configured credential %s and sets hardened cookie',
    async credential => {
      const { res, cookie } = await unlock(credential);
      expect(res.status).toBe(200);
      expect(res.headers['set-cookie'][0]).toMatch(/HttpOnly/);
      expect(res.headers['set-cookie'][0]).toMatch(/Secure/);
      expect(res.headers['set-cookie'][0]).toMatch(/SameSite=Lax/);
      await request(ctx.app).get('/api/vendor/test-demo-t7dn').set('Cookie', cookie).expect(200);
    },
  );
  it('rejects bad unlock and every unauthenticated mutation', async () => {
    await unlock('wrong').then(({ res }) => expect(res.status).toBe(401));
    await request(ctx.app).post('/api/vendor/test-demo-t7dn/serve-next').expect(401);
    await request(ctx.app).delete('/api/vendor/test-demo-t7dn/customers/1').expect(401);
    await request(ctx.app).delete('/api/vendor/test-demo-t7dn/customers').expect(401);
  });
  it('rate limits repeated Staff Admin password failures', async () => {
    await ctx.close();
    ctx = await createApp({
      dbPath,
      sessionSecret: 'test-secret-at-least-32-characters!!',
      seedEmail: EMAIL,
      secureCookie: true,
      rateLimit: true,
      superAdminKey: ADMIN_KEY,
    });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await request(ctx.app)
        .post('/api/queues/test-demo-t7dn/unlock')
        .send({ credential: `wrong-${attempt}` })
        .expect(401);
    }
    await request(ctx.app)
      .post('/api/queues/test-demo-t7dn/unlock')
      .send({ credential: 'wrong-blocked' })
      .expect(429);
  });
  it('serves next, removes one, and clears all while preserving order', async () => {
    const a = await joinCustomer('Ada');
    const b = await joinCustomer('Ben');
    const c = await joinCustomer('Cy');
    expect([a.body.position, b.body.position, c.body.position]).toEqual([1, 2, 3]);
    expect([a.body.peopleAhead, b.body.peopleAhead, c.body.peopleAhead]).toEqual([0, 1, 2]);
    expect([a.body.waitingCount, b.body.waitingCount, c.body.waitingCount]).toEqual([1, 2, 3]);
    const { cookie } = await unlock();
    await request(ctx.app)
      .delete('/api/vendor/test-demo-t7dn/customers/not-a-number')
      .set('Cookie', cookie)
      .expect(400);
    const served = await request(ctx.app)
      .post('/api/vendor/test-demo-t7dn/serve-next')
      .set('Cookie', cookie)
      .expect(200);
    expect(served.body.customer.name).toBe('Ada');
    const bStatus = await request(ctx.app)
      .get(`/api/queues/test-demo-t7dn/status?token=${b.body.leaveToken}`)
      .expect(200);
    expect(bStatus.body.position).toBe(1);
    expect(bStatus.body.peopleAhead).toBe(0);
    expect(bStatus.body.waitingCount).toBe(2);
    await request(ctx.app)
      .delete(`/api/vendor/test-demo-t7dn/customers/${c.body.customerId}`)
      .set('Cookie', cookie)
      .expect(200);
    await joinCustomer('Dee');
    await request(ctx.app)
      .delete('/api/vendor/test-demo-t7dn/customers')
      .set('Cookie', cookie)
      .expect(200);
    const state = await request(ctx.app)
      .get('/api/vendor/test-demo-t7dn')
      .set('Cookie', cookie)
      .expect(200);
    expect(state.body.waitingCount).toBe(0);
  });
});

describe('customer lifecycle', () => {
  it('validates name, phone and 200 character message boundary', async () => {
    await request(ctx.app)
      .post('/api/queues/test-demo-t7dn/join')
      .send({ name: '', message: 'x' })
      .expect(400);
    await request(ctx.app)
      .post('/api/queues/test-demo-t7dn/join')
      .send({ name: 'A', message: 'x'.repeat(201) })
      .expect(400);
    await request(ctx.app)
      .post('/api/queues/test-demo-t7dn/join')
      .send({ name: 'A', phone: 'not-a-phone' })
      .expect(400);
    await request(ctx.app)
      .post('/api/queues/test-demo-t7dn/join')
      .send({ name: 'A', actor: 'vendor_admin' })
      .expect(400);
    await request(ctx.app)
      .post('/api/queues/test-demo-t7dn/join')
      .send({ name: 'A', message: 'x'.repeat(200) })
      .expect(201);
  });
  it('uses opaque leave tokens and rejects forgery', async () => {
    const joined = await joinCustomer('Ada', 'Window seat');
    expect(joined.body.leaveToken).toMatch(/^[A-Za-z0-9_-]{32,}$/);
    await request(ctx.app)
      .delete('/api/queues/test-demo-t7dn/customers/me')
      .set('Authorization', 'Bearer forged-token')
      .expect(401);
    await request(ctx.app)
      .delete('/api/queues/test-demo-t7dn/customers/me')
      .set('Authorization', `Bearer ${joined.body.leaveToken}`)
      .expect(200);
    await request(ctx.app)
      .get(`/api/queues/test-demo-t7dn/status?token=${joined.body.leaveToken}`)
      .expect(404);
  });
});

describe('seed security and realtime', () => {
  it('seeds idempotently and stores no plaintext credentials', async () => {
    await ctx.close();
    ctx = await createApp({
      dbPath,
      sessionSecret: 'test-secret-at-least-32-characters!!',
      seedEmail: EMAIL,
      seedPhone: PHONE,
      secureCookie: true,
      rateLimit: false,
      superAdminKey: ADMIN_KEY,
    } as Parameters<typeof createApp>[0] & { superAdminKey: string });
    const db = new Database(dbPath, { readonly: true });
    expect(
      (
        db.prepare("SELECT count(*) count FROM queues WHERE slug='test-demo-t7dn'").get() as {
          count: number;
        }
      ).count,
    ).toBe(1);
    db.close();
    expect(readFileSync(dbPath).toString('latin1')).not.toContain(EMAIL);
    expect(readFileSync(dbPath).toString('latin1')).not.toContain(PHONE);
  });
  it('requires a valid customer token for SSE and exposes event-stream with heartbeat support', async () => {
    await request(ctx.app).get('/api/queues/test-demo-t7dn/events?token=forged').expect(401);
    const joined = await joinCustomer('Ada');
    const server = ctx.app.listen();
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('listen failed');
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/queues/test-demo-t7dn/events?token=${joined.body.leaveToken}`,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    if (!response.body) throw new Error('Expected an SSE response body');
    const reader = response.body.getReader();
    const first = await reader.read();
    expect(new TextDecoder().decode(first.value)).toContain('event: status');
    await reader.cancel();
    server.close();
  });
});

describe('super admin authentication and overview', () => {
  async function superAdminCookie() {
    const login = await request(ctx.app)
      .post('/api/super-admin/login')
      .send({ key: ADMIN_KEY })
      .expect(200);
    return login.headers['set-cookie'][0].split(';')[0] as string;
  }

  it('requires login and returns cross-queue totals after secure login', async () => {
    await request(ctx.app).get('/api/super-admin/overview').expect(401);
    await request(ctx.app).post('/api/super-admin/login').send({ key: 'wrong-key' }).expect(401);

    await joinCustomer('Ada');
    await joinCustomer('Ben');
    const admin = await superAdminCookie();
    const created = await request(ctx.app)
      .post('/api/queues')
      .set('Cookie', admin)
      .send({ businessName: 'Second Event', password: 'second-staff-password' })
      .expect(201);
    await joinCustomer('Cy', undefined, created.body.queueId);

    const login = await request(ctx.app)
      .post('/api/super-admin/login')
      .send({ key: ADMIN_KEY })
      .expect(200);
    expect(login.headers['set-cookie'][0]).toMatch(/qf_super_admin=/);
    expect(login.headers['set-cookie'][0]).toMatch(/HttpOnly/);
    expect(login.headers['set-cookie'][0]).toMatch(/Secure/);
    const cookie = login.headers['set-cookie'][0].split(';')[0];

    const overview = await request(ctx.app)
      .get('/api/super-admin/overview')
      .set('Cookie', cookie)
      .expect(200);
    expect(overview.body.summary).toMatchObject({
      queues: 2,
      waiting: 3,
      served: 0,
      totalCustomers: 3,
    });
    expect(overview.body.queues).toHaveLength(2);
    expect(overview.body.queues[0]).toMatchObject({
      queueId: expect.any(String),
      name: expect.any(String),
      waitingCount: expect.any(Number),
    });
  });

  it('preserves ended customers and exposes append-only audit history', async () => {
    const left = await joinCustomer('Left Customer');
    await request(ctx.app)
      .delete('/api/queues/test-demo-t7dn/customers/me')
      .set('Authorization', `Bearer ${left.body.leaveToken}`)
      .expect(200);

    const removed = await joinCustomer('Removed Customer');
    await joinCustomer('Served Customer');
    const { cookie: vendorCookie } = await unlock();
    await request(ctx.app)
      .delete(`/api/vendor/test-demo-t7dn/customers/${removed.body.customerId}`)
      .set('Cookie', vendorCookie)
      .expect(200);
    await request(ctx.app)
      .post('/api/vendor/test-demo-t7dn/serve-next')
      .set('Cookie', vendorCookie)
      .expect(200);

    const adminCookie = await superAdminCookie();
    const detail = await request(ctx.app)
      .get('/api/super-admin/queues/test-demo-t7dn')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(
      detail.body.customers.map((customer: { status: string }) => customer.status).sort(),
    ).toEqual(['left', 'removed', 'served']);
    expect(JSON.stringify(detail.body)).not.toContain('token_hash');

    const audit = await request(ctx.app)
      .get('/api/super-admin/audit?queueId=test-demo-t7dn')
      .set('Cookie', adminCookie)
      .expect(200);
    const actions = audit.body.events.map((event: { action: string }) => event.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'CUSTOMER_JOINED',
        'CUSTOMER_LEFT',
        'CUSTOMER_REMOVED',
        'CUSTOMER_SERVED',
      ]),
    );
    expect(audit.body.events[0]).toMatchObject({
      actorType: expect.any(String),
      createdAt: expect.any(String),
    });
  });
});
