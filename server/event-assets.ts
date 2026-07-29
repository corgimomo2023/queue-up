import crypto from 'node:crypto';
import { readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import express, { type RequestHandler } from 'express';
import sharp from 'sharp';
import type { AppRuntime } from './runtime.js';
import type { QueueRow } from './types.js';

const MAX_LOGO_BYTES = 2 * 1024 * 1024;
const MAX_LOGO_DIMENSION = 4096;
const MAX_LOGO_PIXELS = MAX_LOGO_DIMENSION * MAX_LOGO_DIMENSION;
const generatedAsset = /^[a-f0-9]{32}\.(?:png|jpg|webp)$/;
const temporaryAsset = /^\.[a-f0-9]{32}\.(?:png|jpg|webp)\.tmp$/;
const extensions = new Map([
  ['image/png', { extension: '.png', format: 'png' }],
  ['image/jpeg', { extension: '.jpg', format: 'jpeg' }],
  ['image/webp', { extension: '.webp', format: 'webp' }],
]);

export class EventAssetError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) {
    super(message);
    this.name = 'EventAssetError';
  }
}

function safeUnlink(assetDir: string, filename: string | null): void {
  if (!filename || path.basename(filename) !== filename) return;
  try { unlinkSync(path.join(assetDir, filename)); } catch { /* deletion is best-effort */ }
}

function hasExactContainerLength(buffer: Buffer, format: string): boolean {
  if (format === 'jpeg') return buffer.length >= 2 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  if (format === 'webp') return buffer.length >= 12 && buffer.readUInt32LE(4) + 8 === buffer.length;
  if (format !== 'png' || buffer.length < 20) return false;
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > buffer.length) return false;
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    offset = end;
    if (type === 'IEND') return length === 0 && offset === buffer.length;
  }
  return false;
}

async function validateImage(body: unknown, mime: string): Promise<Buffer> {
  const declared = extensions.get(mime);
  if (!declared || !Buffer.isBuffer(body) || !body.length) {
    throw new EventAssetError(415, 'INVALID_IMAGE', 'Image content does not match its media type');
  }
  if (!hasExactContainerLength(body, declared.format)) {
    throw new EventAssetError(415, 'INVALID_IMAGE', 'Image content does not match its media type');
  }
  try {
    const decodeOptions = { failOn: 'warning' as const, limitInputPixels: MAX_LOGO_PIXELS, animated: true };
    const decoder = sharp(body, decodeOptions);
    const metadata = await decoder.metadata();
    if (metadata.format !== declared.format) {
      throw new EventAssetError(415, 'INVALID_IMAGE', 'Image content does not match its media type');
    }
    const pageHeight = metadata.pageHeight ?? metadata.height;
    const pages = metadata.pages ?? 1;
    if (!metadata.width || !pageHeight || metadata.width > MAX_LOGO_DIMENSION || pageHeight > MAX_LOGO_DIMENSION
      || metadata.width * pageHeight * pages > MAX_LOGO_PIXELS) {
      throw new EventAssetError(413, 'IMAGE_DIMENSIONS_EXCEEDED', 'Image dimensions exceed 4096 × 4096 limit');
    }
    await sharp(body, decodeOptions).raw().toBuffer();
    return body;
  } catch (error) {
    if (error instanceof EventAssetError) throw error;
    if (error instanceof Error && /pixel limit/i.test(error.message)) {
      throw new EventAssetError(413, 'IMAGE_DIMENSIONS_EXCEEDED', 'Image dimensions exceed 4096 × 4096 limit');
    }
    throw new EventAssetError(415, 'INVALID_IMAGE', 'Image content does not match its media type');
  }
}

export const parseEventLogo: RequestHandler = (req, res, next) => {
  const mime = req.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!extensions.has(mime)) {
    next(new EventAssetError(415, 'UNSUPPORTED_IMAGE_TYPE', 'Logo must be PNG, JPEG, or WebP'));
    return;
  }
  express.raw({ type: () => true, limit: MAX_LOGO_BYTES })(req, res, error => {
    if (error && typeof error === 'object' && 'status' in error && error.status === 413) {
      next(new EventAssetError(413, 'IMAGE_TOO_LARGE', 'Image exceeds 2 MiB limit'));
      return;
    }
    next(error);
  });
};

