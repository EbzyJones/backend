import { logger } from '../shared/logger/index.js';
import { withTimeout } from '../shared/shutdown/index.js';

const log = logger.child({ module: 'worker-shutdown' });

/**
 * Per-step budgets for worker-process teardown (#355). Mirrors the API
 * process's `executeShutdownSteps` (src/server.ts) — each step is attempted
 * sequentially and best-effort, with its own timeout so a single hung
 * closure (typically an unreachable Redis holding `worker.close()` or
 * `queue.close()`) can never push shutdown past the orchestrator's grace
 * period (e.g. Kubernetes' 30s or Docker Compose's 10s), which previously
 * ended in SIGKILL, orphaned file locks, and interrupted transactions.
 */
export const WORKER_CLOSE_TIMEOUT_MS = 5_000;
export const WORKER_DISCONNECT_TIMEOUT_MS = 3_000;

export interface WorkerShutdownDeps {
  workers: Array<{ close: () => Promise<unknown> }>;
  closeAllQueues: () => Promise<unknown>;
  disconnectPrisma: () => Promise<unknown>;
  disconnectRedis: () => Promise<unknown>;
  disconnectQueueConnection: () => Promise<unknown>;
  closeTimeoutMs?: number;
  disconnectTimeoutMs?: number;
}

/**
 * Runs every teardown step even when an earlier one hangs or throws, and
 * returns the aggregated errors for the caller to log — the same contract
 * `executeShutdownSteps` gives the API process. `disconnectQueueConnection`
 * additionally force-drops its socket on timeout inside
 * `src/shared/queue/connection.ts`, so the queue Redis connection can't
 * outlive its budget either.
 */
export async function executeWorkerShutdownSteps(deps: WorkerShutdownDeps): Promise<unknown[]> {
  const closeTimeoutMs = deps.closeTimeoutMs ?? WORKER_CLOSE_TIMEOUT_MS;
  const disconnectTimeoutMs = deps.disconnectTimeoutMs ?? WORKER_DISCONNECT_TIMEOUT_MS;
  const shutdownErrors: unknown[] = [];

  for (const [index, worker] of deps.workers.entries()) {
    try {
      await withTimeout(() => worker.close(), closeTimeoutMs, `Worker[${index}]`);
      log.info({ workerIndex: index }, 'Closed BullMQ worker');
    } catch (error: unknown) {
      shutdownErrors.push(error);
      log.error({ err: error, workerIndex: index }, 'Failed to close BullMQ worker in time');
    }
  }

  try {
    await withTimeout(() => deps.closeAllQueues(), closeTimeoutMs, 'Queues');
    log.info('Closed BullMQ queues');
  } catch (error: unknown) {
    shutdownErrors.push(error);
    log.error({ err: error }, 'Failed to close BullMQ queues in time');
  }

  for (const [connection, step] of [
    ['Prisma', () => deps.disconnectPrisma()],
    ['Redis', () => deps.disconnectRedis()],
    ['QueueConnection', () => deps.disconnectQueueConnection()],
  ] as const) {
    try {
      await withTimeout(step, disconnectTimeoutMs, connection);
      log.info({ connection }, 'Disconnected');
    } catch (error: unknown) {
      shutdownErrors.push(error);
      log.error({ err: error, connection }, 'Failed to disconnect during shutdown');
    }
  }

  return shutdownErrors;
}
