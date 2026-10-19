import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readAuthContext, writeAuthContext, invalidateAuthContext } from './auth-context-cache.js';

/**
 * Unit coverage for the auth guard's per-user Redis cache (#369). ioredis
 * is mocked at the constructor (same approach as redis-client.test.ts) so
 * the real read/write/evict logic — including every fail-open path — runs
 * against a controllable fake client instead of a live Redis.
 */
const get = vi.fn();
const set = vi.fn();
const del = vi.fn();
const on = vi.fn();

vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(() => ({ get, set, del, on })),
}));

const KEY = 'auth:user:user-1:context';

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue(null);
  set.mockResolvedValue('OK');
  del.mockResolvedValue(1);
});

describe('auth context cache (#369)', () => {
  it('round-trips a context through Redis with the configured TTL', async () => {
    await writeAuthContext('user-1', { role: 'COURIER', tokenVersion: 4 });

    expect(set).toHaveBeenCalledWith(
      KEY,
      JSON.stringify({ role: 'COURIER', tokenVersion: 4 }),
      'EX',
      60, // AUTH_CONTEXT_CACHE_TTL_SECONDS default
    );

    get.mockResolvedValue(JSON.stringify({ role: 'COURIER', tokenVersion: 4 }));
    await expect(readAuthContext('user-1')).resolves.toEqual({
      role: 'COURIER',
      tokenVersion: 4,
    });
    expect(get).toHaveBeenCalledWith(KEY);
  });

  it('returns null on a miss and scopes entries per user', async () => {
    await expect(readAuthContext('user-1')).resolves.toBeNull();
    expect(get).toHaveBeenCalledWith(KEY);
    expect(get).not.toHaveBeenCalledWith('auth:user:user-2:context');
  });

  it('treats a corrupt or incomplete entry as a miss instead of throwing', async () => {
    get.mockResolvedValueOnce('not-json{');
    await expect(readAuthContext('user-1')).resolves.toBeNull();

    get.mockResolvedValueOnce(JSON.stringify({ role: 'ADMIN' })); // no tokenVersion
    await expect(readAuthContext('user-1')).resolves.toBeNull();
  });

  // #369's core safety property: an unreachable cache must degrade to the
  // database lookup (a miss), never reject the request or skip the check.
  it('fails open to a miss when Redis errors on read', async () => {
    get.mockRejectedValueOnce(new Error('connection refused'));
    await expect(readAuthContext('user-1')).resolves.toBeNull();
  });

  it('swallows write failures — a cache-out request must not fail', async () => {
    set.mockRejectedValueOnce(new Error('connection refused'));
    await expect(
      writeAuthContext('user-1', { role: 'ADMIN', tokenVersion: 1 }),
    ).resolves.toBeUndefined();
  });

  it('evicts via DEL and swallows eviction failures (bounded TTL staleness instead)', async () => {
    await invalidateAuthContext('user-1');
    expect(del).toHaveBeenCalledWith(KEY);

    del.mockRejectedValueOnce(new Error('connection refused'));
    await expect(invalidateAuthContext('user-1')).resolves.toBeUndefined();
  });
});
