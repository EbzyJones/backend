import { describe, expect, it } from 'vitest';
import { serializeDelivery } from './serialization.js';
import type { Delivery } from './entities.js';

describe('serializeDelivery', () => {
  it('serializes a Delivery entity converting chainDeliveryId bigint to string and dates to ISO strings', () => {
    const delivery: Delivery = {
      id: 'd1c2b3a4-1234-5678-90ab-cdef12345678',
      chainDeliveryId: 9876543210123456789n,
      senderAddress: 'GA...',
      recipientAddress: 'GB...',
      driverAddress: 'GC...',
      status: 'ACTIVE',
      origin: 'Lagos',
      destination: 'Accra',
      cargoCategory: 'GENERAL',
      weightGrams: 500,
      fragile: false,
      createdAtChain: new Date('2026-01-01T00:00:00.000Z'),
      transitStartedAt: new Date('2026-01-02T00:00:00.000Z'),
      deliveredAt: null,
    };

    const serialized = serializeDelivery(delivery);

    expect(serialized.chainDeliveryId).toBe('9876543210123456789');
    expect(typeof serialized.chainDeliveryId).toBe('string');
    expect(serialized.createdAtChain).toBe('2026-01-01T00:00:00.000Z');
    expect(serialized.transitStartedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(serialized.deliveredAt).toBeNull();

    // Verify it JSON.stringifies without throwing
    const json = JSON.stringify(serialized);
    expect(json).toContain('"chainDeliveryId":"9876543210123456789"');
  });

  it('verifies that global BigInt serialization formats raw BigInts as strings', () => {
    const objWithRawBigInt = {
      chainDeliveryId: 12345678901234567890n,
    };
    expect(() => JSON.stringify(objWithRawBigInt)).not.toThrow();
    const json = JSON.stringify(objWithRawBigInt);
    expect(json).toBe('{"chainDeliveryId":"12345678901234567890"}');
  });
});
