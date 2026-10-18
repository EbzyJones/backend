/**
 * Shared parsing helpers for turning untrusted blockchain-event payload
 * elements (the `unknown`-typed entries of a decoded {@link BlockchainEventEnvelope}
 * `payload` / `topic`) into typed values before they reach any module's
 * read-model writes.
 *
 * These deliberately live next to `BlockchainEventEnvelope` rather than in a
 * module: they describe the *shape* of on-chain event data, not any module's
 * business logic. Module handlers import them instead of re-declaring their
 * own private copies (previously duplicated across ~12 application-layer
 * files). Any hardening here — e.g. rejecting a non-finite number before it
 * reaches `BigInt()`, or requiring a real StrKey checksum on an address —
 * then applies to every module at once.
 */

import { StrKey } from '@stellar/stellar-sdk';

/**
 * A payload element is only a usable address if it is a *valid* Stellar
 * address: an ed25519 account (`G...`), a muxed account (`M...`), or a
 * contract (`C...`). Anything else — arbitrary strings, empty strings,
 * non-Stellar identifiers such as `0x...` hashes, or absurdly long garbage
 * a malicious/unexpected contract event could carry — yields `null` so the
 * caller treats the event as malformed instead of persisting a value that
 * would later blow up transaction building or signature verification.
 * The checksum-verified StrKey checks are the same validation the rest of
 * the codebase applies to addresses (see `shared/validation/stellar-address.ts`).
 */
export function parseAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const isValid =
    StrKey.isValidEd25519PublicKey(value) ||
    StrKey.isValidMed25519PublicKey(value) ||
    StrKey.isValidContract(value);
  return isValid ? value : null;
}

/**
 * Parse a payload element that encodes an unsigned on-chain id (delivery id,
 * fleet id, ...) as either a decimal string or a JS number. Anything else —
 * including a value `BigInt()` would throw on — yields `null` so the caller
 * can treat the event as malformed rather than crashing the indexer.
 */
export function parseBigIntId(value: unknown): bigint | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}
