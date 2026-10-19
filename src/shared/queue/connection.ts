import { Redis } from 'ioredis';
import { getConfig } from '../config/index.js';
import { logger } from '../logger/index.js';
import { withTimeout } from '../shutdown/index.js';

const log = logger.child({ module: 'queue-connection' });

/**
 * How long `disconnectQueueConnection` waits for Redis's graceful QUIT
 * before force-closing the socket instead. When the container orchestrator
 * stops Redis and the worker/API at the same time, QUIT never resolves —
 * waiting on it indefinitely held process shutdown past the orchestrator's
 * grace period (#355).
 */
export const QUEUE_DISCONNECT_TIMEOUT_MS = 3_000;

let connection: Redis | undefined;

/**
 * BullMQ requires its own Redis connection(s) with `maxRetriesPerRequest:
 * null` (it manages blocking commands itself) — this is intentionally
 * separate from src/shared/cache's client, which is tuned for short-lived
 * request/response cache lookups instead.
 */
export function getQueueConnection(): Redis {
  if (!connection) {
    connection = new Redis(getConfig().REDIS_URL, { maxRetriesPerRequest: null });
    connection.on('error', (error) => log.error({ err: error }, 'Queue Redis connection error'));
  }
  return connection;
}

export async function disconnectQueueConnection(): Promise<void> {
  const current = connection;
  connection = undefined;
  if (!current) return;
  try {
    await withTimeout(() => current.quit(), QUEUE_DISCONNECT_TIMEOUT_MS, 'QueueConnection');
  } catch (error: unknown) {
    // Best-effort teardown: if QUIT hangs (unreachable Redis) or rejects,
    // drop the socket outright so shutdown is never held hostage by a
    // connection that can no longer complete a round-trip (#355).
    log.warn({ err: error }, 'Queue Redis quit did not complete — force disconnecting socket');
    current.disconnect();
  }
}
