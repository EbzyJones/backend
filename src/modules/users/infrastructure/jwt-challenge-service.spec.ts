import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { Keypair } from '@stellar/stellar-sdk';
import { describe, expect, it } from 'vitest';
import { createJwtChallengeService } from './jwt-challenge-service.js';
import { createStellarSignatureVerifier } from './stellar-signature-verifier.js';

describe('createJwtChallengeService', () => {
  it('round-trips a challenge back to the same user, address, and includes a unique jti nonce', () => {
    const challengeService = createJwtChallengeService();
    const userId = randomUUID();
    const address = 'GABCEXAMPLE';

    const challenge = challengeService.issueWalletLinkChallenge(userId, address);
    const verified = challengeService.verifyWalletLinkChallenge(challenge);

    expect(verified).toMatchObject({ userId, address });
    expect(typeof verified.jti).toBe('string');
    expect(verified.jti.length).toBeGreaterThan(0);
  });

  it('generates distinct nonces and distinct challenge strings for consecutive requests within the same second', () => {
    const challengeService = createJwtChallengeService();
    const userId = randomUUID();
    const address = 'GABCEXAMPLE';

    const challenge1 = challengeService.issueWalletLinkChallenge(userId, address);
    const challenge2 = challengeService.issueWalletLinkChallenge(userId, address);

    expect(challenge1).not.toBe(challenge2);

    const verified1 = challengeService.verifyWalletLinkChallenge(challenge1);
    const verified2 = challengeService.verifyWalletLinkChallenge(challenge2);

    expect(verified1.jti).not.toBe(verified2.jti);
  });

  it('works with Stellar signature verification when signing the challenge token containing the nonce', () => {
    const challengeService = createJwtChallengeService();
    const signatureVerifier = createStellarSignatureVerifier();
    const keypair = Keypair.random();
    const address = keypair.publicKey();
    const userId = randomUUID();

    const challenge = challengeService.issueWalletLinkChallenge(userId, address);
    const signature = keypair.sign(Buffer.from(challenge, 'utf8')).toString('base64');

    expect(signatureVerifier.verify(address, challenge, signature)).toBe(true);
  });

  it('consumes a challenge JTI atomically so subsequent reuse returns false', async () => {
    const mockRedis = {
      store: new Set<string>(),
      async set(key: string, _value: string, _mode: string, _ttl: number, flag?: string) {
        if (flag === 'NX' && this.store.has(key)) {
          return null;
        }
        this.store.add(key);
        return 'OK';
      },
    };

    const challengeService = createJwtChallengeService(mockRedis as any);
    const jti = randomUUID();

    const first = await challengeService.consumeChallenge(jti);
    expect(first).toBe(true);

    const second = await challengeService.consumeChallenge(jti);
    expect(second).toBe(false);
  });

  it('rejects a garbage challenge', () => {
    const challengeService = createJwtChallengeService();
    expect(() => challengeService.verifyWalletLinkChallenge('not-a-jwt')).toThrow();
  });

  it('rejects a token signed with the same secret but a different purpose (e.g. an access token)', () => {
    const challengeService = createJwtChallengeService();
    const foreignToken = jwt.sign(
      { sub: 'x', role: 'CUSTOMER' },
      process.env.JWT_ACCESS_SECRET as string,
    );

    expect(() => challengeService.verifyWalletLinkChallenge(foreignToken)).toThrow();
  });

  it('rejects a wallet-link challenge missing jti claim', () => {
    const challengeService = createJwtChallengeService();
    const tokenWithoutJti = jwt.sign(
      { sub: randomUUID(), address: 'GABCEXAMPLE', purpose: 'wallet-link' },
      process.env.JWT_ACCESS_SECRET as string,
    );

    expect(() => challengeService.verifyWalletLinkChallenge(tokenWithoutJti)).toThrow();
  });
});
