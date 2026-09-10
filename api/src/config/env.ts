import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3001),

  /** Which slices of the system this process runs. */
  APP_ROLE: z.enum(['all', 'web', 'relay', 'consumer']).default('all'),

  /**
   * `poll`   - the relay dispatches PENDING outbox rows on a timer.
   * `manual` - the relay only runs when POST /outbox/drain is called.
   */
  OUTBOX_RELAY_MODE: z.enum(['poll', 'manual']).default('manual'),

  DATABASE_URL: z.string().url(),
  DIRECT_URL: z.string().url().optional(),
  PGBOSS_DATABASE_URL: z.string().url().optional(),

  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(2000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().default(20),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}

/**
 * pg-boss needs a real session (it runs LISTEN/NOTIFY + maintenance).
 * Prefer an explicit direct URL; never a transaction-mode pooler.
 */
export function pgBossConnectionString(
  env: Pick<Env, 'DATABASE_URL' | 'DIRECT_URL' | 'PGBOSS_DATABASE_URL'>,
): string {
  return env.PGBOSS_DATABASE_URL ?? env.DIRECT_URL ?? env.DATABASE_URL;
}
