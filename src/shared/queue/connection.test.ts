import { afterEach, describe, expect, it, vi } from 'vitest';

const quit = vi.fn().mockResolvedValue(undefined);
const disconnect = vi.fn();
const on = vi.fn();

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(() => ({ quit, disconnect, on })),
}));

describe('queue connection singleton', () => {
  afterEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('reconnects after disconnectQueueConnection instead of returning the closed connection', async () => {
    const { getQueueConnection, disconnectQueueConnection } = await import('./connection.js');
    const { Redis } = await import('ioredis');

    const first = getQueueConnection();
    expect(getQueueConnection()).toBe(first);
    expect(Redis).toHaveBeenCalledTimes(1);

    await disconnectQueueConnection();
    expect(quit).toHaveBeenCalledTimes(1);

    const second = getQueueConnection();
    expect(Redis).toHaveBeenCalledTimes(2);
    expect(second).not.toBe(first);
  });

  it('is a no-op when disconnecting without an active connection', async () => {
    const { disconnectQueueConnection } = await import('./connection.js');
    await expect(disconnectQueueConnection()).resolves.toBeUndefined();
    expect(quit).not.toHaveBeenCalled();
  });

  it('force-disconnects the socket when graceful quit does not complete in time (issue #355)', async () => {
    vi.useFakeTimers();
    try {
      quit.mockImplementationOnce(() => new Promise(() => {}));
      const { getQueueConnection, disconnectQueueConnection } = await import('./connection.js');

      getQueueConnection();
      const pending = disconnectQueueConnection();
      await vi.advanceTimersByTimeAsync(3_000);

      await expect(pending).resolves.toBeUndefined();
      expect(quit).toHaveBeenCalledTimes(1);
      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('force-disconnects the socket when quit rejects outright (issue #355)', async () => {
    quit.mockRejectedValueOnce(new Error('Connection is closed.'));
    const { getQueueConnection, disconnectQueueConnection } = await import('./connection.js');

    getQueueConnection();
    await expect(disconnectQueueConnection()).resolves.toBeUndefined();

    expect(disconnect).toHaveBeenCalledTimes(1);
  });
});
