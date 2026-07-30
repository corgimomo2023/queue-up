import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp, type AppContext } from '../src/app';
import { assertInjectableShareTemplate } from '../src/social-preview';

const SESSION_SECRET = 'social-preview-test-session-secret-is-long-enough';
const ADMIN_KEY = 'social-preview-test-admin-key-is-long-enough';

const SPA_TEMPLATE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="description" content="Easy Queue event queue" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <title>Easy Queue</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/app.js"></script>
  </body>
</html>`;

describe('share template validation', () => {
  it('requires exactly one closing head tag', () => {
    expect(() => assertInjectableShareTemplate('<html><body></body></html>')).toThrow(
      'exactly one closing head tag',
    );
    expect(() => assertInjectableShareTemplate('<html><head></HEAD><head></head></html>')).toThrow(
      'exactly one closing head tag',
    );
    expect(() => assertInjectableShareTemplate('<html><head></HEAD></html>')).not.toThrow();
  });
});

describe('event social previews', () => {
  let context: AppContext;
  let root: string;
  let adminCookie: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'easy-queue-social-preview-'));
    const staticDir = join(root, 'static');
    mkdirSync(staticDir);
    writeFileSync(join(staticDir, 'index.html'), SPA_TEMPLATE);
    context = await createApp({
      dbPath: join(root, 'queue.sqlite'),
      staticDir,
      publicOrigin: 'https://public.queue.example',
      assetDir: join(root, 'assets'),
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

  afterEach(async () => {
    await context.close();
    rmSync(root, { recursive: true, force: true });
  });

  async function createEvent(
    businessName = 'Summer & Fun <2026>',
    description: string | null = 'Walk in, shop & enjoy <today>.',
  ) {
    return request(context.app)
      .post('/api/queues')
      .set('Cookie', adminCookie)
      .send({ businessName, password: 'staff-password', description })
      .expect(201);
  }

  it('serves event Open Graph metadata in the first customer-page response', async () => {
    const created = await createEvent();
    const slug = created.body.queueId as string;
    context.db
      .prepare('UPDATE queues SET logo_path = ? WHERE slug = ?')
      .run('event-logo.png', slug);

    const response = await request(context.app)
      .get(`/q/${slug}`)
      .set('Host', 'attacker.example:9443')
      .set('X-Forwarded-Proto', 'javascript')
      .expect('Content-Type', /html/)
      .expect(200);

    expect(response.headers['cache-control']).toBe('no-cache');
    expect(response.text).toContain('<title>Summer &amp; Fun &lt;2026&gt; | Easy Queue</title>');
    expect(response.text).toContain(
      '<meta property="og:title" content="Summer &amp; Fun &lt;2026&gt; | Easy Queue" />',
    );
    expect(response.text).toContain(
      '<meta property="og:description" content="Walk in, shop &amp; enjoy &lt;today&gt;." />',
    );
    expect(response.text).toContain(
      `<meta property="og:image" content="https://public.queue.example/event-assets/event-logo.png" />`,
    );
    expect(response.text).toContain(
      `<meta property="og:url" content="https://public.queue.example/q/${slug}" />`,
    );
    expect(response.text).toContain(
      `<link rel="canonical" href="https://public.queue.example/q/${slug}" />`,
    );
    expect(response.text).toContain(
      `<link rel="manifest" href="/q/${slug}/manifest.webmanifest" />`,
    );
    expect(response.text).toContain('<script type="module" src="/assets/app.js"></script>');
    expect(response.text).not.toContain('Walk in, shop & enjoy <today>.');
    expect(response.text).not.toContain('attacker.example');
    expect(response.text).not.toContain('javascript://');
  });

  it('serves an event-specific install manifest with a useful fallback description', async () => {
    const created = await createEvent('Quiet Event', null);
    const slug = created.body.queueId as string;

    const response = await request(context.app)
      .get(`/q/${slug}/manifest.webmanifest`)
      .expect('Content-Type', /manifest\+json/)
      .expect(200);

    expect(response.body).toMatchObject({
      id: `/q/${slug}`,
      name: 'Quiet Event | Easy Queue',
      short_name: 'Quiet Event',
      description: 'Join the queue for Quiet Event with Easy Queue.',
      start_url: `/q/${slug}`,
      display: 'standalone',
      background_color: '#fffaf5',
      theme_color: '#ea641e',
    });
    expect(response.body.icons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ src: '/favicon-512.png', sizes: '512x512' }),
      ]),
    );
  });

  it('does not expose metadata for archived events', async () => {
    const created = await createEvent('Private Archived Event', 'Must not appear');
    const slug = created.body.queueId as string;
    context.db
      .prepare('UPDATE queues SET removed_at = ? WHERE slug = ?')
      .run(new Date().toISOString(), slug);

    const page = await request(context.app).get(`/q/${slug}`).expect(404);
    expect(page.text).not.toContain('Private Archived Event');
    expect(page.text).not.toContain('Must not appear');

    await request(context.app).get(`/q/${slug}/manifest.webmanifest`).expect(404);
  });
});
