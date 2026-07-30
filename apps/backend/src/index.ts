import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { createApp } from './app';
import { env } from './config/env';

mkdirSync(env.dataDir, { recursive: true });
const context = await createApp({
  dbPath: path.join(env.dataDir, 'queueflow.sqlite'),
  sessionSecret: env.sessionSecret,
  superAdminKey: env.superAdminKey,
  seedEmail: env.seedEmail,
  seedPhone: env.seedPhone,
  secureCookie: env.secureCookie,
  publicOrigin: env.publicOrigin,
  staticDir: path.resolve(import.meta.dirname, '../public'),
});
const server = context.app.listen(env.port, '0.0.0.0', () =>
  console.log(`Easy Queue listening on 0.0.0.0:${env.port.toString()}`),
);
function shutdown() {
  server.close(() => {
    void context.close().then(() => process.exit(0));
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
