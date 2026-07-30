import Database from 'better-sqlite3';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { createApp, publicErrorResponse, type AppContext } from '../src/app';
import { EventAssetError, removeEventLogo, storeEventLogo } from '../src/event-assets';
import type { AppRuntime } from '../src/runtime';
import { archiveEvent, updateEditableEvent } from '../src/routes/vendor-admin';
import type { QueueRow } from '../src/types';

const SESSION_SECRET = 'test-secret-that-is-longer-than-32-chars';
const ADMIN_KEY = 'admin-key';
const image = sharp({ create: { width: 16, height: 12, channels: 4, background: '#336699ff' } });
const PNG = await image.clone().png().toBuffer();
const JPEG = await image.clone().jpeg().toBuffer();
const WEBP = await image.clone().webp().toBuffer();
const contexts: AppContext[] = [];

afterEach(async () => {
  let context = contexts.pop();
  while (context) {
    await context.close();
    context = contexts.pop();
  }
});

describe('event branding persistence', () => {
  it('idempotently migrates legacy queues with nullable description and logo_path', async () => {
    const dbPath = `/tmp/nextq-branding-${process.pid}-${Date.now()}.sqlite`;
    const legacy = new Database(dbPath);
    legacy.exec(`CREATE TABLE queues (
      id INTEGER PRIMARY KEY, slug TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
      email_hash TEXT, phone_hash TEXT, password_hash TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      start_at TEXT, end_at TEXT, removed_at TEXT
    ); INSERT INTO queues(slug,name,start_at) VALUES('legacy','Legacy Event',CURRENT_TIMESTAMP)`);
    legacy.close();

    const options = {
      dbPath,
      sessionSecret: SESSION_SECRET,
      superAdminKey: ADMIN_KEY,
      secureCookie: false,
      rateLimit: false,
    } as const;
    const first = await createApp(options);
    contexts.push(first);
    const columns = first.db.prepare('PRAGMA table_info(queues)').all() as Array<{ name: string }>;
    expect(columns.map(column => column.name)).toEqual(
      expect.arrayContaining(['description', 'logo_path']),
    );
    expect(
      first.db.prepare('SELECT description,logo_path FROM queues WHERE slug=?').get('legacy'),
    ).toEqual({ description: null, logo_path: null });
    await first.close();
    contexts.pop();

    const second = await createApp(options);
    contexts.push(second);
    expect(
      second.db.prepare('SELECT count(*) AS count FROM queues WHERE slug=?').get('legacy'),
    ).toEqual({ count: 1 });
    await second.close();
    contexts.pop();
    unlinkSync(dbPath);
  });
});

