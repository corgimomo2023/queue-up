import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { createApp } from './app.js';

const port = Number(process.env.PORT ?? 8088);
const dataDir = process.env.DATA_DIR ?? '/app/data';
mkdirSync(dataDir, { recursive: true });
const sessionSecret = process.env.SESSION_SECRET;
if (!sessionSecret || sessionSecret.length < 32) throw new Error('SESSION_SECRET (32+ characters) is required');
const superAdminKey = process.env.SUPER_ADMIN_KEY;
if (!superAdminKey || superAdminKey.length < 32) throw new Error('SUPER_ADMIN_KEY (32+ characters) is required');
const here = path.dirname(fileURLToPath(import.meta.url));
const staticDir = path.resolve(here, '../../dist');
const context = createApp({
  dbPath: path.join(dataDir, 'queueflow.sqlite'), sessionSecret, superAdminKey,
  seedEmail: process.env.QUEUEFLOW_SEED_EMAIL, seedPhone: process.env.QUEUEFLOW_SEED_PHONE,
  secureCookie: process.env.NODE_ENV !== 'test', staticDir,
});
const server = context.app.listen(port, '0.0.0.0', () => console.log(`QueueFlow listening on 0.0.0.0:${port}`));
function shutdown() { server.close(() => { context.close(); process.exit(0); }); }
process.on('SIGTERM', shutdown); process.on('SIGINT', shutdown);
