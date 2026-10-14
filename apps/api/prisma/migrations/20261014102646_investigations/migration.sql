-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('RETRY_PROVISIONING', 'RECHECK_DEPENDENCY', 'RERUN_VALIDATION', 'ESCALATE_MANUAL');

-- CreateEnum
CREATE TYPE "InvestigationStatus" AS ENUM ('pending', 'running', 'completed', 'error');

-- CreateEnum
CREATE TYPE "InvestigationOutcome" AS ENUM ('diagnosis', 'insufficient_evidence');

-- CreateEnum
CREATE TYPE "InvestigationFailure" AS ENUM ('TIMEOUT', 'MALFORMED_OUTPUT', 'SCHEMA_REJECTED', 'REFUSED', 'PROVIDER_ERROR', 'JOB_EXHAUSTED');

-- CreateTable
CREATE TABLE "Investigation" (
    "id" TEXT NOT NULL,
    "incidentId" TEXT NOT NULL,
    "status" "InvestigationStatus" NOT NULL DEFAULT 'pending',
    "requestedBy" TEXT NOT NULL,
    "outcome" "InvestigationOutcome",
    "summary" TEXT,
    "candidateCause" TEXT,
    "evidenceFor" TEXT[],
    "evidenceAgainst" TEXT[],
    "missingEvidence" TEXT[],
    "diagnosticChecks" TEXT[],
    "confidence" DOUBLE PRECISION,
    "recommendedAction" "ActionType",
    "targetLabIds" TEXT[],
    "droppedTargets" TEXT[],
    "evidenceSummary" JSONB,
    "failure" "InvestigationFailure",
    "modelMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Investigation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Investigation_incidentId_createdAt_idx" ON "Investigation"("incidentId", "createdAt" DESC);

-- AddForeignKey
ALTER TABLE "Investigation" ADD CONSTRAINT "Investigation_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: one active (pending or running) investigation per incident,
-- so repeated or concurrent requests cannot start a second model call.
CREATE UNIQUE INDEX "Investigation_active_incident_key" ON "Investigation"("incidentId")
  WHERE "status" IN ('pending', 'running');
