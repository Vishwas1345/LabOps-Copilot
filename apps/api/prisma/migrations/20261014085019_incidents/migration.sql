-- CreateEnum
CREATE TYPE "IncidentStatus" AS ENUM ('open', 'investigating', 'awaiting_approval', 'recovering', 'resolved', 'manual_review');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('low', 'medium', 'high');

-- CreateTable
CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "IncidentStatus" NOT NULL DEFAULT 'open',
    "severity" "Severity" NOT NULL,
    "windowKey" TEXT NOT NULL,
    "anchorEventId" TEXT NOT NULL,
    "confidenceScore" DOUBLE PRECISION,
    "correlationReason" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IncidentLab" (
    "incidentId" TEXT NOT NULL,
    "labId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "signalScore" DOUBLE PRECISION,
    "signals" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IncidentLab_pkey" PRIMARY KEY ("incidentId","labId")
);

-- CreateIndex
CREATE INDEX "Incident_status_createdAt_idx" ON "Incident"("status", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "IncidentLab_labId_idx" ON "IncidentLab"("labId");

-- AddForeignKey
ALTER TABLE "Incident" ADD CONSTRAINT "Incident_anchorEventId_fkey" FOREIGN KEY ("anchorEventId") REFERENCES "OperationalEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentLab" ADD CONSTRAINT "IncidentLab_incidentId_fkey" FOREIGN KEY ("incidentId") REFERENCES "Incident"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentLab" ADD CONSTRAINT "IncidentLab_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncidentLab" ADD CONSTRAINT "IncidentLab_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "OperationalEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written: one open incident per correlation window key. Prisma cannot
-- express a partial unique index; resolved incidents free the key.
CREATE UNIQUE INDEX "Incident_open_windowKey_key" ON "Incident"("windowKey")
  WHERE "status" <> 'resolved';
