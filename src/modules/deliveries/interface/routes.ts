import type { FastifyRequest } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { authenticate, ok, requireUser } from '../../../shared/http/index.js';
import { ForbiddenError } from '../../../shared/errors/app-error.js';
import type { Delivery } from '../domain/index.js';
import type { WalletAddressRepository } from '../../users/domain/index.js';
import type {
  createBuildDeliveryTransactionsUseCases,
  createGetDeliveryUseCase,
  createListDeliveriesUseCase,
} from '../application/index.js';
import {
  assignDriverBodySchema,
  cancelDeliveryBodySchema,
  confirmDeliveryBodySchema,
  createDeliveryBodySchema,
  deliveryIdParamsSchema,
  getDeliveryResponseSchema,
  listDeliveriesQuerySchema,
  listDeliveriesResponseSchema,
  markInTransitBodySchema,
  raiseDisputeBodySchema,
  transactionResponseSchema,
} from './schemas.js';

export interface DeliveriesUseCases {
  listDeliveries: ReturnType<typeof createListDeliveriesUseCase>;
  getDelivery: ReturnType<typeof createGetDeliveryUseCase>;
  buildTransactions: ReturnType<typeof createBuildDeliveryTransactionsUseCases>;
}

/**
 * Route-level dependencies that are not use cases — here the wallet-ownership
 * read used to authorize transaction building against the shared
 * `wallet_addresses` table (same deliberate cross-module read precedent as
 * `disputes` and `notifications`; the address→user link lives in `users`).
 */
export interface DeliveriesRoutesConfig {
  walletAddressRepository: WalletAddressRepository;
}

/**
 * Ensures `callerAddress` belongs to the authenticated user before any
 * delivery transaction envelope is built for it, so a user can only build
 * transactions sourced from wallets linked to their own account
 * (#381). Throws `ForbiddenError` (HTTP 403) otherwise.
 */
async function ensureCallerOwnedByUser(
  config: DeliveriesRoutesConfig,
  request: FastifyRequest,
): Promise<void> {
  const user = requireUser(request);
  const { callerAddress } = request.body as { callerAddress?: string };
  const wallet = callerAddress
    ? await config.walletAddressRepository.findByAddress(callerAddress)
    : null;
  if (!wallet || wallet.userId !== user.id) {
    throw new ForbiddenError('Caller address is not linked to your account');
  }
}

function serializeDelivery(delivery: Delivery) {
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

export function createDeliveriesRoutes(
  useCases: DeliveriesUseCases,
  config: DeliveriesRoutesConfig,
): FastifyPluginAsyncZod {
  return async function deliveriesRoutes(app) {
    app.get(
      '/deliveries',
      {
        preHandler: authenticate,
        schema: {
          querystring: listDeliveriesQuerySchema,
          response: { 200: listDeliveriesResponseSchema },
        },
      },
      async (request, reply) => {
        const { senderAddress, recipientAddress, driverAddress, status } = request.query;
        const deliveries = await useCases.listDeliveries({
          ...(senderAddress && { senderAddress }),
          ...(recipientAddress && { recipientAddress }),
          ...(driverAddress && { driverAddress }),
          ...(status && { status }),
        });
        void reply.status(200).send(ok(deliveries.map(serializeDelivery)));
      },
    );

    app.get(
      '/deliveries/:chainDeliveryId',
      {
        preHandler: authenticate,
        schema: { params: deliveryIdParamsSchema, response: { 200: getDeliveryResponseSchema } },
      },
      async (request, reply) => {
        const delivery = await useCases.getDelivery({
          chainDeliveryId: BigInt(request.params.chainDeliveryId),
        });
        void reply.status(200).send(ok(serializeDelivery(delivery)));
      },
    );

    app.post(
      '/transactions/build/create-delivery',
      {
        preHandler: authenticate,
        schema: { body: createDeliveryBodySchema, response: { 200: transactionResponseSchema } },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildCreateDeliveryTransaction({
          ...request.body,
          estimatedDelivery: new Date(request.body.estimatedDelivery),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/assign-driver',
      {
        preHandler: authenticate,
        schema: { body: assignDriverBodySchema, response: { 200: transactionResponseSchema } },
      },
      async (request, reply) => {
        await ensureCallerOwnedByUser(config, request);
        const xdrEnvelope = await useCases.buildTransactions.buildAssignDriverTransaction({
          ...request.body,
          chainDeliveryId: BigInt(request.body.chainDeliveryId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/mark-in-transit',
      {
        preHandler: authenticate,
        schema: { body: markInTransitBodySchema, response: { 200: transactionResponseSchema } },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildMarkInTransitTransaction({
          ...request.body,
          chainDeliveryId: BigInt(request.body.chainDeliveryId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/confirm-delivery',
      {
        onRequest: [authenticate],
        schema: { body: confirmDeliveryBodySchema, response: { 200: transactionResponseSchema } },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildConfirmDeliveryTransaction({
          ...request.body,
          chainDeliveryId: BigInt(request.body.chainDeliveryId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    app.post(
      '/transactions/build/cancel-delivery',
      {
        preHandler: authenticate,
        schema: { body: cancelDeliveryBodySchema, response: { 200: transactionResponseSchema } },
      },
      async (request, reply) => {
        const xdrEnvelope = await useCases.buildTransactions.buildCancelDeliveryTransaction({
          ...request.body,
          chainDeliveryId: BigInt(request.body.chainDeliveryId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );

    // Deliberately `raise-delivery-dispute`, not `raise-dispute`: this builds
    // an invocation of `delivery_contract.raise_dispute` (Layer A — pauses
    // the delivery/escrow, cross-calling `escrow_contract.raise_dispute`;
    // PHASE_1_DOMAIN_ANALYSIS.md §10's call graph), a genuinely different
    // on-chain action from the `disputes` module's own
    // `POST /transactions/build/raise-dispute`, which invokes
    // `dispute_resolution_contract.raise_dispute` (Layer B — creates the
    // richer arbitration `DisputeCase` with evidence support, and itself
    // cross-calls this same `delivery_contract.raise_dispute` when
    // applicable). The two routes collided under the identical path before
    // this rename (`FST_ERR_DUPLICATED_ROUTE`, crashing `buildApp()`) — see
    // `tests/e2e/app.e2e.spec.ts`'s regression test. `disputes` keeps the
    // shorter, canonical path since it owns the complete dispute lifecycle
    // (raise → evidence → resolve) as one cohesive, already-tested REST
    // surface; this endpoint's request/response shape and behavior are
    // otherwise completely unchanged.
    app.post(
      '/transactions/build/raise-delivery-dispute',
      {
        preHandler: authenticate,
        schema: { body: raiseDisputeBodySchema, response: { 200: transactionResponseSchema } },
      },
      async (request, reply) => {
        await ensureCallerOwnedByUser(config, request);
        const xdrEnvelope = await useCases.buildTransactions.buildRaiseDisputeTransaction({
          ...request.body,
          chainDeliveryId: BigInt(request.body.chainDeliveryId),
        });
        void reply.status(200).send(ok({ xdr: xdrEnvelope }));
      },
    );
  };
}
