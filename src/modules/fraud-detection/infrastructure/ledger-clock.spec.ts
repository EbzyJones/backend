import { PrismaClient } from '@prisma/client';
import { createLedgerClock } from './ledger-clock';

describe('createLedgerClock', () => {
  let findFirst: jest.Mock;
  let prisma: PrismaClient;

  beforeEach(() => {
    findFirst = jest.fn();
    prisma = {
      blockchainEvent: { findFirst },
    } as unknown as PrismaClient;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('caches the latest ledger time across repeated now() calls', async () => {
    const ledgerClosedAt = new Date('2024-01-01T00:00:00.000Z');
    findFirst.mockResolvedValue({ ledgerClosedAt });

    const clock = createLedgerClock(prisma);

    for (let i = 0; i < 10; i += 1) {
      await expect(clock.now()).resolves.toEqual(ledgerClosedAt);
    }

    expect(findFirst).toHaveBeenCalledTimes(1);
  });

  it('refreshes the cache after the 5 second TTL elapses', async () => {
    jest.useFakeTimers();

    const firstLedgerClosedAt = new Date('2024-01-01T00:00:00.000Z');
    const secondLedgerClosedAt = new Date('2024-01-01T00:00:10.000Z');
    findFirst
      .mockResolvedValueOnce({ ledgerClosedAt: firstLedgerClosedAt })
      .mockResolvedValueOnce({ ledgerClosedAt: secondLedgerClosedAt });

    const clock = createLedgerClock(prisma);

    await expect(clock.now()).resolves.toEqual(firstLedgerClosedAt);
    expect(findFirst).toHaveBeenCalledTimes(1);

    jest.advanceTimersByTime(5_000);

    await expect(clock.now()).resolves.toEqual(secondLedgerClosedAt);
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('falls back to the current time when no blockchain event exists', async () => {
    findFirst.mockResolvedValue(null);

    const clock = createLedgerClock(prisma);
    const before = Date.now();
    const result = await clock.now();
    const after = Date.now();

    expect(result.getTime()).toBeGreaterThanOrEqual(before);
    expect(result.getTime()).toBeLessThanOrEqual(after);
    expect(findFirst).toHaveBeenCalledTimes(1);
  });
});