describe('event branding API', () => {
  let context: AppContext;
  let root: string;
  let assetDir: string;
  let adminCookie: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), 'nextq-branding-api-'));
    assetDir = join(root, 'assets');
    const staticDir = join(root, 'static');
    mkdirSync(staticDir);
    writeFileSync(
      join(staticDir, 'index.html'),
      '<!doctype html><html><head><title>SPA</title></head><body></body></html>',
    );
    context = await createApp({
      dbPath: join(root, 'queue.sqlite'),
      assetDir,
      staticDir,
      publicOrigin: 'https://queue.example',
      sessionSecret: SESSION_SECRET,
      superAdminKey: ADMIN_KEY,
      secureCookie: false,
      rateLimit: false,
    });
    contexts.push(context);
    const login = await request(context.app)
      .post('/api/super-admin/login')
      .send({ key: ADMIN_KEY })
      .expect(200);
    adminCookie = login.headers['set-cookie'][0].split(';')[0] as string;
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  async function createEvent(description: string | null = '歡迎來到品牌活動') {
    return request(context.app)
      .post('/api/queues')
      .set('Cookie', adminCookie)
      .send({
        businessName: 'Brand Event',
        password: 'staff-password',
        description,
      })
      .expect(201);
  }

  it('uses strict 500-character description DTOs and exposes branding to every audience', async () => {
    await request(context.app)
      .post('/api/queues')
      .set('Cookie', adminCookie)
      .send({
        businessName: 'Too Long',
        password: 'staff-password',
        description: 'x'.repeat(501),
      })
      .expect(400);
    await request(context.app)
      .post('/api/queues')
      .set('Cookie', adminCookie)
      .send({
        businessName: 'Unknown',
        password: 'staff-password',
        description: 'ok',
        logoUrl: '/injected',
      })
      .expect(400);

    const created = await createEvent('x'.repeat(500));
    expect(created.body).toMatchObject({ description: 'x'.repeat(500), logoUrl: null });
    const slug = created.body.queueId as string;

    await request(context.app)
      .patch(`/api/super-admin/queues/${slug}`)
      .set('Cookie', adminCookie)
      .send({ description: 'x'.repeat(501) })
      .expect(400);
    const edited = await request(context.app)
      .patch(`/api/super-admin/queues/${slug}`)
      .set('Cookie', adminCookie)
      .send({ description: '  新活動介紹  ' })
      .expect(200);
    expect(edited.body).toMatchObject({ description: '新活動介紹', logoUrl: null });

    const publicView = await request(context.app).get(`/api/queues/${slug}`).expect(200);
    expect(publicView.body).toMatchObject({ description: '新活動介紹', logoUrl: null });
    const unlock = await request(context.app)
      .post(`/api/queues/${slug}/unlock`)
      .send({ credential: 'staff-password' })
      .expect(200);
    const staffCookie = unlock.headers['set-cookie'][0].split(';')[0] as string;
    const staffView = await request(context.app)
      .get(`/api/vendor/${slug}`)
      .set('Cookie', staffCookie)
      .expect(200);
    expect(staffView.body).toMatchObject({ description: '新活動介紹', logoUrl: null });
    const detail = await request(context.app)
      .get(`/api/super-admin/queues/${slug}`)
      .set('Cookie', adminCookie)
      .expect(200);
    expect(detail.body.queue).toMatchObject({ description: '新活動介紹', logoUrl: null });
    const overview = await request(context.app)
      .get('/api/super-admin/overview')
      .set('Cookie', adminCookie)
      .expect(200);
    expect(overview.body.queues[0]).toMatchObject({ description: '新活動介紹', logoUrl: null });
  });

  it('fully decodes authenticated PNG/JPEG/WebP bodies and enforces declared format, size, and dimensions', async () => {
    const created = await createEvent();
    const slug = created.body.queueId as string;
    await request(context.app)
      .put(`/api/super-admin/queues/${slug}/logo`)
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(401);
    await request(context.app)
      .put(`/api/super-admin/queues/${slug}/logo`)
      .set('Cookie', adminCookie)
      .set('Content-Type', 'text/plain')
      .send(PNG)
      .expect(415);
    await request(context.app)
      .put(`/api/super-admin/queues/${slug}/logo`)
      .set('Cookie', adminCookie)
      .set('Content-Type', 'image/png')
      .send(JPEG)
      .expect(415);
    await request(context.app)
      .put(`/api/super-admin/queues/${slug}/logo`)
      .set('Cookie', adminCookie)
      .set('Content-Type', 'image/png')
      .send(Buffer.alloc(2 * 1024 * 1024 + 1, 0))
      .expect(413);
    await request(context.app)
      .put(`/api/super-admin/queues/${slug}/logo`)
      .set('Cookie', adminCookie)
      .set('Content-Type', 'image/png')
      .send(PNG.subarray(0, PNG.length - 8))
      .expect(415);
    await request(context.app)
      .put(`/api/super-admin/queues/${slug}/logo`)
      .set('Cookie', adminCookie)
      .set('Content-Type', 'image/png')
      .send(Buffer.concat([PNG, Buffer.from('<script>polyglot</script>')]))
      .expect(415);
    const corrupted = Buffer.from(PNG);
    const idatOffset = corrupted.indexOf(Buffer.from('IDAT'));
    corrupted[idatOffset + 8] ^= 0xff;
    await request(context.app)
      .put(`/api/super-admin/queues/${slug}/logo`)
      .set('Cookie', adminCookie)
      .set('Content-Type', 'image/png')
      .send(corrupted)
      .expect(415);
    const decodeJpeg = await sharp({
      create: { width: 32, height: 32, channels: 3, background: '#ea641e' },
    })
      .jpeg()
      .toBuffer();
    const jpegScanOffset = decodeJpeg.indexOf(Buffer.from([0xff, 0xda]));
    const truncatedJpegScan = Buffer.concat([
      decodeJpeg.subarray(0, jpegScanOffset + 16),
      Buffer.from([0xff, 0xd9]),
    ]);
    await request(context.app)
      .put(`/api/super-admin/queues/${slug}/logo`)
      .set('Cookie', adminCookie)
      .set('Content-Type', 'image/jpeg')
      .send(truncatedJpegScan)
      .expect(415);
    const animatedWebp = Buffer.from(
      'UklGRt4AAABXRUJQVlA4WAoAAAACAAAAHwAAHwAAQU5JTQYAAAD/////AABBTk1GWAAAAAAAAAAAAB8AAB8AAOgDAAJWUDggQAAAAFADAJ0BKiAAIAA+kUKcSiWjoqGoCACwEgllAMaqgABAURwAAP7u09/+47A3Xi3/+5wP+5wP+5wP42ykJ2cKAABBTk1GUgAAAAAAAAAAAB8AAB8AAOgDAABWUDggOgAAAJQCAJ0BKiAAIAA+kUKcSgKAgAABIJZQDMHBapagAP71WL//ucD//ZwP/9nA/jr/Xqlrk44Cy3gAAAA=',
      'base64',
    );
    const corruptSecondFrame = Buffer.from(animatedWebp);
    corruptSecondFrame[182] = 0xff;
    await request(context.app)
      .put(`/api/super-admin/queues/${slug}/logo`)
      .set('Cookie', adminCookie)
      .set('Content-Type', 'image/webp')
      .send(corruptSecondFrame)
      .expect(415);
    const tooWide = await sharp({
      create: { width: 4097, height: 1, channels: 3, background: '#fff' },
    })
      .png()
      .toBuffer();
    await request(context.app)
      .put(`/api/super-admin/queues/${slug}/logo`)
      .set('Cookie', adminCookie)
      .set('Content-Type', 'image/png')
      .send(tooWide)
      .expect(413);

    const uploaded = await request(context.app)
      .put(`/api/super-admin/queues/${slug}/logo`)
      .set('Cookie', adminCookie)
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(200);
    expect(uploaded.body.logoUrl).toMatch(/^\/event-assets\/[a-f0-9]{32}\.png$/);
    expect(readdirSync(assetDir)).toHaveLength(1);
    const served = await request(context.app).get(uploaded.body.logoUrl).expect(200);
    expect(served.headers['content-type']).toContain('image/png');
    expect(served.body).toEqual(PNG);
    await request(context.app).put(uploaded.body.logoUrl).send(PNG).expect(404);

    for (const [mime, bytes, extension] of [
      ['image/jpeg', JPEG, '.jpg'],
      ['image/webp', WEBP, '.webp'],
    ] as const) {
      const replaced = await request(context.app)
        .put(`/api/super-admin/queues/${slug}/logo`)
        .set('Cookie', adminCookie)
        .set('Content-Type', mime)
        .send(bytes)
        .expect(200);
      expect(replaced.body.logoUrl).toMatch(new RegExp(`${extension.replace('.', '\\.')}$`));
    }
  });

  it('returns 404 when a database-referenced asset is missing from disk', async () => {
    const created = await createEvent();
    const uploaded = await request(context.app)
      .put(`/api/super-admin/queues/${created.body.queueId}/logo`)
      .set('Cookie', adminCookie)
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(200);
    const filename = uploaded.body.logoUrl.split('/').pop() as string;
    unlinkSync(join(assetDir, filename));

    expect(
      context.db.prepare('SELECT logo_path FROM queues WHERE slug=?').get(created.body.queueId),
    ).toEqual({ logo_path: filename });
    const missing = await request(context.app).get(uploaded.body.logoUrl).expect(404);
    expect(missing.headers['cache-control']).toBe('no-store');
    const stale = await request(context.app)
      .get('/event-assets/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png')
      .expect(404);
    expect(stale.headers['cache-control']).toBe('no-store');
    await request(context.app)
      .get('/event-assets/not-generated.png')
      .expect(404)
      .expect(({ headers }) => expect(headers['cache-control']).toBe('no-store'));
    await request(context.app)
      .get('/event-assets/')
      .expect(404)
      .expect(({ headers }) => expect(headers['cache-control']).toBe('no-store'));
    await request(context.app)
      .get('/event-assets/foo/bar')
      .expect(404)
      .expect(({ headers }) => expect(headers['cache-control']).toBe('no-store'));
  });

  it('safely replaces and removes logos, audits no bytes, and blocks archived mutation', async () => {
    const created = await createEvent();
    const slug = created.body.queueId as string;
    const first = await request(context.app)
      .put(`/api/super-admin/queues/${slug}/logo`)
      .set('Cookie', adminCookie)
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(200);
    const firstFile = join(assetDir, first.body.logoUrl.split('/').pop());
    expect(existsSync(firstFile)).toBe(true);

    const second = await request(context.app)
      .put(`/api/super-admin/queues/${slug}/logo`)
      .set('Cookie', adminCookie)
      .set('Content-Type', 'image/jpeg')
      .send(JPEG)
      .expect(200);
    expect(second.body.logoUrl).toMatch(/\.jpg$/);
    expect(existsSync(firstFile)).toBe(false);
    await request(context.app).get(first.body.logoUrl).expect(404);
    expect(readdirSync(assetDir)).toHaveLength(1);

    await request(context.app)
      .delete(`/api/super-admin/queues/${slug}/logo`)
      .set('Cookie', adminCookie)
      .expect(200)
      .expect(({ body }) => expect(body.logoUrl).toBeNull());
    expect(readdirSync(assetDir)).toHaveLength(0);
    await request(context.app).get(second.body.logoUrl).expect(404);
    await request(context.app)
      .delete(`/api/super-admin/queues/${slug}/logo`)
      .set('Cookie', adminCookie)
      .expect(200);

    const auditRows = context.db
      .prepare(
        "SELECT action,metadata_json FROM audit_logs WHERE action IN ('EVENT_LOGO_UPLOADED','EVENT_LOGO_REMOVED') ORDER BY id",
      )
      .all() as Array<{ action: string; metadata_json: string }>;
    expect(auditRows.map(row => row.action)).toEqual([
      'EVENT_LOGO_UPLOADED',
      'EVENT_LOGO_UPLOADED',
      'EVENT_LOGO_REMOVED',
    ]);
    expect(
      auditRows.every(
        row =>
          !row.metadata_json.includes(PNG.toString('base64')) &&
          !row.metadata_json.includes(JPEG.toString('base64')),
      ),
    ).toBe(true);

    await request(context.app)
      .delete(`/api/super-admin/queues/${slug}`)
      .set('Cookie', adminCookie)
      .send({ confirmationName: 'Brand Event' })
      .expect(200);
    await request(context.app)
      .patch(`/api/super-admin/queues/${slug}`)
      .set('Cookie', adminCookie)
      .send({ description: 'blocked' })
      .expect(409);
    await request(context.app)
      .put(`/api/super-admin/queues/${slug}/logo`)
      .set('Cookie', adminCookie)
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(409);
    await request(context.app)
      .delete(`/api/super-admin/queues/${slug}/logo`)
      .set('Cookie', adminCookie)
      .expect(409);
    expect(readFileSync(join(root, 'queue.sqlite')).toString('latin1')).not.toContain(
      PNG.toString('latin1'),
    );
  });

  it('uses logo-path CAS so a stale concurrent snapshot cannot replace the winner or publish its file', async () => {
    const created = await createEvent();
    const stale = context.db
      .prepare('SELECT * FROM queues WHERE slug=?')
      .get(created.body.queueId) as QueueRow;
    const runtime = { db: context.db, assetDir } as AppRuntime;

    const winner = await storeEventLogo(runtime, stale, PNG, 'image/png');
    await expect(storeEventLogo(runtime, stale, JPEG, 'image/jpeg')).rejects.toMatchObject({
      status: 409,
      code: 'EVENT_ASSET_CONFLICT',
    });
    expect(() => removeEventLogo(runtime, stale)).toThrowError(
      expect.objectContaining({ status: 409, code: 'EVENT_ASSET_CONFLICT' }),
    );

    expect(context.db.prepare('SELECT logo_path FROM queues WHERE id=?').get(stale.id)).toEqual({
      logo_path: winner,
    });
    expect(readdirSync(assetDir)).toEqual([winner]);
  });

  it('reconciles generated orphan and temporary files on startup while retaining referenced assets', async () => {
    const created = await createEvent();
    const slug = created.body.queueId as string;
    const uploaded = await request(context.app)
      .put(`/api/super-admin/queues/${slug}/logo`)
      .set('Cookie', adminCookie)
      .set('Content-Type', 'image/png')
      .send(PNG)
      .expect(200);
    const referenced = uploaded.body.logoUrl.split('/').pop() as string;
    const orphan = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.png';
    const temporary = '.bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.jpg.tmp';
    writeFileSync(join(assetDir, orphan), PNG);
    writeFileSync(join(assetDir, temporary), JPEG);

    await context.close();
    contexts.pop();
    context = await createApp({
      dbPath: join(root, 'queue.sqlite'),
      assetDir,
      sessionSecret: SESSION_SECRET,
      superAdminKey: ADMIN_KEY,
      secureCookie: false,
      rateLimit: false,
    });
    contexts.push(context);

    expect(readdirSync(assetDir)).toEqual([referenced]);
    await request(context.app).get(`/event-assets/${orphan}`).expect(404);
  });

  it('rejects stale pre-archive metadata and logo mutations with a typed conflict', async () => {
    const created = await createEvent();
    const stale = context.db
      .prepare('SELECT * FROM queues WHERE slug=?')
      .get(created.body.queueId) as QueueRow;
    context.db
      .prepare('UPDATE queues SET removed_at=? WHERE id=?')
      .run(new Date().toISOString(), stale.id);

    expect(() =>
      updateEditableEvent(context.db, stale, {
        name: 'Must not persist',
        description: stale.description,
        startAt: stale.start_at,
        endAt: stale.end_at,
        passwordHash: null,
      }),
    ).toThrowError(expect.objectContaining({ status: 409, code: 'EVENT_ARCHIVED' }));
    await expect(
      storeEventLogo({ db: context.db, assetDir } as AppRuntime, stale, PNG, 'image/png'),
    ).rejects.toMatchObject({ status: 409, code: 'EVENT_ARCHIVED' });
    expect(
      context.db.prepare('SELECT name,logo_path FROM queues WHERE id=?').get(stale.id),
    ).toEqual({ name: 'Brand Event', logo_path: null });
  });

  it('lets only one connection archive a stale event snapshot without duplicate side effects', async () => {
    const created = await createEvent();
    const slug = created.body.queueId as string;
    await request(context.app)
      .post(`/api/queues/${slug}/join`)
      .send({ name: 'Still waiting' })
      .expect(201);
    const stale = context.db.prepare('SELECT * FROM queues WHERE slug=?').get(slug) as QueueRow;
    const competitor = new Database(join(root, 'queue.sqlite'));
    competitor
      .prepare('UPDATE queues SET removed_at=? WHERE id=? AND removed_at IS NULL')
      .run('2026-07-29T10:00:00.000Z', stale.id);
    competitor.close();
    let auditCalls = 0;

    expect(() =>
      archiveEvent(context.db, stale.id, '2026-07-29T10:00:01.000Z', () => {
        auditCalls += 1;
      }),
    ).toThrowError(expect.objectContaining({ status: 409, code: 'EVENT_ALREADY_ARCHIVED' }));

    expect(auditCalls).toBe(0);
    expect(context.db.prepare('SELECT removed_at FROM queues WHERE id=?').get(stale.id)).toEqual({
      removed_at: '2026-07-29T10:00:00.000Z',
    });
    expect(
      context.db
        .prepare('SELECT status,ended_at,ended_reason FROM customers WHERE queue_id=?')
        .get(stale.id),
    ).toEqual({ status: 'waiting', ended_at: null, ended_reason: null });
    expect(
      context.db
        .prepare(
          "SELECT count(*) AS count FROM audit_logs WHERE queue_id=? AND action='EVENT_ARCHIVED'",
        )
        .get(stale.id),
    ).toEqual({ count: 0 });
  });
});

