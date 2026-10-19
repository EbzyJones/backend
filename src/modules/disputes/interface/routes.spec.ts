import { Keypair } from '@stellar/stellar-sdk';
import Fastify from 'fastify';
import { serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { describe, expect, it } from 'vitest';
import { createDisputeRoutes, type DisputeUseCases } from './routes.js';
import { disputeIdParamsSchema } from './schemas.js';
import { buildDispute } from '../application/__fixtures__/fakes.js';
import type { GetDisputeResult } from '../application/index.js';

/** Minimal stub set — only `getDispute` is exercised; the other use cases are
 * never invoked by the `GET /disputes/:chainDeliveryId` route under test. */
function buildUseCases(dispute: GetDisputeResult['dispute']): DisputeUseCases {
  const getDispute = async (): Promise<GetDisputeResult> => ({ dispute, evidence: [] });
  return {
    getDispute,
    uploadEvidence: getDispute,
    downloadEvidence: getDispute,
    buildTransactions: {
      buildRaiseDisputeTransaction: getDispute,
      buildAddEvidenceHashTransaction: getDispute,
      buildResolveDisputeRefundSenderTransaction: getDispute,
      buildResolveDisputePayDriverTransaction: getDispute,
      buildResolveDisputeSplitFundsTransaction: getDispute,
    },
  } as unknown as DisputeUseCases;
}

/** `buildDispute`'s default `raisedBy` is a placeholder that doesn't satisfy the
 * `stellarAddress` shape the response schema enforces, so every dispute built
 * here carries a real, randomly generated address instead. */
const RAISER = Keypair.random().publicKey();

async function getDisputeResponse(dispute: GetDisputeResult['dispute'], expectSuccess = true) {
  const app = Fastify();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  await app.register(createDisputeRoutes(buildUseCases(dispute), { evidenceMaxBytes: 1024 }));
  const response = await app.inject({ method: 'GET', url: '/disputes/1' });
  await app.close();
  if (expectSuccess && response.statusCode !== 200) {
    throw new Error(`GET /disputes/1 -> ${response.statusCode}: ${response.body}`);
  }
  return response;
}

describe('GET /disputes/:chainDeliveryId serialization (#293)', () => {
  it('serializes a valid resolvedAt as an ISO string', async () => {
    const resolvedAt = new Date('2026-03-01T00:00:00Z');

    const response = await getDisputeResponse(buildDispute({ raisedBy: RAISER, resolvedAt }));

    expect(response.statusCode).toBe(200);
    expect(response.json().data.resolvedAt).toBe('2026-03-01T00:00:00.000Z');
  });

  it('serializes a null resolvedAt as null', async () => {
    const response = await getDisputeResponse(buildDispute({ raisedBy: RAISER, resolvedAt: null }));

    expect(response.statusCode).toBe(200);
    expect(response.json().data.resolvedAt).toBeNull();
  });

  it('serializes an invalid resolvedAt as null instead of throwing (#293)', async () => {
    const response = await getDisputeResponse(
      buildDispute({ raisedBy: RAISER, resolvedAt: new Date('nope') }),
    );

    expect(response.statusCode).toBe(200);
    expect(response.json().data.resolvedAt).toBeNull();
  });

  it('rejects malformed resolvedBy values before they reach the client', async () => {
    const response = await getDisputeResponse(
      buildDispute({ raisedBy: RAISER, resolvedBy: 'not-a-valid-address' }),
      false,
    );

    expect(response.statusCode).toBe(500);
  });
});

describe('disputeIdParamsSchema BigInt transform (#296)', () => {
  it('converts valid integer strings to BigInt via Zod .transform()', () => {
    const parsed = disputeIdParamsSchema.parse({ chainDeliveryId: '123456789' });
    expect(parsed.chainDeliveryId).toBe(123456789n);
    expect(typeof parsed.chainDeliveryId).toBe('bigint');
  });

  it('rejects non-numeric characters defensively', () => {
    const result = disputeIdParamsSchema.safeParse({ chainDeliveryId: '123a' });
    expect(result.success).toBe(false);
  });

  it('passes BigInt to getDispute use case from route params', async () => {
    let capturedId: bigint | undefined;
    const app = Fastify();
    app.setValidatorCompiler(validatorCompiler);
    app.setSerializerCompiler(serializerCompiler);

    const dispute = buildDispute({ raisedBy: RAISER, chainDeliveryId: 42n });
    const useCases = {
      getDispute: async (input: { chainDeliveryId: bigint }): Promise<GetDisputeResult> => {
        capturedId = input.chainDeliveryId;
        return { dispute, evidence: [] };
      },
      uploadEvidence: async () => ({ evidence: {} as never }),
      downloadEvidence: async () => ({ contentType: 'application/pdf', bytes: Buffer.from('') }),
      buildTransactions: {} as never,
    } as unknown as DisputeUseCases;

    await app.register(createDisputeRoutes(useCases, { evidenceMaxBytes: 1024 }));
    const response = await app.inject({ method: 'GET', url: '/disputes/42' });
    await app.close();

    expect(response.statusCode).toBe(200);
    expect(capturedId).toBe(42n);
    expect(typeof capturedId).toBe('bigint');
  });
});
