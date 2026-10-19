import type { Prisma } from '@prisma/client';

/**
 * Converts a Prisma `Decimal` to a `BigInt`.
 *
 * Prisma's Decimal (decimal.js) switches to exponential notation past 21
 * significant digits by default — `.toString()` on an i128::MAX-sized amount
 * (39 digits; the columns are `Decimal(39, 0)`, see prisma/schema.prisma)
 * yields "1.7...e+38", which `BigInt()` can't parse. `.toFixed()` always
 * returns a plain fixed-point string regardless of magnitude, so Decimal
 * amounts must be converted to BigInt via `.toFixed()`, never `.toString()`.
 *
 * Token amounts are integer base units on-chain (`Decimal(39, 0)` columns,
 * see prisma/schema.prisma), so a non-integer Decimal here means a
 * calculation error upstream — it must fail loudly rather than round away
 * the fraction (#366): silently quantizing an escrow amount would move real
 * funds by an untracked amount. (The pre-existing `BigInt(value.toFixed())`
 * happened to throw a cryptic `SyntaxError` for most fractional values;
 * this makes the failure explicit and self-describing at the source.)
 */
export function decimalToBigInt(value: Prisma.Decimal): bigint {
  if (!value.isInteger()) {
    throw new TypeError(
      `Cannot convert non-integer Decimal to BigInt without precision loss: ${value.toFixed()}`,
    );
  }
  return BigInt(value.toFixed());
}
