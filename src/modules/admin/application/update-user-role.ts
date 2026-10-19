import type {
  AdminUnitOfWork,
  AdminUser,
  AuthCacheInvalidator,
  UserRole,
} from '../domain/index.js';
import {
  AdminUserNotFoundError,
  CannotChangeOwnRoleError,
  LastAdministratorError,
} from '../domain/index.js';

export interface UpdateUserRoleDeps {
  unitOfWork: AdminUnitOfWork;
  /** Required, not optional: forgetting to evict the auth guard's cached
   * role/tokenVersion entry (#369) would silently keep a demoted user's
   * privileges alive for the cache TTL on every deployment that omitted
   * it — a wiring mistake that must fail at compile time, not at runtime
   * in production. */
  authCacheInvalidator: AuthCacheInvalidator;
}

export interface UpdateUserRoleInput {
  actorId: string;
  userId: string;
  role: UserRole;
}

/**
 * Every call writes an `AuditLog` row, whether or not the role actually
 * changed — an admin *attempting* to set a role is itself worth recording,
 * not just successful mutations. `actorLabel` is the acting admin's own
 * email, looked up via the same `UserRoleRepository` rather than trusting
 * a client-supplied label, so the audit trail can't be spoofed by
 * whatever the request happens to send.
 *
 * The whole thing runs inside one `AdminUnitOfWork` (#276): the role
 * write, the session revocation, and the audit-log insert either all commit
 * or none do. Sequential awaits here would let a crash (or a failing audit
 * insert) leave a privilege change committed with no record of who made it.
 */
export function createUpdateUserRoleUseCase(deps: UpdateUserRoleDeps) {
  return async function updateUserRole(input: UpdateUserRoleInput): Promise<AdminUser> {
    const updated = await deps.unitOfWork.run(
      async ({ userRoleRepository, auditLogRepository, sessionRevoker }) => {
        const target = await userRoleRepository.findById(input.userId);
        if (!target) throw new AdminUserNotFoundError();

        if (input.actorId === input.userId) {
          throw new CannotChangeOwnRoleError();
        }

        if (target.role === 'ADMIN' && input.role !== 'ADMIN') {
          const adminCount = await userRoleRepository.countByRole('ADMIN');
          if (adminCount <= 1) {
            throw new LastAdministratorError();
          }
        }

        await userRoleRepository.updateRole(input.userId, input.role);

        // Security issue #12: a role change must take effect immediately, not
        // just for future logins/refreshes — see `SessionRevoker`'s doc
        // comment for what this actually closes (stale refresh tokens *and*
        // already-issued access tokens, via `users.token_version`).
        await sessionRevoker.revokeAllForUser(input.userId);

        const actor = await userRoleRepository.findById(input.actorId);
        await auditLogRepository.record({
          actorId: input.actorId,
          actorLabel: actor?.email ?? input.actorId,
          action: 'user.role_updated',
          entityType: 'User',
          entityId: input.userId,
          metadata: { previousRole: target.role, newRole: input.role },
        });

        return { ...target, role: input.role };
      },
    );

    // #369: the shared HTTP auth guard caches `{ role, tokenVersion }` per
    // user in Redis. Evict *here* — after the unit of work commits — not
    // inside `SessionRevoker`: a pre-commit eviction leaves a window in
    // which a concurrent request re-populates the cache from the
    // still-current pre-bump row, and that entry then outlives the commit
    // for the full cache TTL. Post-commit, the next request is guaranteed
    // to re-read the fresh row. Never throws (see `AuthCacheInvalidator`),
    // so a failed eviction can't misreport a committed change as failed.
    await deps.authCacheInvalidator.invalidateUser(input.userId);

    return updated;
  };
}
