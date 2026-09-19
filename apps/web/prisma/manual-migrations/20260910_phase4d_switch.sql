-- Applied by the Phase 4D backfill tool after owned-session reconciliation
-- deltas are zero. Do not run before backfill: CHECK fails on orphan snapshots
-- and composite FKs require Snapshot.incidentId on plan/verification parents.
--
-- Idempotent: skips constraints that already exist.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Snapshot_parent_present_chk'
  ) THEN
    ALTER TABLE "Snapshot"
      ADD CONSTRAINT "Snapshot_parent_present_chk"
      CHECK ("gitSessionId" IS NOT NULL OR "incidentId" IS NOT NULL);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'RecoveryPlanRecord_sourceSnapshot_incident_fkey'
  ) THEN
    ALTER TABLE "RecoveryPlanRecord"
      ADD CONSTRAINT "RecoveryPlanRecord_sourceSnapshot_incident_fkey"
      FOREIGN KEY ("sourceSnapshotId", "incidentId")
      REFERENCES "Snapshot"("id", "incidentId")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'VerificationRun_afterSnapshot_incident_fkey'
  ) THEN
    ALTER TABLE "VerificationRun"
      ADD CONSTRAINT "VerificationRun_afterSnapshot_incident_fkey"
      FOREIGN KEY ("afterSnapshotId", "incidentId")
      REFERENCES "Snapshot"("id", "incidentId")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
