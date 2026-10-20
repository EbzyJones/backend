import { Prisma } from '@prisma/client';

/**
 * Converts a Prisma.Decimal (or numeric string) to a bigint using fixed-point
 * string validation. Rejects scientific notation and fractional values so that
 * amounts up to i128::MAX (39 digits) round-trip without precision loss.
 */
export function prismaDecimalToBigInt(value: Prisma.Decimal | string | number | bigint): bigint {
  const raw = value instanceof Prisma.Decimal ? value.toFixed() : String(value);
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`Invalid fixed-point integer value: ${raw}`);
  }
  return BigInt(raw);
}

/**
 * Converts a bigint to a Prisma.Decimal via its fixed-point string form,
 * avoiding exponential notation for large magnitudes.
 */
export function bigIntToPrismaDecimal(value: bigint): Prisma.Decimal {
  return new Prisma.Decimal(value.toString());
}

/** @deprecated Use prismaDecimalToBigInt for validated conversions. */
export function decimalToBigInt(value: Prisma.Decimal | string | number | bigint): bigint {
  return prismaDecimalToBigInt(value);
}
