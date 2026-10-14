-- AlterTable
ALTER TABLE "AuditEntry" ADD COLUMN     "txid" xid8 NOT NULL DEFAULT pg_current_xact_id();

-- CreateIndex
CREATE INDEX "AuditEntry_txid_idx" ON "AuditEntry"("txid");
