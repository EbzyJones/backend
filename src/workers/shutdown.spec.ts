import { describe, expect, it, vi } from 'vitest';
import {
  WORKER_CLOSE_TIMEOUT_MS,
  WORKER_DISCONNECT_TIMEOUT_MS,
  executeWorkerShutdownSteps,
} from './shutdown.js';

function buildDeps(overrides: Partial<Parameters<typeof executeWorkerShutdownSteps>[0]> = {}) {
  const callOrder: string[] = [];
  const deps = {
    workers: [
      {
        close: vi.fn().mockImplementation(async () => {
          callOrder.push('worker.close');
        }),
      },
    ],
    closeAllQueues: vi.fn().mockImplementation(async () => {
      callOrder.push('closeAllQueues');
    }),
    disconnectPrisma: vi.fn().mockImplementation(async () => {
      callOrder.push('disconnectPrisma');
    }),
    disconnectRedis: vi.fn().mockImplementation(async () => {
      callOrder.push('disconnectRedis');
    }),
    disconnectQueueConnection: vi.fn().mockImplementation(async () => {
      callOrder.push('disconnectQueueConnection');
    }),
    ...overrides,
  };
  return { deps, callOrder };
}

describe('worker shutdown steps', () => {
  it('defines bounded per-step shutdown budgets', () => {
    // close-with-grace's delay is 10s (src/workers/index.ts) — the sum of
    // the per-step budgets must stay comfortably below any orchestrator
    // grace period so the process always exits on its own terms (#355).
    expect(WORKER_CLOSE_TIMEOUT_MS).toBe(5_000);
    expect(WORKER_DISCONNECT_TIMEOUT_MS).toBe(3_000);
    expect(WORKER_CLOSE_TIMEOUT_MS + WORKER_DISCONNECT_TIMEOUT_MS).toBeLessThan(10_000);
  });

  it('closes workers, queues, and connections sequentially when all succeed', async () => {
    const { deps, callOrder } = buildDeps();

    const errors = await executeWorkerShutdownSteps(deps);

    expect(errors).toHaveLength(0);
    expect(callOrder).toEqual([
      'worker.close',
      'closeAllQueues',
      'disconnectPrisma',
      'disconnectRedis',
      'disconnectQueueConnection',
    ]);
  });

  it('still attempts every later step when a worker close rejects', async () => {
    const failingClose = vi.fn().mockRejectedValueOnce(new Error('worker close failed'));
    const { deps, callOrder } = buildDeps({ workers: [{ close: failingClose }] });

    const errors = await executeWorkerShutdownSteps(deps);

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('worker close failed');
    expect(callOrder).toEqual([
      'closeAllQueues',
      'disconnectPrisma',
      'disconnectRedis',
      'disconnectQueueConnection',
    ]);
  });

  it('times out a hanging worker close without abandoning later steps (#355)', async () => {
    const { deps, callOrder } = buildDeps({
      workers: [{ close: vi.fn().mockImplementation(() => new Promise(() => {})) }],
      closeTimeoutMs: 50,
    });

    const errors = await executeWorkerShutdownSteps(deps);

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toContain('Worker[0] disconnect timed out after 50ms');
    expect(callOrder).toEqual([
      'closeAllQueues',
      'disconnectPrisma',
      'disconnectRedis',
      'disconnectQueueConnection',
    ]);
  });

  it('times out a hanging queue close without abandoning disconnects (#355)', async () => {
    const { deps } = buildDeps({
      closeAllQueues: vi.fn().mockImplementation(() => new Promise(() => {})),
      closeTimeoutMs: 50,
    });

    const errors = await executeWorkerShutdownSteps(deps);

    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toContain('Queues disconnect timed out after 50ms');
    expect(deps.disconnectPrisma).toHaveBeenCalledTimes(1);
    expect(deps.disconnectRedis).toHaveBeenCalledTimes(1);
    expect(deps.disconnectQueueConnection).toHaveBeenCalledTimes(1);
  });

  it('aggregates errors from multiple steps rather than stopping at the first', async () => {
    const { deps } = buildDeps({
      disconnectPrisma: vi.fn().mockRejectedValue(new Error('Prisma disconnect failed')),
      disconnectQueueConnection: vi.fn().mockRejectedValue(new Error('Queue disconnect failed')),
    });

    const errors = await executeWorkerShutdownSteps(deps);

    expect(errors).toHaveLength(2);
    expect((errors[0] as Error).message).toBe('Prisma disconnect failed');
    expect((errors[1] as Error).message).toBe('Queue disconnect failed');
    expect(deps.disconnectRedis).toHaveBeenCalledTimes(1);
  });

  it('handles a worker list with no registered workers', async () => {
    const { deps, callOrder } = buildDeps({ workers: [] });

    const errors = await executeWorkerShutdownSteps(deps);

    expect(errors).toHaveLength(0);
    expect(callOrder).toEqual([
      'closeAllQueues',
      'disconnectPrisma',
      'disconnectRedis',
      'disconnectQueueConnection',
    ]);
  });
});
