-- The metrics window and the dashboard's failure timeline read events by
-- arrival time; without this, each read scans the whole table.
CREATE INDEX "OperationalEvent_receivedAt_idx" ON "OperationalEvent"("receivedAt");
