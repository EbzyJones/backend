-- CreateIndex
CREATE INDEX IF NOT EXISTS "escrows_sender_address_idx" ON "escrows"("sender_address");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "escrows_recipient_address_idx" ON "escrows"("recipient_address");
