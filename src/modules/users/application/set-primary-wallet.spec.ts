import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSetPrimaryWalletUseCase } from './set-primary-wallet.js';
import { ForbiddenWalletAccessError, WalletNotFoundError } from '../domain/index.js';
import { createInMemoryWalletAddressRepository } from './__fixtures__/fakes.js';

describe('setPrimaryWallet', () => {
  it('designates a wallet as primary and clears primary on the previously primary wallet', async () => {
    const walletAddressRepository = createInMemoryWalletAddressRepository();
    const userId = randomUUID();

    const firstWallet = await walletAddressRepository.create({
      userId,
      address: 'G_FIRST...',
      isPrimary: true,
      verifiedAt: new Date(),
    });

    const secondWallet = await walletAddressRepository.create({
      userId,
      address: 'G_SECOND...',
      isPrimary: false,
      verifiedAt: new Date(),
    });

    const setPrimaryWallet = createSetPrimaryWalletUseCase({ walletAddressRepository });
    const result = await setPrimaryWallet({ userId, walletId: secondWallet.id });

    expect(result.id).toBe(secondWallet.id);
    expect(result.isPrimary).toBe(true);

    const updatedFirst = await walletAddressRepository.findById(firstWallet.id);
    const updatedSecond = await walletAddressRepository.findById(secondWallet.id);

    expect(updatedFirst?.isPrimary).toBe(false);
    expect(updatedSecond?.isPrimary).toBe(true);
  });

  it('is idempotent when setting an already-primary wallet', async () => {
    const walletAddressRepository = createInMemoryWalletAddressRepository();
    const userId = randomUUID();

    const wallet = await walletAddressRepository.create({
      userId,
      address: 'G_PRIMARY...',
      isPrimary: true,
      verifiedAt: new Date(),
    });

    const setPrimaryWallet = createSetPrimaryWalletUseCase({ walletAddressRepository });
    const result = await setPrimaryWallet({ userId, walletId: wallet.id });

    expect(result.id).toBe(wallet.id);
    expect(result.isPrimary).toBe(true);
  });

  it('rejects an unknown wallet id', async () => {
    const walletAddressRepository = createInMemoryWalletAddressRepository();
    const setPrimaryWallet = createSetPrimaryWalletUseCase({ walletAddressRepository });

    await expect(
      setPrimaryWallet({ userId: randomUUID(), walletId: randomUUID() }),
    ).rejects.toThrow(WalletNotFoundError);
  });

  it('rejects setting a primary wallet that belongs to another user', async () => {
    const walletAddressRepository = createInMemoryWalletAddressRepository();
    const ownerId = randomUUID();
    const attackerId = randomUUID();

    const wallet = await walletAddressRepository.create({
      userId: ownerId,
      address: 'G_VICTIM...',
      isPrimary: true,
      verifiedAt: new Date(),
    });

    const setPrimaryWallet = createSetPrimaryWalletUseCase({ walletAddressRepository });

    await expect(setPrimaryWallet({ userId: attackerId, walletId: wallet.id })).rejects.toThrow(
      ForbiddenWalletAccessError,
    );
  });
});
