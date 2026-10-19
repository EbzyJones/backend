import type { Env } from '../config/env.js';
import type { SmtpSettings } from './smtp-client.js';

/**
 * Assembles relay settings from parsed SMTP_* env vars for whichever
 * composition root is selecting a provider adapter. Returns `undefined` when
 * the relay isn't configured — schema-level validation (src/shared/config/
 * env.ts) has already rejected that combination for any non-`logger`
 * provider, so `undefined` here is only ever paired with `logger`, whose
 * selectors ignore it. Keeping that check in the schema rather than here
 * means the misconfiguration fails at boot with a path+message, not inside
 * an adapter.
 */
export function smtpSettingsFromEnv(
  env: Pick<
    Env,
    'SMTP_HOST' | 'SMTP_PORT' | 'SMTP_USER' | 'SMTP_PASSWORD' | 'SMTP_FROM' | 'SMTP_TLS_CA_PATH'
  >,
): SmtpSettings | undefined {
  if (!env.SMTP_HOST || !env.SMTP_FROM) return undefined;
  return {
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    user: env.SMTP_USER,
    password: env.SMTP_PASSWORD,
    from: env.SMTP_FROM,
    caPath: env.SMTP_TLS_CA_PATH,
  };
}
