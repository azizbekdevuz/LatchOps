# Phase 4D backfill tool

Migrates owned `GitSession` rows into `Incident` without dropping legacy tables.

## Commands

```bash
# Dry run (default) — no writes
pnpm migrate:phase4 --dry-run [--limit 100] [--verbose]

# Apply (requires confirmation)
CONFIRM_PHASE4_BACKFILL=yes pnpm migrate:phase4 --apply [--resume] [--limit N]

# Single session
CONFIRM_PHASE4_BACKFILL=yes pnpm migrate:phase4 --apply --git-session-id <id>

# Reconciliation only
pnpm migrate:phase4 --reconcile
```

`--apply` requires `CONFIRM_PHASE4_BACKFILL=yes`.

Single worker. Takes `pg_advisory_lock(hashtext('latchops_phase4_backfill'))`.

## Safety

Pending payloads and snapshots may contain repository paths. Error rows store IDs and codes only, never snapshot bodies.

Anonymous `GitSession` rows (`userId IS NULL`) are skipped and never assigned to an organization.

Age/count of pending CLI state is unrelated; this tool only reads the database.

## Rollback

See `docs/architecture/phase4/MIGRATION_RUNBOOK.md`.
