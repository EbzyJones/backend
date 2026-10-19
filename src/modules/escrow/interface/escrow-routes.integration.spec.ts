import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { Keypair } from '@stellar/stellar-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../../app.js';
import { disconnectPrisma } from '../../../shared/database/index.js';
import { signAccessToken } from '../../../shared/jwt/index.js';
import { isDatabaseAvailable } from '../../../shared/testing/database.js';

const dbAvailable = await isDatabaseAvailable();

interface SuccessBody<T> {
  data: T;
}
interface ErrorBody {
  error: { code: string; message: string };
}

describe.skipIf(!dbAvailable)('escrow routes (integration)', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  const prisma = new PrismaClient();
  const createdChainIds: bigint[] = [];
  const createdEmails: string[] = [];

  beforeAll(async () => {
    app = await buildApp();
  });

  afterAll(async () => {
    await app.close();
    if (createdChainIds.length > 0) {
      await prisma.escrow.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
      await prisma.delivery.deleteMany({ where: { chainDeliveryId: { in: createdChainIds } } });
    }
    if (createdEmails.length > 0) {
      const users = await prisma.user.findMany({ where: { email: { in: createdEmails } } });
      const userIds = users.map((user) => user.id);
      await prisma.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    }
    await prisma.$disconnect();
    await disconnectPrisma();
  });

  async function registerUser(): Promise<{ accessToken: string }> {
    const email = `escrow-test-${randomUUID()}@example.com`;
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
    return { accessToken: login.json<SuccessBody<{ accessToken: string }>>().data.accessToken };
  }

  function nextChainId(): bigint {
    const id = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
    createdChainIds.push(id);
    return id;
  }

  // Escrow.chainDeliveryId is a foreign key into Delivery.chainDeliveryId, so
  // every seeded escrow needs its parent delivery row created first.
  async function seedEscrow() {
    const chainDeliveryId = nextChainId();
    await prisma.delivery.create({
      data: {
        chainDeliveryId,
        senderAddress: `GSENDER-${randomUUID()}`,
        recipientAddress: `GRECIPIENT-${randomUUID()}`,
        status: 'PENDING',
        origin: 'Lagos',
        destination: 'Accra',
        cargoCategory: 'GENERAL',
        weightGrams: 500,
        fragile: false,
        createdAtChain: new Date(),
      },
    });
    await prisma.escrow.create({
      data: {
        chainDeliveryId,
        senderAddress: `GSENDER-${randomUUID()}`,
        recipientAddress: `GRECIPIENT-${randomUUID()}`,
        driverAddress: `GDRIVER-${randomUUID()}`,
        token: `GTOKEN-${randomUUID()}`,
        amount: '1000000',
        status: 'LOCKED',
        createdAtChain: new Date(),
      },
    });
    return chainDeliveryId;
  }

  it('gets a single escrow by chain delivery id', async () => {
    const chainDeliveryId = await seedEscrow();

    const response = await app.inject({
      method: 'GET',
      url: `/api/v1/escrow/${chainDeliveryId.toString()}`,
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<SuccessBody<{ status: string; chainDeliveryId: string }>>();
    expect(body.data.status).toBe('LOCKED');
    expect(body.data.chainDeliveryId).toBe(chainDeliveryId.toString());
  });

  it('returns 404 for an unknown escrow', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/v1/escrow/999999999999999' });

    expect(response.statusCode).toBe(404);
    expect(response.json<ErrorBody>().error.code).toBe('NOT_FOUND');
  });

  it('rejects an unauthenticated transaction-build request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/release-escrow',
      payload: { callerAddress: 'G'.padEnd(56, 'A'), chainDeliveryId: '1' },
    });

    expect(response.statusCode).toBe(401);
  });

  it('rejects an unauthenticated refund transaction-build request', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/refund-escrow',
      payload: { callerAddress: 'G'.padEnd(56, 'A'), chainDeliveryId: '1' },
    });

    expect(response.statusCode).toBe(401);
  });

  // docs/API_REFERENCE.md: with ESCROW_CONTRACT_ID unset (its .env.example
  // default, and the default in this test process), the build endpoints must
  // return 502 BLOCKCHAIN_ERROR naming the missing variable — the
  // createUnconfiguredContractClient() fallback in ../index.ts — rather than
  // a generic failure. Fails if that fallback wiring is removed.
  it('returns 502 BLOCKCHAIN_ERROR from a build endpoint when the contract id is unconfigured', async () => {
    const { accessToken } = await registerUser();

    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/release-escrow',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: { callerAddress: Keypair.random().publicKey(), chainDeliveryId: '1' },
    });

    expect(response.statusCode).toBe(502);
    const body = response.json<ErrorBody>();
    expect(body.error.code).toBe('BLOCKCHAIN_ERROR');
    expect(body.error.message).toContain('ESCROW_CONTRACT_ID');
  });

  it('rejects create-escrow transaction-build with amount: "0" with 400 VALIDATION_ERROR', async () => {
    const { accessToken } = await registerUser();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/create-escrow',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        senderAddress: Keypair.random().publicKey(),
        recipientAddress: Keypair.random().publicKey(),
        driverAddress: Keypair.random().publicKey(),
        chainDeliveryId: '1',
        token: Keypair.random().publicKey(),
        amount: '0',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<ErrorBody>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('rejects create-escrow transaction-build with negative amount "-100" with 400 VALIDATION_ERROR', async () => {
    const { accessToken } = await registerUser();
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/transactions/build/create-escrow',
      headers: { authorization: `Bearer ${accessToken}` },
      payload: {
        senderAddress: Keypair.random().publicKey(),
        recipientAddress: Keypair.random().publicKey(),
        driverAddress: Keypair.random().publicKey(),
        chainDeliveryId: '1',
        token: Keypair.random().publicKey(),
        amount: '-100',
      },
    });

    expect(response.statusCode).toBe(400);
    const body = response.json<ErrorBody>();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
