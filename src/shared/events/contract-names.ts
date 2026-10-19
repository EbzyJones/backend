/**
 * Canonical `contractName` values for the contracts the indexer tracks
 * (`getTrackedContracts()` in `src/modules/indexer/index.ts`), shared by
 * every module whose event handler filters the one in-process bus
 * (`BlockchainEventEnvelope.contractName`) down to its own contract —
 * the bus carries every tracked contract's events on a single channel
 * (docs/EVENT_INDEXER.md), so "which contract is this event from" is the
 * first question every handler asks.
 *
 * Deliberately plain string values rather than a discriminated union on
 * the envelope: events are read back from `blockchain_events` storage long
 * after deploy, and stored rows must stay assignable. The constants exist
 * so handlers stop re-declaring private copies of the same literals —
 * the same rationale `parse.ts` documents for the payload parsers: a
 * renamed tracked contract is then a single edit here, not a
 * case-by-case grep across modules.
 */
export const ContractName = {
  /** `delivery_contract` — consumed by `deliveries` (and `reputation`'s legacy counter). */
  Delivery: 'delivery',
  /** `escrow_contract` — consumed by `escrow`, `disputes`, `notifications`, `fraud-detection`. */
  Escrow: 'escrow',
  /** `fleet_management_contract` — consumed by `fleet`. */
  Fleet: 'fleet',
  /** `dispute_resolution_contract` (the disputes module's "Layer B") — consumed by `disputes`. */
  DisputeResolution: 'dispute-resolution',
  /** `identity_reputation_contract` — consumed by `reputation`, `users`. */
  IdentityReputation: 'identity-reputation',
} as const;

export type ContractName = (typeof ContractName)[keyof typeof ContractName];
