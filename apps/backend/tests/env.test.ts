import { afterEach, describe, expect, it, vi } from 'vitest';

const VALID_SECRET = 'a-secure-value-that-is-at-least-32-characters';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('startup environment', () => {
  it('validates, converts and freezes runtime configuration', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('PORT', '9000');
    vi.stubEnv('DATA_DIR', '/tmp/nextq');
    vi.stubEnv('SESSION_SECRET', VALID_SECRET);
    vi.stubEnv('SUPER_ADMIN_KEY', VALID_SECRET);
    vi.stubEnv('PUBLIC_ORIGIN', 'https://queue.example/');
    vi.stubEnv('QUEUEFLOW_SEED_EMAIL', 'owner@example.test');
    vi.stubEnv('QUEUEFLOW_SEED_PHONE', '');

    const { env } = await import('../src/config/env');

    expect(env).toEqual({
      nodeEnvironment: 'production',
      port: 9000,
      dataDir: '/tmp/nextq',
      sessionSecret: VALID_SECRET,
      superAdminKey: VALID_SECRET,
      publicOrigin: 'https://queue.example',
      seedEmail: 'owner@example.test',
      seedPhone: undefined,
      secureCookie: true,
    });
    expect(Object.isFrozen(env)).toBe(true);
  });

  it('fails startup with field-level validation details', async () => {
    vi.stubEnv('PORT', '70000');
    vi.stubEnv('SESSION_SECRET', 'short');
    vi.stubEnv('SUPER_ADMIN_KEY', VALID_SECRET);
    vi.stubEnv('PUBLIC_ORIGIN', 'https://queue.example/path');

    await expect(import('../src/config/env')).rejects.toThrow(
      /Invalid environment configuration:.*PORT:.*SESSION_SECRET:.*PUBLIC_ORIGIN:/,
    );
  });
});
