# Phase 4D Report — Legacy Backfill and Compatibility Migration

> **Subphase:** 4D
> **Date:** 2026-09-10
> **Status:** Implementation complete — awaiting approval before Phase 4E
> **Prerequisite:** Phase 4C approved

---

## 1. Summary

Phase 4D migrates owned `GitSession` rows into the canonical incident model without dropping legacy tables, switches compatibility routes onto domain services, and ends authenticated writes on `incidentId` only.

**Phase 4E has not been started.**

---

## 2. Backfill tool

```
apps/web/scripts/migrate-phase4/
```

| Command | Writes | Notes |
|---|---|---|
| `pnpm migrate:phase4 --dry-run` | None (per-session transaction rolled back) | Default |
| `CONFIRM_PHASE4_BACKFILL=yes pnpm migrate:phase4 --apply` | Commits one GitSession unit per transaction | `--resume`, `--limit`, `--git-session-id` |
| `pnpm migrate:phase4 --reconcile` | None | Exit 1 if any owned-session delta ≠ 0 |

- Advisory lock: `pg_advisory_lock(hashtext('latchops_phase4_backfill'))`
- Checkpoint id: `phase4_backfill_v1`
- Errors logged to `MigrationBackfillError` (source table/id/code only — no snapshot bodies)
- Anonymous sessions (`userId IS NULL`) skipped; never assigned to an organization

### JSON quality

| Condition | Quality |
|---|---|
| Valid `signalsJson` + `planJson` | `canonical` |
| Invalid JSON, valid snapshot | `recomputed` via `analyzeSnapshot` |
| Both invalid | Incident shell; `unrecoverable`; error row |

### Status mapping

`pending` / `analyzing` / `error` → `detected`; `ready` → `plan_ready`; latest `verification_completed` succeeded → `resolved`.

---

## 3. Stale / switch constraints

After owned deltas are zero, `--apply` runs `prisma/manual-migrations/20260910_phase4d_switch.sql`:

- `Snapshot_parent_present_chk`
- `RecoveryPlanRecord(sourceSnapshotId, incidentId) → Snapshot(id, incidentId)`
- `VerificationRun(afterSnapshotId, incidentId) → Snapshot(id, incidentId)`

Not part of `prisma migrate deploy` so expand-only databases can still migrate before backfill.

---

## 4. Compatibility routes

All `/api/sessions*` and `GET /api/incident/[id]` authenticate first, then `resolveIncidentRecord` (`Incident.id` → `legacyGitSessionId` → `GitSession.incidentId`) and `requireIncidentAccess`.

`authorizeSessionAccess` is no longer used.

Deprecation headers: `Deprecation: true`, `Sunset: Sat, 25 Jan 2027 00:00:00 GMT`, `Link` successor v1 incident URL.

`POST /api/sessions` requires session auth and `ingestIncident` via the user's personal organization (unless dual-write flags are on).

---

## 5. Dual-write cutover (4D end)

| Flag | Default | Behaviour |
|---|---|---|
| `PHASE4_READ_SOURCE` | `new` | Canonical reads |
| `PHASE4_LEGACY_WRITES` | `false` | New authenticated snapshots get `incidentId` only |
| `PHASE4_DUAL_WRITE` | `false` | Dual-write only if **also** `PHASE4_LEGACY_WRITES=true` |

Anonymous legacy ingest (dev-only) still writes `GitSession`. CLI ingest was already canonical-only.

---

## 6. Tests

| Area | File |
|---|---|
| Dry-run / apply / idempotency / anonymous skip / resume / CHECK / deletion safety / URL resolve | `phase4-backfill.integration.test.ts` |
| Flags, CLI args, deprecation headers | `phase4-flags.test.ts` |

---

## 7. Validation

| Command | Result |
|---|---|
| `pnpm run lint` | ✅ |
| `pnpm -r typecheck` | ✅ |
| `pnpm -r test` (unit) | ✅ **230 passed** (83 web, 45 state-engine, 73 recovery, 29 cli) |
| `pnpm --filter @latchops/web run test:integration` | ⚠️ Skipped — Docker/Postgres not running (`TEST_DATABASE_URL` unset). **4 new** backfill integration tests are included (59 total when DB is available). |
| `pnpm build:web` | ✅ |

**Unit tests:** 230  
**Integration tests added:** 4 (`phase4-backfill.integration.test.ts`) plus existing 55 when DB is up.

---

## 8. Remaining limitations

| Item | Target |
|---|---|
| Anonymous session claim tokens | Phase 5+ |
| Drop legacy tables | Phase 7+ |
| Redis rate limit | Phase 11 |
| Switch SQL is tool-applied, not `migrate deploy` | Documented in runbook |
| Production rollback | `pg_dump` restore only |

---

## 9. Approval gate

```text
Phase 4D approved. Continue with Phase 4E.
```
