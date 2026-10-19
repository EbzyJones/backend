import { describe, expect, it, vi } from 'vitest';
import {
  createPrismaEscrowRepository,
  executeWithRetry,
  isWriteConflictError,
  MAX_RETRY_ATTEMPTS,
} from './prisma-escrow-repository.js';
import type { PrismaClient } from '@prisma/client';

describe('prisma-escrow-repository unit tests (#387)', () => {
  describe('isWriteConflictError', () => {
    it('identifies P2034 error as a write conflict', () => {
      expect(isWriteConflictError({ code: 'P2034' })).toBe(true);
      expect(isWriteConflictError({ code: 'P2002' })).toBe(false);
      expect(isWriteConflictError(new Error('general error'))).toBe(false);
      expect(isWriteConflictError(null)).toBe(false);
      expect(isWriteConflictError(undefined)).toBe(false);
    });
  });

  describe('executeWithRetry', () => {
    it('returns result immediately on first successful attempt', async () => {
      const action = vi.fn().mockResolvedValue('ok');
      const result = await executeWithRetry(action);

      expect(result).toBe('ok');
      expect(action).toHaveBeenCalledTimes(1);
    });

    it('retries on P2034 write conflict and returns when subsequent attempt succeeds', async () => {
      const p2034Error = Object.assign(new Error('Write conflict'), { code: 'P2034' });
      const action = vi
        .fn()
        .mockRejectedValueOnce(p2034Error)
        .mockRejectedValueOnce(p2034Error)
        .mockResolvedValueOnce('recovered');

      const result = await executeWithRetry(action);

      expect(result).toBe('recovered');
      expect(action).toHaveBeenCalledTimes(3);
    });

    it('exhausts retry attempts and rethrows P2034 if conflict persists', async () => {
      const p2034Error = Object.assign(new Error('Write conflict'), { code: 'P2034' });
      const action = vi.fn().mockRejectedValue(p2034Error);

      await expect(executeWithRetry(action, 3)).rejects.toMatchObject({ code: 'P2034' });
      expect(action).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS);
    });

    it('does not retry non-P2034 errors', async () => {
      const generalError = new Error('Non-retryable error');
      const action = vi.fn().mockRejectedValue(generalError);

      await expect(executeWithRetry(action)).rejects.toThrow('Non-retryable error');
      expect(action).toHaveBeenCalledTimes(1);
    });
  });

  describe('transaction boundary', () => {
    it('executes status updates inside interactive $transaction', async () => {
      const txMock = {
        escrow: {
          update: vi.fn().mockResolvedValue({ id: 'escrow-1' }),
        },
      };

      const prismaMock = {
        $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(txMock)),
        escrow: {
          findUnique: vi.fn(),
          create: vi.fn(),
          update: vi.fn(),
        },
      } as unknown as PrismaClient;

      const repository = createPrismaEscrowRepository(prismaMock);
      await repository.updateStatus(100n, { status: 'RELEASED' });

      expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
      expect(txMock.escrow.update).toHaveBeenCalledWith({
        where: { chainDeliveryId: 100n },
        data: { status: 'RELEASED' },
      });
    });
  });
});
