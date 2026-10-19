import { createSmtpClient, type SmtpSettings } from '../../../shared/smtp/index.js';
import type { Mailer } from '../domain/index.js';

/**
 * Production-capable `Mailer` for the `smtp`/`sendgrid`/`ses` providers —
 * delivers through the same SMTP relay every one of those providers exposes
 * (SendGrid: smtp.sendgrid.net, SES: email-smtp.<region>.amazonaws.com),
 * using the shared dependency-free client in src/shared/smtp/smtp-client.ts.
 * Selected by `select-mailer.ts`; throws (rejects) on any delivery failure
 * exactly like `logger-mailer.ts`'s logging path never pretends a send it
 * didn't make.
 */
export function createSmtpMailer(settings: SmtpSettings): Mailer {
  const client = createSmtpClient(settings);
  return {
    async sendVerificationEmail(to, token) {
      await client.send({
        to,
        subject: 'FaniLab email verification',
        text:
          'Someone requested an email verification for your FaniLab account.\n\n' +
          `Verification token: ${token}\n\n` +
          'If you did not request this, you can safely ignore this email.\n',
      });
    },
    async sendPasswordResetEmail(to, token) {
      await client.send({
        to,
        subject: 'FaniLab password reset',
        text:
          'Someone requested a password reset for your FaniLab account.\n\n' +
          `Reset token: ${token}\n\n` +
          'If you did not request this, you can safely ignore this email.\n',
      });
    },
  };
}
