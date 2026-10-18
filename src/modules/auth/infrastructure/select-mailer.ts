import type { Env } from '../../../shared/config/env.js';
import type { SmtpSettings } from '../../../shared/smtp/index.js';
import type { Mailer } from '../domain/index.js';
import { createLoggerMailer } from './logger-mailer.js';
import { createSmtpMailer } from './smtp-mailer.js';

/**
 * Selects the real `Mailer` adapter from config, refusing the
 * logging-only default in production. `createLoggerMailer` is a genuinely
 * functional dev/test default (docs/AUTHENTICATION.md), not a stub, but a
 * production deployment that never swapped in a real provider should fail
 * loudly at boot instead of silently delivering no mail — and now that
 * real providers exist (`smtp`/`sendgrid`/`ses`, all delivered through the
 * SMTP relay configured by SMTP_*, see src/shared/smtp/smtp-client.ts),
 * production deployments have something real to select. `smtp` settings are
 * only required for the non-logger providers; they arrive already
 * validated by env.ts's provider refinement for any boot-time selection.
 */
export function selectMailer(
  nodeEnv: Env['NODE_ENV'],
  provider: Env['MAIL_PROVIDER'],
  smtp?: SmtpSettings,
): Mailer {
  if (provider === 'logger') {
    if (nodeEnv === 'production') {
      throw new Error(
        'MAIL_PROVIDER=logger is not allowed when NODE_ENV=production — configure a real mail ' +
          'provider (MAIL_PROVIDER=smtp with SMTP_*, or sendgrid/ses) before deploying ' +
          '(see docs/AUTHENTICATION.md § Dev email delivery).',
      );
    }
    return createLoggerMailer();
  }

  // `smtp`/`sendgrid`/`ses` — exhaustive per the MAIL_PROVIDER enum in
  // env.ts; a new provider value must add a branch here before it can be
  // selected. env.ts refuses to parse a non-logger provider without
  // SMTP_HOST/SMTP_FROM, so a missing relay here can only come from code
  // calling this selector directly — fail with the same clarity anyway.
  if (!smtp) {
    throw new Error(
      `MAIL_PROVIDER=${provider} requires SMTP relay settings (SMTP_HOST and SMTP_FROM) — ` +
        'configure the SMTP relay before deploying.',
    );
  }
  return createSmtpMailer(smtp);
}
