import { afterEach, beforeEach, describe, it } from 'vitest';
import request from 'supertest';
import { createApp, type AppContext } from '../src/app';

const VENDOR_ADMIN_KEY = 'vendor-admin-key-over-thirty-two-characters';
const STAFF_PASSWORD = 'event-bound-staff-password';

describe('actor and event access boundaries', () => {
  let context: AppContext;
  let vendorCookie: string;
  let firstEvent: string;
  let secondEvent: string;
  let firstStaffCookie: string;

  beforeEach(async () => {
    context = await createApp({
      dbPath: ':memory:',
      sessionSecret: 'actor-boundary-test-secret-over-32-chars',
      superAdminKey: VENDOR_ADMIN_KEY,
      secureCookie: false,
      rateLimit: false,
    });
    const login = await request(context.app)
      .post('/api/super-admin/login')
      .send({ key: VENDOR_ADMIN_KEY })
      .expect(200);
    vendorCookie = login.headers['set-cookie'][0].split(';')[0] as string;

    const first = await request(context.app)
      .post('/api/queues')
      .set('Cookie', vendorCookie)
      .send({ businessName: 'First Event', password: STAFF_PASSWORD, startMode: 'now' })
      .expect(201);
    const second = await request(context.app)
      .post('/api/queues')
      .set('Cookie', vendorCookie)
      .send({ businessName: 'Second Event', password: STAFF_PASSWORD, startMode: 'now' })
      .expect(201);
    firstEvent = first.body.queueId as string;
    secondEvent = second.body.queueId as string;

    const staffLogin = await request(context.app)
      .post(`/api/queues/${firstEvent}/unlock`)
      .send({ credential: STAFF_PASSWORD })
      .expect(200);
    firstStaffCookie = staffLogin.headers['set-cookie'][0].split(';')[0] as string;
  });

  afterEach(async () => context.close());

  it('keeps Vendor Admin and Staff Admin sessions in separate actor scopes', async () => {
    await request(context.app)
      .get('/api/super-admin/overview')
      .set('Cookie', firstStaffCookie)
      .expect(401);
    await request(context.app)
      .get(`/api/vendor/${firstEvent}`)
      .set('Cookie', vendorCookie)
      .expect(401);
  });

  it('binds Staff Admin sessions to exactly one event', async () => {
    await request(context.app)
      .get(`/api/vendor/${secondEvent}`)
      .set('Cookie', firstStaffCookie)
      .expect(401);
    await request(context.app)
      .post(`/api/vendor/${secondEvent}/serve-next`)
      .set('Cookie', firstStaffCookie)
      .expect(401);
  });

  it('preserves exact password bytes when Vendor Admin resets a Staff Admin password', async () => {
    const exactPassword = ' reset-password-with-spaces ';
    await request(context.app)
      .patch(`/api/super-admin/queues/${firstEvent}`)
      .set('Cookie', vendorCookie)
      .send({ password: exactPassword })
      .expect(200);

    await request(context.app)
      .post(`/api/queues/${firstEvent}/unlock`)
      .send({ credential: exactPassword })
      .expect(200);
    await request(context.app)
      .post(`/api/queues/${firstEvent}/unlock`)
      .send({ credential: exactPassword.trim() })
      .expect(401);
  });

  it('binds customer tokens to exactly one event and actor action', async () => {
    const joined = await request(context.app)
      .post(`/api/queues/${secondEvent}/join`)
      .send({ name: 'Bound Customer' })
      .expect(201);
    const token = joined.body.leaveToken as string;

    await request(context.app).get(`/api/queues/${firstEvent}/status`).query({ token }).expect(404);
    await request(context.app)
      .delete(`/api/queues/${firstEvent}/customers/me`)
      .set('Authorization', `Bearer ${token}`)
      .expect(401);
    await request(context.app)
      .get(`/api/queues/${secondEvent}/status`)
      .query({ token })
      .expect(200);
  });
});
