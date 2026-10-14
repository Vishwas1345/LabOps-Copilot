-- CreateEnum
CREATE TYPE "ErrorCategory" AS ENUM ('PROVISION_TIMEOUT', 'NETWORK_CONFIG', 'PERMISSION_DENIED', 'DEPENDENCY_UNAVAILABLE', 'QUOTA_EXCEEDED', 'VALIDATION_FAILED');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('provision_succeeded', 'provision_failed');

-- CreateTable
CREATE TABLE "OperationalEvent" (
    "id" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "type" "EventType" NOT NULL,
    "errorCategory" "ErrorCategory",
    "dependencyId" TEXT,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "source" "LabSource" NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deduplicationKey" TEXT NOT NULL,

    CONSTRAINT "OperationalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OperationalEvent_deduplicationKey_key" ON "OperationalEvent"("deduplicationKey");

-- CreateIndex
CREATE INDEX "OperationalEvent_labId_occurredAt_idx" ON "OperationalEvent"("labId", "occurredAt");

-- CreateIndex
CREATE INDEX "OperationalEvent_errorCategory_occurredAt_idx" ON "OperationalEvent"("errorCategory", "occurredAt");

-- CreateIndex
CREATE INDEX "OperationalEvent_dependencyId_occurredAt_idx" ON "OperationalEvent"("dependencyId", "occurredAt");

-- AddForeignKey
ALTER TABLE "OperationalEvent" ADD CONSTRAINT "OperationalEvent_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OperationalEvent" ADD CONSTRAINT "OperationalEvent_dependencyId_fkey" FOREIGN KEY ("dependencyId") REFERENCES "Dependency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Hand-written: Prisma cannot express CHECK constraints. A failure without a
-- category could never be correlated; a success with one would be nonsense.
ALTER TABLE "OperationalEvent" ADD CONSTRAINT "OperationalEvent_category_matches_type"
  CHECK (("type" = 'provision_failed') = ("errorCategory" IS NOT NULL));
