import crypto from 'node:crypto';
import type { Request } from 'express';

export function normalizeCredential(value: string): string {
  const trimmed = value.trim();
  return trimmed.includes('@') ? trimmed.toLowerCase() : trimmed.replace(/[\s()-]/g, '');
}

export function slowHash(value: string, normalize = true): string {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(normalize ? normalizeCredential(value) : value, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${key.toString('base64url')}`;
}

export function verifySlowHash(value: string, encoded: string | null, normalize = true): boolean {
  if (!encoded) return false;
  const parts = encoded.split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt' || !parts[1] || !parts[2]) return false;
  try {
    const expected = Buffer.from(parts[2], 'base64url');
    const actual = crypto.scryptSync(normalize ? normalizeCredential(value) : value, Buffer.from(parts[1], 'base64url'), expected.length);
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch { return false; }
}

export function tokenHash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('base64url');
}

export function randomToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function safeSlug(name: string): string {
  const base = name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 42) || 'queue';
  return `${base}-${crypto.randomBytes(3).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 4).padEnd(4, 'x')}`;
}

export function signStaffSession(queueId: number, secret: string): string {
  const payload = Buffer.from(JSON.stringify({ q: queueId, exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyStaffSession(token: string | undefined, queueId: number, secret: string): boolean {
  if (!token) return false;
  const [payload, supplied] = token.split('.');
  if (!payload || !supplied) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(supplied, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { q: number; exp: number };
    return parsed.q === queueId && parsed.exp > Date.now();
  } catch { return false; }
}

export function signVendorAdminSession(secret: string): string {
  const payload = Buffer.from(JSON.stringify({ role: 'super-admin', exp: Date.now() + 8 * 60 * 60 * 1000 })).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

export function verifyVendorAdminSession(token: string | undefined, secret: string): boolean {
  if (!token) return false;
  const [payload, supplied] = token.split('.');
  if (!payload || !supplied) return false;
  const expected = crypto.createHmac('sha256', secret).update(payload).digest();
  const actual = Buffer.from(supplied, 'base64url');
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { role: string; exp: number };
    return parsed.role === 'super-admin' && parsed.exp > Date.now();
  } catch { return false; }
}

export function secretsMatch(supplied: string, expected: string): boolean {
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

export function cookieValue(req: Request, name: string): string | undefined {
  const item = req.headers.cookie?.split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`));
  return item ? decodeURIComponent(item.slice(name.length + 1)) : undefined;
}
