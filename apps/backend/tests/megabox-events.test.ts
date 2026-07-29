import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp, type AppContext } from '../src/app';

const ADMIN_KEY = 'megabox-vendor-admin-key';
const STAFF_PASSWORD = 'megabox-staff-password';

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const result = await Promise.race([
    reader.read(),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('SSE read timeout')), 2_000),
    ),
  ]);
  return new TextDecoder().decode(result.value);
}

describe('MEGABOX event ownership and notification contract', () => {
  let context: AppContext;

  beforeEach(async () => {
    context = await createApp({
      dbPath: ':memory:',
      sessionSecret: 'megabox-test-session-secret-over-32-chars',
      superAdminKey: ADMIN_KEY,
      secureCookie: false,
      rateLimit: false,
    });
  });

  afterEach(async () => context.close());

  async function vendorAdminCookie() {
    const login = await request(context.app)
      .post('/api/super-admin/login')
      .send({ key: ADMIN_KEY })
      .expect(200);
    return login.headers['set-cookie'][0].split(';')[0] as string;
  }

  async function createEvent(overrides: Record<string, unknown> = {}) {
    const cookie = await vendorAdminCookie();
    const response = await request(context.app)
      .post('/api/queues')
      .set('Cookie', cookie)
      .send({
        businessName: 'MEGABOX Summer Event',
        password: STAFF_PASSWORD,
        startMode: 'now',
        ...overrides,
      })
      .expect(201);
    return { cookie, eventId: response.body.queueId as string };
  }

  it('blocks public event creation and allows only the vendor admin to create, edit, view and archive', async () => {
    await request(context.app)
      .post('/api/queues')
      .send({ businessName: 'Public Event', password: STAFF_PASSWORD })
      .expect(401);

    const { cookie, eventId } = await createEvent();

    await request(context.app)
      .patch(`/api/super-admin/queues/${eventId}`)
      .send({ name: 'Unauthorized Rename' })
      .expect(401);

    const edited = await request(context.app)
      .patch(`/api/super-admin/queues/${eventId}`)
      .set('Cookie', cookie)
      .send({ name: 'MEGABOX Weekend Event' })
      .expect(200);
    expect(edited.body).toMatchObject({ name: 'MEGABOX Weekend Event' });

    const detail = await request(context.app)
      .get(`/api/super-admin/queues/${eventId}`)
      .set('Cookie', cookie)
      .expect(200);
    expect(detail.body.queue.name).toBe('MEGABOX Weekend Event');

    await request(context.app)
      .delete(`/api/super-admin/queues/${eventId}`)
      .set('Cookie', cookie)
      .send({ confirmationName: 'MEGABOX Weekend Event' })
      .expect(200);

    await request(context.app).get(`/api/queues/${eventId}`).expect(404);
  });

  it('allows the client admin to operate an existing event but not manage its lifecycle', async () => {
    const { eventId } = await createEvent();
    const unlock = await request(context.app)
      .post(`/api/queues/${eventId}/unlock`)
      .send({ credential: STAFF_PASSWORD })
      .expect(200);
    const clientCookie = unlock.headers['set-cookie'][0].split(';')[0] as string;

    const customer = await request(context.app)
      .post(`/api/queues/${eventId}/join`)
      .send({ name: 'Alan' })
      .expect(201);

    await request(context.app)
      .post(`/api/vendor/${eventId}/serve-next`)
      .set('Cookie', clientCookie)
      .expect(200);

    await request(context.app)
      .get(`/api/queues/${eventId}/status`)
      .query({ token: customer.body.leaveToken })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('served'));

    await request(context.app)
      .patch(`/api/super-admin/queues/${eventId}`)
      .set('Cookie', clientCookie)
      .send({ name: 'Client Rename' })
      .expect(401);
  });

  it('rejects moving an active event back to scheduled and keeps waiting tickets usable', async () => {
    const { cookie, eventId } = await createEvent();
    const joined = await request(context.app)
      .post(`/api/queues/${eventId}/join`)
      .send({ name: 'Waiting customer' })
      .expect(201);

    await request(context.app)
      .patch(`/api/super-admin/queues/${eventId}`)
      .set('Cookie', cookie)
      .send({ startLocal: '2099-01-01T09:00' })
      .expect(409)
      .expect(({ body }) => expect(body.code).toBe('EVENT_ACTIVE_CANNOT_BE_RESCHEDULED'));

    await request(context.app)
      .get(`/api/queues/${eventId}/status`)
      .query({ token: joined.body.leaveToken })
      .expect(200)
      .expect(({ body }) => expect(body.status).toBe('waiting'));
  });

  it('closes live customer streams and finalizes waiting tickets when an edit ends the event', async () => {
    const { cookie, eventId } = await createEvent({
      startMode: 'scheduled',
      startLocal: '2026-07-01T09:00',
    });
    const joined = await request(context.app)
      .post(`/api/queues/${eventId}/join`)
      .send({ name: 'Waiting customer' })
      .expect(201);
    const server = context.app.listen();
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('listen failed');
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/queues/${eventId}/events?token=${joined.body.leaveToken}`,
    );
    if (!response.body) throw new Error('Expected an SSE response body');
    const reader = response.body.getReader();
    await readChunk(reader);

    const edited = await request(context.app)
      .patch(`/api/super-admin/queues/${eventId}`)
      .set('Cookie', cookie)
      .send({ endDate: '2026-07-02' })
      .expect(200);
    expect(edited.body.lifecycleStatus).toBe('ended');

    const ended = await readChunk(reader);
    expect(ended).toContain('event: queue_ended');
    expect(ended).toContain('QUEUE_ENDED');
    const ticket = context.db
      .prepare('SELECT status,ended_reason FROM customers WHERE id=?')
      .get(joined.body.customerId) as Record<string, string>;
    expect(ticket).toEqual({ status: 'removed', ended_reason: 'queue_period_ended' });
    await reader.cancel();
    server.close();
  });

  it('emits only the queue.called event notification with the required five-minute message', async () => {
    const { eventId } = await createEvent();
    const unlock = await request(context.app)
      .post(`/api/queues/${eventId}/unlock`)
      .send({ credential: STAFF_PASSWORD })
      .expect(200);
    const clientCookie = unlock.headers['set-cookie'][0].split(';')[0] as string;
    const joined = await request(context.app)
      .post(`/api/queues/${eventId}/join`)
      .send({ name: 'Momo' })
      .expect(201);

    const server = context.app.listen();
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('listen failed');
    const response = await fetch(
      `http://127.0.0.1:${address.port}/api/queues/${eventId}/events?token=${joined.body.leaveToken}`,
    );
    if (!response.body) throw new Error('Expected an SSE response body');
    const reader = response.body.getReader();
    await readChunk(reader); // initial status snapshot

    await request(context.app)
      .post(`/api/vendor/${eventId}/serve-next`)
      .set('Cookie', clientCookie)
      .expect(200);

    const called = await readChunk(reader);
    expect(called).toContain('event: queue.called');
    expect(called).toContain('現正輪到你，請於5分鐘到回到活動場地入場');
    expect(called).not.toContain('event: update');
    await reader.cancel();
    await request(context.app)
      .get(`/api/queues/${eventId}/events`)
      .query({ token: joined.body.leaveToken })
      .expect(204);
    server.close();
  });
});
