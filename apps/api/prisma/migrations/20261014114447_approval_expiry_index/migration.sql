-- CreateIndex
CREATE INDEX "RecoveryAction_status_expiresAt_idx" ON "RecoveryAction"("status", "expiresAt");
