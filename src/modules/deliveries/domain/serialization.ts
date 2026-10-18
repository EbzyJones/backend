import '../../../shared/serialization/bigint.js';
import type { Delivery } from './entities.js';

export interface SerializedDelivery {
  id: string;
  chainDeliveryId: string;
  senderAddress: string;
  recipientAddress: string;
  driverAddress: string | null;
  status: Delivery['status'];
  origin: string;
  destination: string;
  cargoCategory: Delivery['cargoCategory'];
  weightGrams: number;
  fragile: boolean;
  createdAtChain: string;
  transitStartedAt: string | null;
  deliveredAt: string | null;
}

/**
 * Standard serializer for Delivery domain entities. Normalizes bigint
 * fields (`chainDeliveryId`) to strings and dates to ISO strings for API responses.
 */
export function serializeDelivery(delivery: Delivery): SerializedDelivery {
  return {
    id: delivery.id,
    chainDeliveryId: delivery.chainDeliveryId.toString(),
    senderAddress: delivery.senderAddress,
    recipientAddress: delivery.recipientAddress,
    driverAddress: delivery.driverAddress,
    status: delivery.status,
    origin: delivery.origin,
    destination: delivery.destination,
    cargoCategory: delivery.cargoCategory,
    weightGrams: delivery.weightGrams,
    fragile: delivery.fragile,
    createdAtChain: delivery.createdAtChain.toISOString(),
    transitStartedAt: delivery.transitStartedAt?.toISOString() ?? null,
    deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
  };
}
