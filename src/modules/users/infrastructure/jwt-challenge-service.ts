import { randomUUID } from 'node:crypto';
import jwt from 'jsonwebtoken';
import type { Redis } from 'ioredis';
import { getConfig } from '../../../shared/config/index.js';
import { getRedisClient } from '../../../shared/cache/index.js';
import type { ChallengeService, VerifiedChallenge } from '../domain/index.js';

const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

interface WalletLinkClaims {
  sub?: string;
  address?: string;
  purpose?: string;
  jti?: string;
}

/**
 * The challenge itself is a short-TTL JWT — the same "no extra database
 * table" pattern as auth's email-verification/password-reset tokens
 * (docs/AUTHENTICATION.md). The `purpose` claim keeps it from being
 * confusable with an access token or any other token type signed with the
 * same secret.
 */
export function createJwtChallengeService(redisClient?: Redis): ChallengeService {
  const config = getConfig();
  const getRedis = () => redisClient ?? getRedisClient();

  return {
    issueWalletLinkChallenge(userId, address) {
      const jti = randomUUID();
      return jwt.sign(
        { sub: userId, address, purpose: 'wallet-link', jti },
        config.JWT_ACCESS_SECRET,
        {
          expiresIn: CHALLENGE_TTL_SECONDS,
        } as jwt.SignOptions,
      );
    },
    verifyWalletLinkChallenge(challenge): VerifiedChallenge {
      const decoded = jwt.verify(challenge, config.JWT_ACCESS_SECRET) as WalletLinkClaims;
      if (decoded.purpose !== 'wallet-link' || !decoded.sub || !decoded.address || !decoded.jti) {
        throw new Error('Token is not a valid wallet-link challenge');
      }
      return { userId: decoded.sub, address: decoded.address, jti: decoded.jti };
    },
    async consumeChallenge(jti: string): Promise<boolean> {
      const result = await getRedis().set(
        `challenge:used:${jti}`,
        '1',
        'EX',
        CHALLENGE_TTL_SECONDS,
        'NX',
      );
      return result === 'OK';
    },
  };
}