describe('safe error responses', () => {
  it('keeps unknown status-bearing errors opaque and exposes only typed event asset errors', () => {
    expect(
      publicErrorResponse(Object.assign(new Error('database secret'), { status: 409 })),
    ).toEqual({ status: 500, body: { error: 'Internal server error' } });
    expect(publicErrorResponse(new RangeError('secret internal range detail'))).toEqual({
      status: 500,
      body: { error: 'Internal server error' },
    });
    expect(
      publicErrorResponse(
        new EventAssetError(415, 'INVALID_IMAGE', 'Image content does not match its media type'),
      ),
    ).toEqual({
      status: 415,
      body: { error: 'Image content does not match its media type', code: 'INVALID_IMAGE' },
    });
    expect(publicErrorResponse(new SyntaxError('Unexpected token with private input'))).toEqual({
      status: 400,
      body: { error: 'Invalid JSON' },
    });
  });

  it('does not misclassify an oversized JSON body as an image upload error', async () => {
    const context = await createApp({
      dbPath: ':memory:',
      sessionSecret: SESSION_SECRET,
      superAdminKey: ADMIN_KEY,
      secureCookie: false,
      rateLimit: false,
    });
    contexts.push(context);
    const response = await request(context.app)
      .post('/api/super-admin/login')
      .send({ key: 'x'.repeat(33 * 1024) })
      .expect(413);
    expect(response.body).toEqual({ error: 'Request body too large' });
  });
});
