-- The trace an incident was born in, so the investigation and the recovery
-- join it and one incident reads as one trace. Null for older incidents.
ALTER TABLE "Incident" ADD COLUMN "traceparent" TEXT;