export async function storeEventLogo(runtime: AppRuntime, queue: QueueRow, body: unknown, mimeHeader: string | undefined): Promise<string> {
  const mime = mimeHeader?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  const declared = extensions.get(mime);
  const bytes = await validateImage(body, mime);
  const filename = `${crypto.randomBytes(16).toString('hex')}${declared!.extension}`;
  const temporaryName = `.${filename}.tmp`;
  const temporary = path.join(runtime.assetDir, temporaryName);
  const destination = path.join(runtime.assetDir, filename);
  writeFileSync(temporary, bytes, { flag: 'wx', mode: 0o640 });
  try {
    renameSync(temporary, destination);
    const result = runtime.db.prepare('UPDATE queues SET logo_path=? WHERE id=? AND removed_at IS NULL AND logo_path IS ?')
      .run(filename, queue.id, queue.logo_path);
    if (result.changes !== 1) {
      const latest = runtime.db.prepare('SELECT removed_at FROM queues WHERE id=?').get(queue.id) as { removed_at: string | null } | undefined;
      throw latest?.removed_at
        ? new EventAssetError(409, 'EVENT_ARCHIVED', 'Archived events cannot be edited')
        : new EventAssetError(409, 'EVENT_ASSET_CONFLICT', 'Event logo changed; reload and retry');
    }
  } catch (error) {
    safeUnlink(runtime.assetDir, temporaryName);
    safeUnlink(runtime.assetDir, filename);
    throw error;
  }
  safeUnlink(runtime.assetDir, queue.logo_path);
  return filename;
}

export function removeEventLogo(runtime: AppRuntime, queue: QueueRow): boolean {
  if (!queue.logo_path) {
    const result = runtime.db.prepare('UPDATE queues SET logo_path=NULL WHERE id=? AND removed_at IS NULL AND logo_path IS NULL').run(queue.id);
    if (result.changes === 1) return false;
    const latest = runtime.db.prepare('SELECT removed_at FROM queues WHERE id=?').get(queue.id) as { removed_at: string | null } | undefined;
    if (latest?.removed_at) throw new EventAssetError(409, 'EVENT_ARCHIVED', 'Archived events cannot be edited');
    throw new EventAssetError(409, 'EVENT_ASSET_CONFLICT', 'Event logo changed; reload and retry');
  }
  const result = runtime.db.prepare('UPDATE queues SET logo_path=NULL WHERE id=? AND removed_at IS NULL AND logo_path IS ?')
    .run(queue.id, queue.logo_path);
  if (result.changes !== 1) {
    const latest = runtime.db.prepare('SELECT removed_at FROM queues WHERE id=?').get(queue.id) as { removed_at: string | null } | undefined;
    throw latest?.removed_at
      ? new EventAssetError(409, 'EVENT_ARCHIVED', 'Archived events cannot be edited')
      : new EventAssetError(409, 'EVENT_ASSET_CONFLICT', 'Event logo changed; reload and retry');
  }
  safeUnlink(runtime.assetDir, queue.logo_path);
  return true;
}

export function reconcileEventAssets(runtime: Pick<AppRuntime, 'assetDir' | 'db'>): void {
  const referenced = new Set((runtime.db.prepare('SELECT logo_path FROM queues WHERE logo_path IS NOT NULL').all() as Array<{ logo_path: string }>).map(row => row.logo_path));
  for (const filename of readdirSync(runtime.assetDir)) {
    if (temporaryAsset.test(filename) || (generatedAsset.test(filename) && !referenced.has(filename))) safeUnlink(runtime.assetDir, filename);
  }
}

export function serveEventAsset(runtime: Pick<AppRuntime, 'assetDir' | 'db'>): RequestHandler {
  return (req, res, next) => {
    const notFound = () => res.status(404).set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).json({ error: 'Not found' });
    const filename = typeof req.params.filename === 'string' ? req.params.filename : undefined;
    if (!filename || !generatedAsset.test(filename)) { notFound(); return; }
    const referenced = runtime.db.prepare('SELECT 1 FROM queues WHERE logo_path=? LIMIT 1').get(filename);
    if (!referenced) { notFound(); return; }
    res.sendFile(path.join(runtime.assetDir, filename), {
      dotfiles: 'deny',
      headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
    }, error => {
      if (!error) return;
      const code = (error as NodeJS.ErrnoException).code;
      if ((code === 'ENOENT' || code === 'ENOTDIR') && !res.headersSent) { notFound(); return; }
      next(error);
    });
  };
}
