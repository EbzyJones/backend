import { describe, expect, it } from 'vitest';
import { parseEnv } from '../../../shared/config/env.js';
import { smtpSettingsFromEnv, type SmtpSettings } from '../../../shared/smtp/index.js';
import { selectNotificationSender } from './select-notification-sender.js';

const smtpSettings: SmtpSettings = {
  host: 'smtp.example.com',
  port: 465,
  from: 'FaniLab <no-reply@example.com>',
};

describe('selectNotificationSender', () => {
  it('returns the logger sender in development', () => {
    const sender = selectNotificationSender('development', 'logger');
    expect(sender.send).toBeTypeOf('function');
  });

  it('returns the logger sender in test', () => {
    const sender = selectNotificationSender('test', 'logger');
    expect(sender.send).toBeTypeOf('function');
  });

  it('throws a clear configuration error for logger in production', () => {
    expect(() => selectNotificationSender('production', 'logger')).toThrow(/NODE_ENV=production/);
  });

  it('initializes successfully in production for every real provider (issue #374)', () => {
    for (const provider of ['smtp', 'sendgrid', 'ses'] as const) {
      const sender = selectNotificationSender('production', provider, smtpSettings);
      expect(sender.send).toBeTypeOf('function');
    }
  });

  it('boots a production configuration end to end: parseEnv → settings → selector', () => {
    const env = parseEnv({
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
      REDIS_URL: 'redis://localhost:6379',
      JWT_ACCESS_SECRET: 'a'.repeat(32),
      JWT_REFRESH_SECRET: 'b'.repeat(32),
      NODE_ENV: 'production',
      NOTIFICATION_PROVIDER: 'sendgrid',
      SMTP_HOST: 'smtp.sendgrid.net',
      SMTP_USER: 'apikey',
      SMTP_PASSWORD: 'sg-secret',
      SMTP_FROM: 'FaniLab <no-reply@example.com>',
    } as NodeJS.ProcessEnv);
    const sender = selectNotificationSender(
      env.NODE_ENV,
      env.NOTIFICATION_PROVIDER,
      smtpSettingsFromEnv(env),
    );
    expect(sender.send).toBeTypeOf('function');
  });

  it('throws a clear configuration error when a real provider has no SMTP settings', () => {
    expect(() => selectNotificationSender('production', 'smtp')).toThrow(
      /NOTIFICATION_PROVIDER=smtp requires SMTP relay settings/,
    );
  });
});
