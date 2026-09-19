# Phase 4D Migration Runbook

> Take a `pg_dump` before any production `--apply`. Production rollback is restore-from-dump. There is no `migrate down`.

## 1. Backfill

```bash
pnpm migrate:phase4 --dry-run --verbose
CONFIRM_PHASE4_BACKFILL=yes pnpm migrate:phase4 --apply --resume
pnpm migrate:phase4 --reconcile
```

`--apply` refuses to run unless `CONFIRM_PHASE4_BACKFILL=yes`.

Single worker. The process takes `pg_advisory_lock(hashtext('latchops_phase4_backfill'))`.

After owned-session reconciliation deltas are zero, the tool applies:

- `Snapshot_parent_present_chk` (`gitSessionId IS NOT NULL OR incidentId IS NOT NULL`)
- composite FKs aligning `RecoveryPlanRecord` / `VerificationRun` snapshots to `Snapshot(id, incidentId)`

Anonymous `GitSession` rows are never assigned to an organization.

## 2. Feature flags (4D end state)

| Flag | 4D value | Meaning |
|---|---|---|
| `PHASE4_READ_SOURCE` | `new` (default) | Compatibility routes read `Incident` first |
| `PHASE4_LEGACY_WRITES` | `false` (default) | New authenticated writes use `incidentId` only |
| `PHASE4_DUAL_WRITE` | `false` | Dual-write only if this **and** `PHASE4_LEGACY_WRITES=true` |

Rollback reads: `PHASE4_READ_SOURCE=legacy`.

## 3. Failure scenarios

| Scenario | Action |
|---|---|
| Backfill partial | Stop the tool. Optionally `UPDATE "GitSession" SET "incidentId" = NULL` and null `Snapshot.incidentId` / `Analysis.incidentId` / `Trace.incidentId` for rows you intend to redo; truncate `RecoveryPlanRecord`, `VerificationRun`, `Incident` (owned bridges only); re-run `--apply --resume` or `--force-repair` |
| Switch caused bad reads | Set `PHASE4_READ_SOURCE=legacy` |
| Wrong data in new tables | Truncate new canonical rows and null bridges; legacy tables stay intact |
| Migration SQL failed | `prisma migrate resolve --rolled-back`; fix; redeploy |
| Production data loss | Restore from the pre-`--apply` `pg_dump` |

## 4. Legacy-parent deletion

- Deleting a `GitSession` **SetNull**s `Snapshot.gitSessionId` / `Analysis.gitSessionId` / `Trace.gitSessionId` and does **not** delete `Incident`, `RecoveryPlanRecord`, or `AuditEvent`.
- Deleting an `Incident` cascades canonical children and **SetNull**s `GitSession.incidentId`.
- After the parent CHECK is applied, a snapshot must keep at least one parent. Deleting an anonymous `GitSession` whose snapshots have no `incidentId` will fail the CHECK (by design — those rows were never migrated).
