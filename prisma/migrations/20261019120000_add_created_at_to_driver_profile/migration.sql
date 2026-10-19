-- AlterTable
ALTER TABLE "driver_profiles" ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Backfill existing rows from registeredAt so createdAt reflects when the
-- off-chain record was first indexed rather than the migration timestamp.
UPDATE "driver_profiles" SET "created_at" = "registered_at";