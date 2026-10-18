import { describe, expect, it } from 'vitest';
import { Keypair, StrKey } from '@stellar/stellar-sdk';
import { parseAddress } from './parse.js';

/** Deterministic valid addresses — any raw 32-byte seed is a valid keypair. */
const VALID_G = Keypair.fromRawEd25519Seed(Buffer.alloc(32, 1)).publicKey();
const VALID_C = StrKey.encodeContract(Buffer.alloc(32, 7));
const VALID_M = StrKey.encodeMed25519PublicKey(
  Buffer.concat([Buffer.alloc(8, 3), Buffer.alloc(32, 4)]),
);

describe('parseAddress', () => {
  it('accepts a valid ed25519 public key (G...) unchanged', () => {
    expect(parseAddress(VALID_G)).toBe(VALID_G);
  });

  it('accepts a valid contract id (C...) unchanged', () => {
    expect(parseAddress(VALID_C)).toBe(VALID_C);
  });

  it('accepts a valid muxed account (M...) unchanged', () => {
    expect(parseAddress(VALID_M)).toBe(VALID_M);
  });

  it.each([
    ['an arbitrary word', 'hello'],
    ['an empty string', ''],
    ['an EVM-style identifier', '0x123'],
    ['a near-miss G address with a broken checksum', `${VALID_G.slice(0, -1)}X`],
    ['a C-prefixed non-contract string', 'C_NOTAREALCONTRACTADDRESS'],
    ['a 500-character garbage string', 'a'.repeat(500)],
  ])('rejects %s', (_label, value) => {
    expect(parseAddress(value)).toBeNull();
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['a number', 42],
    ['a bigint', 1n],
    ['an object', { address: VALID_G }],
    ['an array', [VALID_G]],
  ])('rejects non-string input (%s)', (_label, value) => {
    expect(parseAddress(value)).toBeNull();
  });
});
