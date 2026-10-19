import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { decimalToBigInt } from './decimal.js';

describe('decimalToBigInt', () => {
  it('converts a small integer Decimal', () => {
    expect(decimalToBigInt(new Prisma.Decimal('42'))).toBe(42n);
  });

  it('converts zero', () => {
    expect(decimalToBigInt(new Prisma.Decimal(0))).toBe(0n);
  });

  it('converts a negative value', () => {
    expect(decimalToBigInt(new Prisma.Decimal('-123456789'))).toBe(-123456789n);
  });

  it('converts an i128::MAX-sized value that .toString() would render exponentially', () => {
    // The bug this helper guards against: Decimal.toString() on a 39-digit
    // value yields "1.7014118346046923e+38", which BigInt() can't parse.
    const i128Max = '170141183460469231731687303715884105727';
    expect(decimalToBigInt(new Prisma.Decimal(i128Max))).toBe(BigInt(i128Max));
  });

  it('converts an integer-valued Decimal that carries a trailing decimal zero', () => {
    expect(decimalToBigInt(new Prisma.Decimal('100.0'))).toBe(100n);
  });

  // Issue #366: token amounts are integer base units on-chain — a fractional
  // Decimal means an upstream calculation error and must never be rounded
  // away silently (that would move real funds by an untracked amount).
  it('throws a TypeError for a fractional Decimal instead of silently rounding', () => {
    expect(() => decimalToBigInt(new Prisma.Decimal('100.5'))).toThrow(TypeError);
    expect(() => decimalToBigInt(new Prisma.Decimal('100.99'))).toThrow(
      /non-integer Decimal.*100\.99/,
    );
  });

  it('throws for a negative fractional Decimal too', () => {
    expect(() => decimalToBigInt(new Prisma.Decimal('-0.5'))).toThrow(TypeError);
  });
});
