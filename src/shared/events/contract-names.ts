export const ContractName = {
  Delivery: 'delivery',
  Escrow: 'escrow',
  Fleet: 'fleet',
  DisputeResolution: 'dispute-resolution',
  IdentityReputation: 'identity-reputation',
} as const;

export type ContractName = (typeof ContractName)[keyof typeof ContractName];
