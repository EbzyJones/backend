import { Address, Contract, nativeToScVal, scValToNative, xdr } from '@stellar/stellar-sdk';
import type { SorobanClient } from '../../blockchain/soroban-client.js';
import { DriverPayoutAddressNotFoundError } from '../domain/errors.js';

export interface SorobanFleetContractClient {
  buildRegisterFleet(params: { ownerAddress: string; treasuryAddress: string }): Promise<unknown>;
  buildUpdateFleetTreasury(params: {
    ownerAddress: string;
    chainFleetId: bigint;
    treasuryAddress: string;
  }): Promise<unknown>;
  buildAddDriverToFleet(params: {
    callerAddress: string;
    chainFleetId: bigint;
    driverAddress: string;
  }): Promise<unknown>;
  buildAcceptFleetInvite(params: { chainFleetId: bigint; driverAddress: string }): Promise<unknown>;
  buildRemoveDriverFromFleet(params: {
    callerAddress: string;
    chainFleetId: bigint;
    driverAddress: string;
  }): Promise<unknown>;
  getPayoutAddress(driverAddress: string, chainFleetId: bigint): Promise<string>;
}

export function createSorobanFleetContractClient(
  client: SorobanClient,
  contractId: string,
): SorobanFleetContractClient {
  const contract = new Contract(contractId);

  async function buildInvocation(
    sourceAddress: string,
    method: string,
    args: xdr.ScVal[],
  ): Promise<unknown> {
    const account = await client.getAccount(sourceAddress);
    const tx = new (await import('@stellar/stellar-sdk')).TransactionBuilder(account, {
      fee: '100',
      networkPassphrase: client.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(60)
      .build();
    return client.prepareTransaction(tx);
  }

  return {
    buildRegisterFleet({ ownerAddress, treasuryAddress }) {
      return buildInvocation(ownerAddress, 'register_fleet', [
        new Address(ownerAddress).toScVal(),
        new Address(treasuryAddress).toScVal(),
      ]);
    },

    buildUpdateFleetTreasury({ ownerAddress, chainFleetId, treasuryAddress }) {
      return buildInvocation(ownerAddress, 'update_fleet_treasury', [
        new Address(ownerAddress).toScVal(),
        nativeToScVal(chainFleetId, { type: 'u64' }),
        new Address(treasuryAddress).toScVal(),
      ]);
    },

    buildAddDriverToFleet({ callerAddress, chainFleetId, driverAddress }) {
      return buildInvocation(callerAddress, 'add_driver_to_fleet', [
        new Address(callerAddress).toScVal(),
        nativeToScVal(chainFleetId, { type: 'u64' }),
        new Address(driverAddress).toScVal(),
      ]);
    },

    buildAcceptFleetInvite({ chainFleetId, driverAddress }) {
      return buildInvocation(driverAddress, 'accept_fleet_invite', [
        nativeToScVal(chainFleetId, { type: 'u64' }),
        new Address(driverAddress).toScVal(),
      ]);
    },

    buildRemoveDriverFromFleet({ callerAddress, chainFleetId, driverAddress }) {
      return buildInvocation(callerAddress, 'remove_driver_from_fleet', [
        nativeToScVal(chainFleetId, { type: 'u64' }),
        new Address(callerAddress).toScVal(),
        new Address(driverAddress).toScVal(),
      ]);
    },

    async getPayoutAddress(driverAddress, chainFleetId) {
      const account = await client.getAccount(driverAddress);
      const tx = new (await import('@stellar/stellar-sdk')).TransactionBuilder(account, {
        fee: '100',
        networkPassphrase: client.networkPassphrase,
      })
        .addOperation(
          contract.call(
            'get_payout_address',
            nativeToScVal(chainFleetId, { type: 'u64' }),
            new Address(driverAddress).toScVal(),
          ),
        )
        .setTimeout(60)
        .build();

      const simulation = await client.simulateTransaction(tx);
      if ('error' in simulation) {
        throw new Error(`get_payout_address simulation failed: ${simulation.error}`);
      }

      const retval = simulation.result?.retval;
      if (retval === undefined || retval === null) {
        throw new DriverPayoutAddressNotFoundError();
      }

      const native = scValToNative(retval);
      if (native === null || native === undefined) {
        throw new DriverPayoutAddressNotFoundError();
      }
      if (typeof native !== 'string') {
        throw new Error('Expected get_payout_address to return an Address-as-string');
      }
      return native;
    },
  };
}
