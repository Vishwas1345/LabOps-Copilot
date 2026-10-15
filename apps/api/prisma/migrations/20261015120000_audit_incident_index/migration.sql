-- An incident's history includes entries that name it in metadata.incidentId
-- (investigation, proposal, approval, execution, verification), not only those
-- that target it. An expression index Prisma cannot declare; see audit.ts.
CREATE INDEX "AuditEntry_metadata_incidentId_seq_idx"
  ON "AuditEntry" ((metadata->>'incidentId'), seq);
