import type { NotificationSender } from '../domain/notification-sender';
import { createSmtpClient, type SmtpClient } from '../../../shared/smtp/smtp-client';

/**
 * SMTP-backed NotificationSender. Delivers notifications as plain-text (and,
 * when the payload carries HTML, multipart) email through the shared SMTP
 * relay configured by the SMTP_* environment variables. Transport errors are
 * surfaced to the caller so the notification pipeline can retry or dead-letter
 * rather than silently dropping mail.
 */
export function createSmtpNotificationSender(client: SmtpClient = createSmtpClient()): NotificationSender {
  return {
    async send(notification) {
      await client.sendMail({
        to: notification.recipient,
        subject: notification.subject,
        text: notification.body,
        ...(notification.html ? { html: notification.html } : {}),
      });
    },
  };
}
