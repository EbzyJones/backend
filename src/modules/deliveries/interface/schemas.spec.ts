import { describe, expect, it } from 'vitest';
import { createDeliveryBodySchema, getDeliveryResponseSchema } from './schemas.js';

const stellarAddress = 'G' + 'A'.repeat(55); // matches ^G[A-Z2-7]{55}$

function createDeliveryInput(overrides: Partial<{ weightGrams: number }> = {}) {
  return {
    senderAddress: stellarAddress,
    recipientAddress: stellarAddress,
    origin: 'Lagos',
    destination: 'Accra',
    cargoCategory: 'GENERAL',
    weightGrams: 500,
    fragile: false,
    estimatedDelivery: '2026-06-01T00:00:00.000Z',
    ...overrides,
  };
}

function deliveryDto(destination: string) {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    chainDeliveryId: '1',
    senderAddress: 'GSENDER',
    recipientAddress: 'GRECIPIENT',
    driverAddress: null,
    status: 'PENDING',
    origin: 'Lagos',
    destination,
    cargoCategory: 'GENERAL',
    weightGrams: 500,
    fragile: false,
    createdAtChain: '2026-01-01T00:00:00.000Z',
    transitStartedAt: null,
    deliveredAt: null,
  };
}

describe('delivery response schemas', () => {
  it('accepts a destination at the maximum length', () => {
    const result = getDeliveryResponseSchema.safeParse({ data: deliveryDto('a'.repeat(256)) });

    expect(result.success).toBe(true);
  });

  it('rejects a destination longer than the maximum length', () => {
    const result = getDeliveryResponseSchema.safeParse({ data: deliveryDto('a'.repeat(257)) });

    expect(result.success).toBe(false);
  });
});

describe('createDeliveryBodySchema', () => {
  it('accepts weightGrams at the minimum valid value (1 gram)', () => {
    const result = createDeliveryBodySchema.safeParse(createDeliveryInput({ weightGrams: 1 }));

    expect(result.success).toBe(true);
  });

  it('accepts weightGrams at the maximum valid value (500,000 grams / 500kg)', () => {
    const result = createDeliveryBodySchema.safeParse(
      createDeliveryInput({ weightGrams: 500_000 }),
    );

    expect(result.success).toBe(true);
  });

  it('rejects weightGrams above the maximum valid value', () => {
    const result = createDeliveryBodySchema.safeParse(
      createDeliveryInput({ weightGrams: 500_001 }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some(
          (issue) => issue.path.includes('weightGrams') && issue.message.includes('500,000g'),
        ),
      ).toBe(true);
    }
  });

  it('rejects zero and negative weightGrams', () => {
    expect(
      createDeliveryBodySchema.safeParse(createDeliveryInput({ weightGrams: 0 })).success,
    ).toBe(false);
    expect(
      createDeliveryBodySchema.safeParse(createDeliveryInput({ weightGrams: -1 })).success,
    ).toBe(false);
  });
});
