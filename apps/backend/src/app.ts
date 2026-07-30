import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cors from 'cors';
import { ZodError } from 'zod';
import { RateLimit, RequestLimit, Session } from './config/http-constants';
import { createAccessGuards } from './access-guards';
import { EventAssetError, serveEventAsset } from './event-assets';
import { createRuntime } from './runtime';
import { EventPeriodError } from './queue-period';
import { vendorAdminRoutes } from './routes/vendor-admin';
import { staffAdminRoutes } from './routes/staff-admin';
import { customerRoutes } from './routes/customer';
import {
  assertInjectableShareTemplate,
  buildEventManifest,
  buildEventShareHtml,
} from './social-preview';
import type { AppContext, AppOptions } from './types';

export type { AppContext, AppOptions } from './types';

export function publicErrorResponse(error: unknown): {
  status: number;
  body: { error: string; code?: string };
} {
  if (error instanceof SyntaxError) return { status: 400, body: { error: 'Invalid JSON' } };
  if (error instanceof EventAssetError)
    return { status: error.status, body: { error: error.message, code: error.code } };
  if (error instanceof EventPeriodError)
    return { status: error.status, body: { error: 'Invalid event period', code: error.code } };
  if (
    typeof error === 'object' &&
    error !== null &&
    'status' in error &&
    error.status === 413 &&
    'type' in error &&
    error.type === 'entity.too.large'
  ) {
    return { status: 413, body: { error: 'Request body too large' } };
  }
  return { status: 500, body: { error: 'Internal server error' } };
}

export async function createApp(options: AppOptions): Promise<AppContext> {
  if (options.sessionSecret.length < Session.MinimumSecretLength) {
    throw new Error(
      `SESSION_SECRET must be at least ${Session.MinimumSecretLength.toString()} characters`,
    );
  }

  const staticDir = options.staticDir;
  const publicOrigin = options.publicOrigin;
  let indexPath: string | undefined;
  let indexTemplate: string | undefined;
  if (staticDir) {
    if (!existsSync(staticDir)) throw new Error(`Static directory not found: ${staticDir}`);
    if (!publicOrigin) {
      throw new Error('PUBLIC_ORIGIN is required when serving the frontend');
    }
    indexPath = path.join(staticDir, 'index.html');
    indexTemplate = readFileSync(indexPath, 'utf8');
    assertInjectableShareTemplate(indexTemplate);
  }

  const runtime = await createRuntime(options);
  const guards = createAccessGuards(runtime);
  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        callback(null, !origin);
      },
    }),
  );
  app.use(express.json({ limit: RequestLimit.JsonBody }));
  app.get('/event-assets/:filename', serveEventAsset(runtime));
  app.use('/event-assets', (_req, res) => {
    res
      .status(404)
      .set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' })
      .json({ error: 'Not found' });
  });
  if (options.rateLimit !== false) {
    app.use(
      '/api',
      rateLimit({
        windowMs: RateLimit.WindowMilliseconds,
        limit: RateLimit.ApiRequestsPerWindow,
        skip: req => ['GET', 'HEAD', 'OPTIONS'].includes(req.method),
        standardHeaders: 'draft-8',
        legacyHeaders: false,
      }),
    );
  }

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use(vendorAdminRoutes(runtime, guards));
  app.use(staffAdminRoutes(runtime, guards));
  app.use(customerRoutes(runtime, guards));

  if (staticDir && indexPath && indexTemplate && publicOrigin) {
    const publicEvent = async (queueId: string) => {
      const queue = await runtime.getQueue(queueId);
      return queue && !queue.removed_at ? queue : null;
    };

    app.get('/q/:queueId/manifest.webmanifest', async (req, res) => {
      const queue = await publicEvent(req.params.queueId);
      if (!queue) {
        res.status(404).json({ error: 'Queue not found' });
        return;
      }
      res
        .type('application/manifest+json')
        .set('Cache-Control', 'no-cache')
        .json(buildEventManifest(queue));
    });
    app.get('/q/:queueId', async (req, res) => {
      const queue = await publicEvent(req.params.queueId);
      if (!queue) {
        res.status(404).type('text/plain').send('Queue not found');
        return;
      }
      res
        .type('html')
        .set('Cache-Control', 'no-cache')
        .send(buildEventShareHtml(indexTemplate, queue, publicOrigin));
    });

    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api|\/health).*/, (_req, res) => res.sendFile(indexPath));
  }
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    void _next;
    if (error instanceof ZodError) {
      res.status(400).json({
        error: 'Invalid request',
        details: error.issues.map(issue => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
      return;
    }
    const response = publicErrorResponse(error);
    if (response.status === 500)
      console.error('Request failed', error instanceof Error ? error.message : 'unknown');
    res.status(response.status).json(response.body);
  });

  return { app, db: runtime.db, close: runtime.close };
}
