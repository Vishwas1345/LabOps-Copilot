-- CreateEnum
CREATE TYPE "LabStatus" AS ENUM ('provisioning', 'ready', 'failed', 'recovering', 'stopped');

-- CreateEnum
CREATE TYPE "LabSource" AS ENUM ('simulated', 'provider');

-- CreateEnum
CREATE TYPE "DependencyStatus" AS ENUM ('healthy', 'degraded', 'down');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('human', 'system', 'worker', 'ai');

-- AlterTable
-- Hand-edited: Prisma generated DROP COLUMN + ADD COLUMN for "status", which
-- would erase every existing lab's status. Convert in place instead. A row
-- holding a value outside the enum makes the cast fail and the migration
-- abort, which is the correct outcome: fix the data, do not guess.
ALTER TABLE "Lab" ADD COLUMN "labType" TEXT NOT NULL DEFAULT 'standard',
ADD COLUMN "source" "LabSource" NOT NULL DEFAULT 'simulated';

ALTER TABLE "Lab" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Lab" ALTER COLUMN "status" TYPE "LabStatus" USING "status"::"LabStatus";
ALTER TABLE "Lab" ALTER COLUMN "status" SET DEFAULT 'provisioning';

-- CreateTable
CREATE TABLE "Dependency" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "DependencyStatus" NOT NULL DEFAULT 'healthy',

    CONSTRAINT "Dependency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LabDependency" (
    "labId" TEXT NOT NULL,
    "dependencyId" TEXT NOT NULL,

    CONSTRAINT "LabDependency_pkey" PRIMARY KEY ("labId","dependencyId")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "correlationId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LabDependency_dependencyId_idx" ON "LabDependency"("dependencyId");

-- CreateIndex
CREATE UNIQUE INDEX "AuditEntry_seq_key" ON "AuditEntry"("seq");

-- CreateIndex
CREATE INDEX "AuditEntry_targetType_targetId_seq_idx" ON "AuditEntry"("targetType", "targetId", "seq");

-- CreateIndex
CREATE INDEX "Lab_createdAt_id_idx" ON "Lab"("createdAt" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "LabDependency" ADD CONSTRAINT "LabDependency_labId_fkey" FOREIGN KEY ("labId") REFERENCES "Lab"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LabDependency" ADD CONSTRAINT "LabDependency_dependencyId_fkey" FOREIGN KEY ("dependencyId") REFERENCES "Dependency"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Append-only audit trail. Prisma cannot express triggers, so this lives only
-- in the migration. Enforced in the database so no code path (including a
-- future one, or a manual psql session as the app role) can rewrite history.
CREATE FUNCTION "audit_entry_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditEntry is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_entry_no_update_delete"
  BEFORE UPDATE OR DELETE ON "AuditEntry"
  FOR EACH ROW EXECUTE FUNCTION "audit_entry_append_only"();

CREATE TRIGGER "audit_entry_no_truncate"
  BEFORE TRUNCATE ON "AuditEntry"
  FOR EACH STATEMENT EXECUTE FUNCTION "audit_entry_append_only"();
