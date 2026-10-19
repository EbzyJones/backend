import { Keypair } from '@stellar/stellar-sdk';

/**
 * Deterministic, checksum-valid Stellar addresses for tests.
 *
 * `parseAddress` (`src/shared/events/parse.ts`) rejects anything that isn't
 * a real G/M/C StrKey, so placeholder strings like `'GDRIVER'` can no longer
 * be used wherever an event-payload address flows through a handler. Deriving
 * from a label-seeded keypair keeps fixtures readable —
 * `testAddress('driver')` — while remaining a genuinely valid address
 * (labels are copied into a fixed 32-byte seed, so keep them ≤ 32 characters).
 */
export function testAddress(label: string): string {
  const seed = Buffer.alloc(32);
  Buffer.from(label, 'utf8').copy(seed);
  return Keypair.fromRawEd25519Seed(seed).publicKey();
}
