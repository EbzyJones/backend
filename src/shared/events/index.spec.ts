import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  EVENT_DISPATCH_CONCURRENCY,
  onBlockchainEvent,
  publishBlockchainEvent,
  subscribeBlockchainEventHandler,
  type BlockchainEventEnvelope,
} from './index.js';
import { eventSubscriberErrorsTotal, registry } from '../metrics/index.js';
import type { Logger } from '../logger/index.js';

function buildEvent(overrides: Partial<BlockchainEventEnvelope> = {}): BlockchainEventEnvelope {
  return {
    contractName: 'escrow',
    network: 'testnet',
    rpcEventId: 'evt-1',
    ledgerSeq: 1n,
    txHash: 'abc',
    topic: ['something_happened'],
    payload: ['1'],
    closedAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

/**
 * Direct coverage of the in-process bus's own contract, independent of any
 * module handler — every module's real-time correctness rides on this seam
 * (`onBlockchainEvent` / `publishBlockchainEvent`), yet all other tests
 * exercise their handler function directly rather than going through the bus.
 */
describe('blockchain event bus', () => {
  const cleanup: Array<() => void> = [];

  function subscribe(handler: (event: BlockchainEventEnvelope) => void) {
    const off = onBlockchainEvent(handler);
    cleanup.push(off);
    return off;
  }

  afterEach(() => {
    while (cleanup.length) cleanup.pop()?.();
  });

  it('delivers a published event to every current subscriber', () => {
    const first = vi.fn();
    const second = vi.fn();
    subscribe(first);
    subscribe(second);

    const event = buildEvent();
    publishBlockchainEvent(event);

    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith(event);
    expect(second).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledWith(event);
  });

  it('stops delivering to a listener once its unsubscribe function is called, without affecting others', () => {
    const stays = vi.fn();
    const leaves = vi.fn();
    subscribe(stays);
    const off = subscribe(leaves);

    publishBlockchainEvent(buildEvent({ rpcEventId: 'first' }));
    off();
    publishBlockchainEvent(buildEvent({ rpcEventId: 'second' }));

    expect(leaves).toHaveBeenCalledTimes(1);
    expect(leaves.mock.calls[0]?.[0]).toMatchObject({ rpcEventId: 'first' });
    expect(stays).toHaveBeenCalledTimes(2);
  });

  it('is a no-op — not an error — when publishing with zero subscribers', () => {
    expect(() => publishBlockchainEvent(buildEvent())).not.toThrow();
  });

  it('delivers each publish call independently rather than batching or coalescing them', () => {
    const handler = vi.fn();
    subscribe(handler);

    publishBlockchainEvent(buildEvent({ rpcEventId: 'a' }));
    publishBlockchainEvent(buildEvent({ rpcEventId: 'b' }));
    publishBlockchainEvent(buildEvent({ rpcEventId: 'c' }));

    expect(handler).toHaveBeenCalledTimes(3);
    expect(handler.mock.calls.map(([event]) => event.rpcEventId)).toEqual(['a', 'b', 'c']);
  });

  it('tolerates its unsubscribe function being called more than once', () => {
    const handler = vi.fn();
    const off = onBlockchainEvent(handler);

    off();
    expect(() => off()).not.toThrow();

    publishBlockchainEvent(buildEvent());
    expect(handler).not.toHaveBeenCalled();
  });

  it('increments event_subscriber_errors_total when a registered handler throws', async () => {
    const log = { error: vi.fn() } as unknown as Logger;
    const errorMessage = 'spec: handler failed';
    cleanup.push(
      subscribeBlockchainEventHandler(
        async () => {
          throw new Error('DB down');
        },
        log,
        errorMessage,
      ),
    );

    publishBlockchainEvent(buildEvent({ rpcEventId: 'metric-1' }));
    // The wrapper's .catch runs on a microtask — flush before asserting.
    await new Promise((resolve) => setImmediate(resolve));

    const metric = await eventSubscriberErrorsTotal.get();
    const series = metric.values.find(
      (value) =>
        value.labels.subscriber === errorMessage &&
        value.labels.contract === 'escrow' &&
        value.labels.event === 'something_happened',
    );
    expect(series?.value).toBe(1);
    expect(log.error).toHaveBeenCalledTimes(1);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.any(Error) }),
      errorMessage,
    );
  });

  it('leaves event_subscriber_errors_total untouched when a handler succeeds', async () => {
    const log = { error: vi.fn() } as unknown as Logger;
    const errorMessage = 'spec: handler succeeded';
    cleanup.push(subscribeBlockchainEventHandler(async () => 'ok', log, errorMessage));

    publishBlockchainEvent(buildEvent({ rpcEventId: 'metric-2' }));
    await new Promise((resolve) => setImmediate(resolve));

    const metric = await eventSubscriberErrorsTotal.get();
    const series = metric.values.find((value) => value.labels.subscriber === errorMessage);
    expect(series).toBeUndefined();
    expect(log.error).not.toHaveBeenCalled();
  });

  it('registers event_subscriber_errors_total for the /metrics endpoint to export', async () => {
    expect(registry.getSingleMetric('event_subscriber_errors_total')).toBeDefined();
    expect(await registry.metrics()).toContain('# HELP event_subscriber_errors_total');
    expect(await registry.metrics()).toContain('# TYPE event_subscriber_errors_total counter');
  });

  it('resolves publish only after an async subscriber has finished', async () => {
    let finished = false;
    subscribe(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            finished = true;
            resolve();
          }, 5);
        }),
    );

    await publishBlockchainEvent(buildEvent());

    expect(finished).toBe(true);
  });

  it('bounds concurrent subscriber executions across 500 rapidly-published events', async () => {
    let active = 0;
    let maxActive = 0;
    let completed = 0;
    subscribe(() => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<void>((resolve) => {
        setTimeout(() => {
          active -= 1;
          completed += 1;
          resolve();
        }, 1);
      });
    });

    const publishes = Array.from({ length: 500 }, (_, i) =>
      publishBlockchainEvent(buildEvent({ rpcEventId: `evt-${i}` })),
    );
    await Promise.all(publishes);

    // The whole point of the backpressure work (#349): never more than the
    // configured pool size in flight, yet all 500 still complete.
    expect(maxActive).toBeLessThanOrEqual(EVENT_DISPATCH_CONCURRENCY);
    expect(maxActive).toBeGreaterThan(1);
    expect(completed).toBe(500);
    expect(active).toBe(0);
  });

  it('keeps invoking synchronous subscribers before publish returns', () => {
    const handler = vi.fn();
    subscribe(handler);

    publishBlockchainEvent(buildEvent());

    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('counts a rejecting raw listener toward event_subscriber_errors_total instead of failing the publish', async () => {
    subscribe(() => Promise.reject(new Error('raw listener failed')));

    await expect(
      publishBlockchainEvent(
        buildEvent({ rpcEventId: 'raw-failure', topic: ['raw_listener_probe'] }),
      ),
    ).resolves.toBeUndefined();

    const metric = await eventSubscriberErrorsTotal.get();
    const series = metric.values.find(
      (value) =>
        value.labels.subscriber === 'onBlockchainEvent' &&
        value.labels.event === 'raw_listener_probe',
    );
    expect(series?.value).toBe(1);
  });
});
