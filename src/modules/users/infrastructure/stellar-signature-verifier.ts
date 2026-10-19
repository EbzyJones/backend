import { Keypair, MuxedAccount } from '@stellar/stellar-sdk';
import type { SignatureVerifier } from '../domain/index.js';

/**
 * Verifies an ed25519 signature against a Stellar address using
 * `stellar-sdk`'s `Keypair` — the same primitive SEP-10 web-auth challenges
 * are built on. Both SEP-23 address forms are accepted: standard `G...`
 * public keys verify directly, while Muxed Account `M...` addresses (issued
 * by exchanges/custodial wallets — CAP-27/SEP-23) are first resolved to the
 * `G...` account they encode, and the signature is checked against that base
 * key — the key that actually produced it. Any malformed address/signature
 * is treated as "does not verify" rather than thrown, so callers never need
 * to distinguish "invalid input" from "wrong signature."
 */
export function createStellarSignatureVerifier(): SignatureVerifier {
  return {
    verify(address, message, signatureBase64) {
      try {
        // The sequence number is irrelevant here (no transaction is built)
        // and MuxedAccount.fromAddress requires one for the base Account it
        // wraps — '0' is the conventional placeholder.
        const publicKey = address.startsWith('M')
          ? MuxedAccount.fromAddress(address, '0').baseAccount().accountId()
          : address;
        const keypair = Keypair.fromPublicKey(publicKey);
        return keypair.verify(Buffer.from(message, 'utf8'), Buffer.from(signatureBase64, 'base64'));
      } catch {
        return false;
      }
    },
  };
}
