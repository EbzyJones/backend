import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { PrismaClient } from '@prisma/client';
import {
  createListAuditLogUseCase,
  createListOpenDisputesUseCase,
  createUpdateUserRoleUseCase,
} from './application/index.js';
import {
  createPrismaAdminUnitOfWork,
  createPrismaAuditLogRepository,
  createPrismaDisputeReviewReader,
} from './infrastructure/index.js';
import { createAdminRoutes } from './interface/routes.js';
import { invalidateAuthContext } from '../../shared/cache/index.js';

/** No blockchain-event subscription, unlike most other modules — `admin`
 * is thin orchestration over other modules' already-synced read models
 * plus its own off-chain-only role/audit-log state, not something the
 * chain has an event for. Nothing for `src/workers/index.ts` to wire. */
export function createAdminModule(prisma: PrismaClient): FastifyPluginAsyncZod {
  const disputeReviewReader = createPrismaDisputeReviewReader(prisma);
  const auditLogRepository = createPrismaAuditLogRepository(prisma);
  const unitOfWork = createPrismaAdminUnitOfWork(prisma);

  const useCases = {
    listOpenDisputes: createListOpenDisputesUseCase({ disputeReviewReader }),
    updateUserRole: createUpdateUserRoleUseCase({
      unitOfWork,
      // #369: role changes must evict the shared auth guard's cached
      // `{ role, tokenVersion }` entry right after commit, or a demoted
      // user's stale token keeps passing the guard's check until the cache
      // TTL expires. `invalidateAuthContext` never throws (it logs and
      // degrades to the TTL bound), so this can't fail a committed change.
      authCacheInvalidator: { invalidateUser: invalidateAuthContext },
    }),
    listAuditLog: createListAuditLogUseCase({ auditLogRepository }),
  };

  return createAdminRoutes(useCases);
}
