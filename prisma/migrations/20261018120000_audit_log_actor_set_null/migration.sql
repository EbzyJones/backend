-- AlterForeignKey
-- #361: declare `onDelete: SetNull` on `AuditLog.actor` so GDPR / account-deletion
-- purges succeed while preserving the audit trail (actor_id -> NULL instead of P2003).
-- The initial migration already created this FK as ON DELETE SET NULL; this
-- migration re-declares it idempotently so fresh and existing databases converge
-- on the schema-prisma contract.
ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_actor_id_fkey";

ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
