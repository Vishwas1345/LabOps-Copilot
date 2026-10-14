-- CreateEnum
CREATE TYPE "RecoveryActionStatus" AS ENUM ('rejected_by_policy', 'awaiting_approval', 'approved', 'rejected', 'expired', 'running', 'succeeded', 'failed', 'blocked');

-- CreateTable
CREATE TABLE "RecoveryAction" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "investigationId" TEXT,
    "actionType" "ActionType" NOT NULL,
    "targetIds" TEXT[],
    "parameters" JSONB NOT NULL,
    "status" "RecoveryActionStatus" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "proposedBy" TEXT NOT NULL,
    "policyDecisions" JSONB NOT NULL,
    "blockedAt" TEXT,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "result" JSONB,
    "verificationResult" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecoveryAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecoveryAction_idempotencyKey_key" ON "RecoveryAction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "RecoveryAction_incidentId_createdAt_idx" ON "RecoveryAction"("incidentId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "RecoveryAction_targetIds_idx" ON "RecoveryAction" USING GIN ("targetIds");

-- AddForeignKey
ALTER TABLE "RecoveryAction" ADD CONSTRAINT "RecoveryAction_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;
