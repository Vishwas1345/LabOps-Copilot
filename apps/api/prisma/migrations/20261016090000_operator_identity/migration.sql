-- Google sign-in. An operator created through Google has no password, and its
-- link to Google is the provider's stable subject id, unique per provider.
ALTER TABLE "Operator" ALTER COLUMN "passwordHash" DROP NOT NULL;

CREATE TABLE "OperatorIdentity" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "operatorId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperatorIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OperatorIdentity_provider_subject_key" ON "OperatorIdentity"("provider", "subject");
CREATE INDEX "OperatorIdentity_operatorId_idx" ON "OperatorIdentity"("operatorId");

ALTER TABLE "OperatorIdentity" ADD CONSTRAINT "OperatorIdentity_operatorId_fkey"
    FOREIGN KEY ("operatorId") REFERENCES "Operator"("id") ON DELETE CASCADE ON UPDATE CASCADE;
