import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { ZodError } from 'zod';
import { createAccessGuards } from './access-guards.js';
import { EventAssetError, serveEventAsset } from './event-assets.js';
import { createRuntime } from './runtime.js';
import { EventPeriodError } from './queue-period.js';
import { vendorAdminRoutes } from './routes/vendor-admin.js';
import { staffAdminRoutes } from './routes/staff-admin.js';
import { customerRoutes } from './routes/customer.js';
import type { AppContext, AppOptions } from './types.js';

export type { AppContext, AppOptions } from './types.js';

export function publicErrorResponse(error: unknown): { status: number; body: { error: string; code?: string } } {
  if (error instanceof SyntaxError) return { status: 400, body: { error: 'Invalid JSON' } };
  if (error instanceof EventAssetError) return { status: error.status, body: { error: error.message, code: error.code } };
  if (error instanceof EventPeriodError) return { status: error.status, body: { error: 'Invalid event period', code: error.code } };
  if (typeof error === 'object' && error !== null && 'status' in error && error.status === 413
    && 'type' in error && error.type === 'entity.too.large') {
    return { status: 413, body: { error: 'Request body too large' } };
  }
  return { status: 500, body: { error: 'Internal server error' } };
}

export function createApp(options: AppOptions): AppContext {
  if (options.sessionSecret.length < 32) throw new Error('SESSION_SECRET must be at least 32 characters');
  const runtime = createRuntime(options);
  const guards = createAccessGuards(runtime);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ credentials: true, origin(origin, callback) { callback(null, !origin); } }));
  app.use(express.json({ limit: '32kb' }));
  app.get('/event-assets/:filename', serveEventAsset(runtime));
  app.use('/event-assets', (_req, res) => {
    res.status(404).set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }).json({ error: 'Not found' });
  });
  if (options.rateLimit !== false) {
    app.use('/api', rateLimit({ windowMs: 15 * 60_000, limit: 200, standardHeaders: 'draft-8', legacyHeaders: false }));
  }

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use(vendorAdminRoutes(runtime, guards));
  app.use(staffAdminRoutes(runtime, guards));
  app.use(customerRoutes(runtime, guards));

  if (options.staticDir && existsSync(options.staticDir)) {
    app.use(express.static(options.staticDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api|\/health).*/, (_req, res) => res.sendFile(path.join(options.staticDir!, 'index.html')));
  }
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    if (error instanceof ZodError) {
      res.status(400).json({ error: 'Invalid request', details: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) });
      return;
    }
    const response = publicErrorResponse(error);
    if (response.status === 500) console.error('Request failed', error instanceof Error ? error.message : 'unknown');
    res.status(response.status).json(response.body);
  });

  return { app, db: runtime.db, close: runtime.close };
}
