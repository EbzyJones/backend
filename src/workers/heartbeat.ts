import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../shared/logger/index.js';
import { workerHeartbeatFailuresTotal } from '../shared/metrics/index.js';

const log = logger.child({ module: 'worker-heartbeat' });

/**
 * The worker process has no HTTP surface, so `Dockerfile`'s worker
 * HEALTHCHECK can't probe it the way the api image probes `GET /health`.
 * Instead this touches a marker file on an interval; the HEALTHCHECK
 * considers the process wedged if the file's mtime falls too far behind —
 * see docs/DEPLOYMENT.md § Health Checks.
 */
export const HEARTBEAT_DIR = process.env.WORKER_HEARTBEAT_DIR ?? '/var/lib/fanilab/heartbeat';
export const HEARTBEAT_FILE = path.join(HEARTBEAT_DIR, 'worker.heartbeat');
export const HEARTBEAT_INTERVAL_MS = 15_000;

/**
 * Consecutive failed writes tolerated before the worker triggers its own
 * graceful shutdown (#357). The HEALTHCHECK only observes a stale mtime —
 * it can't tell a wedged event loop apart from a read-only/full disk, and
 * leaves the container running degraded until it goes unhealthy. After this
 * many consecutive failures the filesystem is treated as unusable and the
 * process exits via the normal SIGTERM-equivalent shutdown path so the
 * orchestrator restarts it against a working volume.
 */
export const HEARTBEAT_FAILURE_FATAL_THRESHOLD = 3;

export interface HeartbeatController {
  /** Touches the marker file. Never rejects; returns false on write failure. */
  write(): Promise<boolean>;
  /** Consecutive failed writes since the last success. */
  consecutiveFailures(): number;
}

/**
 * Wraps the heartbeat file write with the failure bookkeeping (#357):
 * every failed write increments the `worker_heartbeat_failures_total`
 * Prometheus counter and logs a diagnostic that names the filesystem error
 * (so operators can distinguish disk-full/read-only from a stalled event
 * loop); `HEARTBEAT_FAILURE_FATAL_THRESHOLD` consecutive failures escalate
 * to `log.fatal` and the injected `onFatalFailure` callback, which the
 * worker process wires to close-with-grace's `close()` for a clean exit.
 */
export function createHeartbeatController(onFatalFailure: () => void): HeartbeatController {
  let consecutiveFailures = 0;

  return {
    async write(): Promise<boolean> {
      try {
        await mkdir(HEARTBEAT_DIR, { recursive: true });
        await writeFile(HEARTBEAT_FILE, new Date().toISOString());
        consecutiveFailures = 0;
        return true;
      } catch (err) {
        consecutiveFailures += 1;
        workerHeartbeatFailuresTotal.inc();
        log.warn({ err, consecutiveFailures }, 'Failed to write worker heartbeat file');
        if (consecutiveFailures >= HEARTBEAT_FAILURE_FATAL_THRESHOLD) {
          log.fatal(
            { err, consecutiveFailures },
            'Worker heartbeat file writes keep failing — triggering graceful shutdown',
          );
          onFatalFailure();
        }
        return false;
      }
    },
    consecutiveFailures: () => consecutiveFailures,
  };
}
