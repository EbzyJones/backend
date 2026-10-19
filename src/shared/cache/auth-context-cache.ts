import type { UserRole } from '@prisma/client';
import { getConfig } from '../config/index.js';
import { logger } from '../logger/index.js';
import { getRedisClient } from './redis-client.js';

const log = logger.child({ module: 'auth-context-cache' });

/**
 * The pair the shared HTTP auth guard reads per authenticated request
 * (#369): `users.role` and `users.token_version`, the two columns behind
 * its security-issue-#12 check. Mirrors database state only — never
 * "token validity" — so it is safe to populate regardless of whether the
 * presented token itself passed the version check.
 */
export interface AuthContext {
  role: UserRole;
  tokenVersion: number;
}

function authContextKey(userId: string): string {
  return `auth:user:${userId}:context`;
}

/**
 * Reads a user's cached `{ role, tokenVersion }`, or `null` on a miss.
 *
 * Deliberately fail-open (#369): any Redis error degrades to a `null`
 * miss so the caller falls back to the database lookup this cache exists
 * to avoid — an unreachable cache must never reject an otherwise valid
 * request, nor (worse) skip the version check. A corrupt entry is treated
 * the same way; the caller's subsequent DB read + write overwrites it.
 */
export async function readAuthContext(userId: string): Promise<AuthContext | null> {
  try {
    const raw = await getRedisClient().get(authContextKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthContext>;
    if (typeof parsed.tokenVersion !== 'number' || typeof parsed.role !== 'string') {
      return null;
    }
    return { role: parsed.role as UserRole, tokenVersion: parsed.tokenVersion };
  } catch (error) {
    log.warn({ err: error, userId }, 'auth context cache read failed — falling back to database');
    return null;
  }
}

/**
 * Populates the cache after a database read. Never throws — a failed write
 * only means the next request repeats the (already-paid-for) database
 * lookup, and must not fail the request currently being served.
 */
export async function writeAuthContext(userId: string, context: AuthContext): Promise<void> {
  try {
    await getRedisClient().set(
      authContextKey(userId),
      JSON.stringify(context),
      'EX',
      getConfig().AUTH_CONTEXT_CACHE_TTL_SECONDS,
    );
  } catch (error) {
    log.warn(
      { err: error, userId },
      'auth context cache write failed — next request re-reads the database',
    );
  }
}

/**
 * Evicts a user's entry — the cache-side half of role-change invalidation
 * (#369), called by `updateUserRole` right after its transaction commits
 * so security issue #12's "takes effect on the very next request" guarantee
 * survives the cache. Never throws: by the time this runs the privilege
 * change has already committed, and a failed eviction leaves a stale entry
 * until the TTL expires — bounded staleness, which must not be reported as
 * a failed role change.
 */
export async function invalidateAuthContext(userId: string): Promise<void> {
  try {
    await getRedisClient().del(authContextKey(userId));
  } catch (error) {
    log.warn(
      { err: error, userId },
      'auth context cache eviction failed — stale entry may persist until TTL expiry',
    );
  }
}
