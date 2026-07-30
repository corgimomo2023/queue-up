import { z } from 'zod';
import { Session } from './http-constants';

const RuntimeMode = {
  Development: 'development',
  Production: 'production',
  Test: 'test',
} as const;

const optionalNonEmptyString = z.preprocess(
  value => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const publicOrigin = z
  .url()
  .refine(value => {
    const url = new URL(value);
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    );
  }, 'Must be an HTTP(S) origin without credentials, path, query or fragment')
  .transform(value => new URL(value).origin);

const environmentSchema = z
  .object({
    NODE_ENV: z
      .enum([RuntimeMode.Development, RuntimeMode.Production, RuntimeMode.Test])
      .default(RuntimeMode.Development),
    PORT: z.coerce.number().int().min(1).max(65_535).default(8088),
    DATA_DIR: z.string().trim().min(1).default('/app/data'),
    SESSION_SECRET: z.string().min(Session.MinimumSecretLength),
    SUPER_ADMIN_KEY: z.string().min(Session.MinimumSecretLength),
    PUBLIC_ORIGIN: publicOrigin,
    QUEUEFLOW_SEED_EMAIL: optionalNonEmptyString,
    QUEUEFLOW_SEED_PHONE: optionalNonEmptyString,
  })
  .transform(values => ({
    nodeEnvironment: values.NODE_ENV,
    port: values.PORT,
    dataDir: values.DATA_DIR,
    sessionSecret: values.SESSION_SECRET,
    superAdminKey: values.SUPER_ADMIN_KEY,
    publicOrigin: values.PUBLIC_ORIGIN,
    seedEmail: values.QUEUEFLOW_SEED_EMAIL,
    seedPhone: values.QUEUEFLOW_SEED_PHONE,
    secureCookie: values.NODE_ENV !== RuntimeMode.Test,
  }));

export type Environment = Readonly<z.output<typeof environmentSchema>>;

function loadEnvironment(values: NodeJS.ProcessEnv): Environment {
  const result = environmentSchema.safeParse(values);
  if (result.success) return Object.freeze(result.data);

  const details = result.error.issues
    .map(issue => `${issue.path.join('.') || 'environment'}: ${issue.message}`)
    .join('; ');
  throw new Error(`Invalid environment configuration: ${details}`);
}

export const env = loadEnvironment(process.env);
