-- A configured connection to an external lab platform. One row per provider.
--
-- The state enum starts at not_configured, which is the only honest value until
-- a connector has actually verified itself. There is deliberately no column for
-- a plaintext credential: encryptedCredentials holds AES-256-GCM bytes, and
-- keyVersion records which key sealed them so rotation stays contained.
CREATE TYPE "IntegrationState" AS ENUM (
    'not_configured',
    'connecting',
    'connected',
    'error',
    'needs_attention'
);

CREATE TABLE "IntegrationConnection" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "state" "IntegrationState" NOT NULL DEFAULT 'not_configured',
    "encryptedCredentials" BYTEA,
    "keyVersion" INTEGER,
    "supportedEventTypes" JSONB,
    "lastSuccessfulTestAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IntegrationConnection_pkey" PRIMARY KEY ("id")
);

-- One connection per provider: a second PUT updates rather than duplicates.
CREATE UNIQUE INDEX "IntegrationConnection_provider_key" ON "IntegrationConnection"("provider");

-- The settings page lists every provider, connected or not.
CREATE INDEX "IntegrationConnection_state_idx" ON "IntegrationConnection"("state");