import { describe, expect, it } from 'vitest';
import { createListNotificationsUseCase } from './list-notifications.js';
import { buildNotification, createInMemoryNotificationRepository } from './__fixtures__/fakes.js';

describe('listNotifications', () => {
  it("only returns the requesting user's own notifications", async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    notificationRepository.seed(buildNotification({ userId: 'user-1' }));
    notificationRepository.seed(buildNotification({ userId: 'user-2' }));
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.userId).toBe('user-1');
    expect(result.nextCursor).toBeNull();
  });

  it('filters by status when provided', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    notificationRepository.seed(buildNotification({ userId: 'user-1', status: 'SENT' }));
    notificationRepository.seed(buildNotification({ userId: 'user-1', status: 'PENDING' }));
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1', status: 'SENT' });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.status).toBe('SENT');
    expect(result.nextCursor).toBeNull();
  });

  it('caps limit at 100 even if a larger value is requested', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    for (let i = 0; i < 150; i += 1) {
      notificationRepository.seed(buildNotification({ userId: 'user-1' }));
    }
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1', limit: 500 });

    expect(result.items).toHaveLength(100);
    expect(result.nextCursor).not.toBeNull();
    expect(result.limit).toBe(100);
  });

  it('defaults to a limit of 20 when none is given', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    for (let i = 0; i < 30; i += 1) {
      notificationRepository.seed(buildNotification({ userId: 'user-1' }));
    }
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1' });

    expect(result.items).toHaveLength(20);
    expect(result.nextCursor).not.toBeNull();
    expect(result.limit).toBe(20);
  });

  it('populates nextCursor when more items remain beyond the page', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    for (let i = 0; i < 25; i += 1) {
      notificationRepository.seed(buildNotification({ userId: 'user-1' }));
    }
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1', limit: 10 });

    expect(result.items).toHaveLength(10);
    expect(result.nextCursor).not.toBeNull();
    expect(result.limit).toBe(10);
  });

  it('returns null nextCursor on the last page', async () => {
    const notificationRepository = createInMemoryNotificationRepository();
    for (let i = 0; i < 5; i += 1) {
      notificationRepository.seed(buildNotification({ userId: 'user-1' }));
    }
    const listNotifications = createListNotificationsUseCase({ notificationRepository });

    const result = await listNotifications({ userId: 'user-1' });

    expect(result.items).toHaveLength(5);
    expect(result.nextCursor).toBeNull();
    expect(result.limit).toBe(20);
  });
});
