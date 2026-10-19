import { randomBytes } from 'node:crypto';
import { Address, Keypair, xdr } from '@stellar/stellar-sdk';
import type { rpc, Transaction } from '@stellar/stellar-sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SorobanClient } from '../soroban-client.js';
import { simulateReadCall } from './simulate-read-call.js';

const CONTRACT_ID = Address.contract(randomBytes(32)).toString();

// The static unfunded account used as the simulation's nominal source.
const STATIC_DUMMY_PUBLIC_KEY = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

function stubSimulation(client: SorobanClient, retval: xdr.ScVal) {
  return vi.spyOn(client, 'simulateTransaction').mockResolvedValue({
    id: '1',
    latestLedger: 1000,
    events: [],
    transactionData: {} as never,
    minResourceFee: '100',
    cost: {} as never,
    result: { auth: [], retval },
    _parsed: true,
  } satisfies rpc.Api.SimulateTransactionSuccessResponse);
}

describe('simulateReadCall', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Issue #343: every read simulation used to burn OS entropy and CPU on a
  // fresh ed25519 keypair, which provides no benefit — view simulations
  // never check on-chain account existence.
  it('does not generate a throwaway keypair for the simulation source account', async () => {
    const keypairSpy = vi.spyOn(Keypair, 'random');
    const client = new SorobanClient('https://soroban.example.test');
    stubSimulation(client, xdr.ScVal.scvString('ok'));

    const result = await simulateReadCall(client, {
      contractId: CONTRACT_ID,
      method: 'ping',
      args: [],
    });

    expect(result).toBe('ok');
    expect(keypairSpy).not.toHaveBeenCalled();
  });

  it('builds the simulation from a static unfunded source account', async () => {
    const client = new SorobanClient('https://soroban.example.test');
    const simulateSpy = stubSimulation(client, xdr.ScVal.scvU32(42));

    const result = await simulateReadCall(client, {
      contractId: CONTRACT_ID,
      method: 'count',
      args: [],
    });

    expect(result).toBe(42);
    const tx = simulateSpy.mock.calls[0]?.[0] as Transaction;
    expect(tx.source).toBe(STATIC_DUMMY_PUBLIC_KEY);
  });

  it('works identically across repeated invocations (no per-call randomness)', async () => {
    const client = new SorobanClient('https://soroban.example.test');
    const simulateSpy = stubSimulation(client, xdr.ScVal.scvBool(true));

    const first = await simulateReadCall(client, {
      contractId: CONTRACT_ID,
      method: 'active',
      args: [],
    });
    const second = await simulateReadCall(client, {
      contractId: CONTRACT_ID,
      method: 'active',
      args: [],
    });

    expect(first).toBe(true);
    expect(second).toBe(true);
    const firstSource = (simulateSpy.mock.calls[0]?.[0] as Transaction).source;
    const secondSource = (simulateSpy.mock.calls[1]?.[0] as Transaction).source;
    expect(firstSource).toBe(secondSource);
    expect(firstSource).toBe(STATIC_DUMMY_PUBLIC_KEY);
  });
});
