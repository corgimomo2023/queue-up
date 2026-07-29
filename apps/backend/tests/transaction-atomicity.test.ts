import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type AppContext } from '../src/app';

const SESSION_SECRET = 'transaction-test-secret-at-least-32-characters';
const ADMIN_KEY = 'transaction-test-admin-key-at-least-32-characters';

describe('transactional command atomicity', () => {
  let context: AppContext;
  let adminCookie: string;

  beforeEach(async () => {
    context = await createApp({
      dbPath: ':memory:',
      sessionSecret: SESSION_SECRET,
      superAdminKey: ADMIN_KEY,
      secureCookie: false,
      rateLimit: false,
    });
    const login = await request(context.app)
      .post('/api/super-admin/login')
      .send({ key: ADMIN_KEY })
      .expect(200);
    adminCookie = login.headers['set-cookie'][0].split(';')[0] as string;
  });

  afterEach(async () => context.close());

  async function createEvent(name: string): Promise<string> {
    const response = await request(context.app)
      .post('/api/queues')
      .set('Cookie', adminCookie)
      .send({ businessName: name, password: 'transaction-staff-password' })
      .expect(201);
    return response.body.queueId as string;
  }

  it('rolls back a customer join when its audit record cannot be written', async () => {
    const slug = await createEvent('Atomic Join');
    context.db.exec('DROP TABLE audit_logs');

    await request(context.app)
      .post(`/api/queues/${slug}/join`)
      .send({ name: 'Rollback Customer' })
      .expect(500);

    expect(context.db.prepare('SELECT COUNT(*) AS count FROM customers').get()).toEqual({
      count: 0,
    });
  });

  it('rolls back event archival and customer finalization when auditing fails', async () => {
    const slug = await createEvent('Atomic Archive');
    const joined = await request(context.app)
      .post(`/api/queues/${slug}/join`)
      .send({ name: 'Still Waiting' })
      .expect(201);
    context.db.exec('DROP TABLE audit_logs');

    await request(context.app)
      .delete(`/api/super-admin/queues/${slug}`)
      .set('Cookie', adminCookie)
      .send({ confirmationName: 'Atomic Archive' })
      .expect(500);

    expect(context.db.prepare('SELECT removed_at FROM queues WHERE slug=?').get(slug)).toEqual({
      removed_at: null,
    });
    expect(
      context.db
        .prepare('SELECT status,ended_at,ended_reason FROM customers WHERE id=?')
        .get(joined.body.customerId),
    ).toEqual({ status: 'waiting', ended_at: null, ended_reason: null });
  });
});
