-- Phase 3 compatibility migration: canonical deterministic-engine fields.
--
-- This repository applies schema changes with `prisma db push` (see the
-- `db:push` script and the absence of a prisma `migrations/` directory), so this
-- file is the human-readable record of the DDL that `db push` performs. It is
-- intentionally idempotent and additive (all columns are nullable) so existing
-- rows remain valid and no data is lost. Apply with either:
--
--   pnpm --filter @latchops/web db:push        (primary, matches repo convention)
--   psql "$DATABASE_URL" -f this-file.sql       (equivalent manual apply)
--
-- Phase 4 will promote these JSON columns into normalized tables.

ALTER TABLE "Analysis" ADD COLUMN IF NOT EXISTS "signalsJson" JSONB;
ALTER TABLE "Analysis" ADD COLUMN IF NOT EXISTS "planJson" JSONB;
ALTER TABLE "Analysis" ADD COLUMN IF NOT EXISTS "risk" TEXT;
ALTER TABLE "Analysis" ADD COLUMN IF NOT EXISTS "engineVersion" TEXT;
