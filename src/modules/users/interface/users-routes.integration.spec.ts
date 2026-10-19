import { randomUUID } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as authGuard from '../../../shared/http/plugins/auth-guard.js';

vi.mock('../../../shared/events/contract-names.js', () => ({
  ContractName: { Delivery: 'delivery', Escrow: 'escrow' },
}));

import { buildApp } from '../../../app.js';
import { getPrismaClient, disconnectPrisma } from '../../../shared/database/index.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

interface SuccessBody<T> {
  data: T;
}
interface ErrorBody {
  error: { code: string; message: string };
}

describe.skipIf(!dbAvailable)('users routes (integration)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const createdEmails: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    if (createdEmails.length > 0) {
      const prisma = getPrismaClient();
      const users = await prisma.user.findMany({ where: { email: { in: createdEmails } } });
      const userIds = users.map((user) => user.id);
      await prisma.walletAddress.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await disconnectPrisma();
  });

  async function registerAndLogin(): Promise<string> {
    const email = `users-test-${randomUUID()}@example.com`;
    createdEmails.push(email);
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, password: 'password123' },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password: 'password123' },
    });
    return login.json<SuccessBody<{ accessToken: string }>>().data.accessToken;
  }

  it('rejects an unauthenticated request', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/users/me' });

    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects an unauthenticated wallet-list request', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/users/me/wallets' });

    expect(response.statusCode).toBe(401);
    expect(response.json<ErrorBody>().error.code).toBe('UNAUTHORIZED');
  });

  it('returns the authenticated user’s profile with no wallets initially', async () => {
    const accessToken = await registerAndLogin();

    const response = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me',
      headers: { authorization: `Bearer ${accessToken}` },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<{ wallets: unknown[] }>>();
    expect(body.data.wallets).toEqual([]);
  });

  it('links a wallet end-to-end with a real Stellar signature, then lists and unlinks it', async () => {
    const accessToken = await registerAndLogin();
    const keypair = Keypair.random();
    const address = keypair.publicKey();
    const authHeader = { authorization: `Bearer ${accessToken}` };

    const challengeResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/challenge',
      headers: authHeader,
      payload: { address },
    });
    expect(challengeResponse.statusCode).toBe(200);
    const { challenge } = challengeResponse.json<SuccessBody<{ challenge: string }>>().data;

    const signature = keypair.sign(Buffer.from(challenge, 'utf8')).toString('base64');

    const confirmResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/confirm',
      headers: authHeader,
      payload: { address, challenge, signature },
    });
    expect(confirmResponse.statusCode).toBe(200);
    const wallet =
      confirmResponse.json<SuccessBody<{ id: string; address: string; isPrimary: boolean }>>().data;
    expect(wallet.address).toBe(address);
    expect(wallet.isPrimary).toBe(true);

    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me/wallets',
      headers: authHeader,
    });
    expect(listResponse.json<SuccessBody<unknown[]>>().data).toHaveLength(1);

    const deleteResponse = await app.inject({
      method: 'DELETE',
      url: `/api/v1/users/me/wallets/${wallet.id}`,
      headers: authHeader,
    });
    expect(deleteResponse.statusCode).toBe(200);

    const listAfterDelete = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me/wallets',
      headers: authHeader,
    });
    expect(listAfterDelete.json<SuccessBody<unknown[]>>().data).toHaveLength(0);
  });

  it('rejects confirming a wallet link with a forged signature', async () => {
    const accessToken = await registerAndLogin();
    const keypair = Keypair.random();
    const address = keypair.publicKey();
    const authHeader = { authorization: `Bearer ${accessToken}` };

    const challengeResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/challenge',
      headers: authHeader,
      payload: { address },
    });
    const { challenge } = challengeResponse.json<SuccessBody<{ challenge: string }>>().data;

    // Signed by a *different* keypair than the one whose address is claimed.
    const impostor = Keypair.random();
    const forgedSignature = impostor.sign(Buffer.from(challenge, 'utf8')).toString('base64');

    const confirmResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/confirm',
      headers: authHeader,
      payload: { address, challenge, signature: forgedSignature },
    });

    expect(confirmResponse.statusCode).toBe(401);
  });

  it('executes authenticate guard exactly once on GET /users/me', async () => {
    const accessToken = await registerAndLogin();
    const authSpy = vi.spyOn(authGuard.authGuard, 'authenticate');
    try {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/users/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(response.statusCode).toBe(200);
      expect(authSpy).toHaveBeenCalledTimes(1);
    } finally {
      authSpy.mockRestore();
    }
  });

  it('designates a primary wallet via PUT /api/v1/users/me/wallets/:id/primary', async () => {
    const accessToken = await registerAndLogin();
    const authHeader = { authorization: `Bearer ${accessToken}` };

    // Link wallet 1
    const keypair1 = Keypair.random();
    const address1 = keypair1.publicKey();
    const challengeRes1 = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/challenge',
      headers: authHeader,
      payload: { address: address1 },
    });
    const challenge1 = challengeRes1.json<SuccessBody<{ challenge: string }>>().data.challenge;
    const sig1 = keypair1.sign(Buffer.from(challenge1, 'utf8')).toString('base64');
    const confirmRes1 = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/confirm',
      headers: authHeader,
      payload: { address: address1, challenge: challenge1, signature: sig1 },
    });
    const wallet1 = confirmRes1.json<SuccessBody<{ id: string; isPrimary: boolean }>>().data;
    expect(wallet1.isPrimary).toBe(true);

    // Link wallet 2
    const keypair2 = Keypair.random();
    const address2 = keypair2.publicKey();
    const challengeRes2 = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/challenge',
      headers: authHeader,
      payload: { address: address2 },
    });
    const challenge2 = challengeRes2.json<SuccessBody<{ challenge: string }>>().data.challenge;
    const sig2 = keypair2.sign(Buffer.from(challenge2, 'utf8')).toString('base64');
    const confirmRes2 = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/confirm',
      headers: authHeader,
      payload: { address: address2, challenge: challenge2, signature: sig2 },
    });
    const wallet2 = confirmRes2.json<SuccessBody<{ id: string; isPrimary: boolean }>>().data;
    expect(wallet2.isPrimary).toBe(false);

    // Designate wallet 2 as primary
    const putPrimaryRes = await app.inject({
      method: 'PUT',
      url: `/api/v1/users/me/wallets/${wallet2.id}/primary`,
      headers: authHeader,
    });
    expect(putPrimaryRes.statusCode).toBe(200);
    const updatedWallet2 =
      putPrimaryRes.json<SuccessBody<{ id: string; isPrimary: boolean }>>().data;
    expect(updatedWallet2.id).toBe(wallet2.id);
    expect(updatedWallet2.isPrimary).toBe(true);

    // Verify wallet 1 is no longer primary and wallet 2 is primary in listing
    const listResponse = await app.inject({
      method: 'GET',
      url: '/api/v1/users/me/wallets',
      headers: authHeader,
    });
    const wallets =
      listResponse.json<SuccessBody<Array<{ id: string; isPrimary: boolean }>>>().data;
    const found1 = wallets.find((w) => w.id === wallet1.id);
    const found2 = wallets.find((w) => w.id === wallet2.id);
    expect(found1?.isPrimary).toBe(false);
    expect(found2?.isPrimary).toBe(true);
  });

  it('rejects challenge token reuse on wallet confirmation with HTTP 409 Conflict', async () => {
    const accessToken = await registerAndLogin();
    const keypair = Keypair.random();
    const address = keypair.publicKey();
    const authHeader = { authorization: `Bearer ${accessToken}` };

    const challengeResponse = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/challenge',
      headers: authHeader,
      payload: { address },
    });
    expect(challengeResponse.statusCode).toBe(200);
    const { challenge } = challengeResponse.json<SuccessBody<{ challenge: string }>>().data;
    const signature = keypair.sign(Buffer.from(challenge, 'utf8')).toString('base64');

    // First confirmation succeeds
    const firstConfirm = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/confirm',
      headers: authHeader,
      payload: { address, challenge, signature },
    });
    expect(firstConfirm.statusCode).toBe(200);

    // Replay attempt with same challenge token must be rejected with 409 Conflict
    const secondConfirm = await app.inject({
      method: 'POST',
      url: '/api/v1/users/me/wallets/confirm',
      headers: authHeader,
      payload: { address, challenge, signature },
    });
    expect(secondConfirm.statusCode).toBe(409);
    expect(secondConfirm.json<ErrorBody>().error.code).toBe('CONFLICT');
  });
});
