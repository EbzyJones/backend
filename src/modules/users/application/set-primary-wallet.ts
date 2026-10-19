import type { WalletAddressRecord, WalletAddressRepository } from '../domain/index.js';
import { ForbiddenWalletAccessError, WalletNotFoundError } from '../domain/index.js';

export interface SetPrimaryWalletDeps {
  walletAddressRepository: WalletAddressRepository;
}

export interface SetPrimaryWalletInput {
  userId: string;
  walletId: string;
}

/**
 * Creates the use case that designates a linked wallet address as primary for a user.
 *
 * Sets `isPrimary = false` on user's existing wallets and `isPrimary = true` on the
 * targeted wallet within a database transaction. Throws {@link WalletNotFoundError}
 * if the wallet does not exist, and {@link ForbiddenWalletAccessError} if the wallet
 * belongs to another user.
 */
export function createSetPrimaryWalletUseCase(deps: SetPrimaryWalletDeps) {
  return async function setPrimaryWallet(
    input: SetPrimaryWalletInput,
  ): Promise<WalletAddressRecord> {
    const wallet = await deps.walletAddressRepository.findById(input.walletId);
    if (!wallet) {
      throw new WalletNotFoundError();
    }
    if (wallet.userId !== input.userId) {
      throw new ForbiddenWalletAccessError();
    }

    return deps.walletAddressRepository.setPrimary(input.userId, wallet.id);
  };
}
