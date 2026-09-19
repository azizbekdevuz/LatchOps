# Phase 4D — Legacy Backfill and Compatibility Migration Plan

> **Prerequisite:** Phase 4C approved.
> **Scope:** Backfill tool, owned-session migration, compatibility route delegation, single business-logic path.

---

## 1. Objective

Migrate legacy owned `GitSession` rows into the new incident model without data loss. Switch compatibility routes to canonical domain services. **Do not drop legacy tables.**

---

## 2. Backfill Tool

### 2.1 Location

```
apps/web/scripts/migrate-phase4/
  index.ts              # CLI entry
  backfill-incidents.ts
  backfill-snapshots.ts
  backfill-plans.ts
  backfill-audit.ts
  reconcile.ts
  checkpoint.ts
  types.ts
  README.md
```

**Package script:** `"migrate:phase4": "tsx apps/web/scripts/migrate-phase4/index.ts"`

### 2.2 CLI interface

```bash
# Dry run (default) — no writes
pnpm migrate:phase4 --dry-run [--limit 100] [--verbose]

# Apply
CONFIRM_PHASE4_BACKFILL=yes pnpm migrate:phase4 --apply [--resume] [--limit N]

# Single session (claim/repair)
pnpm migrate:phase4 --apply --git-session-id <id>

# Reconciliation only
pnpm migrate:phase4 --reconcile
```

### 2.3 Modes

| Mode | DB writes | Checkpoint | Exit code |
|---|---|---|---|
| `--dry-run` | None (rollback transaction) | Stats only | 0 |
| `--apply` | Commits per incident unit | Updates cursor | 0 or 1 on errors |
| `--reconcile` | None | N/A | 1 if delta ≠ 0 |

**Production safeguard:** `--apply` requires `CONFIRM_PHASE4_BACKFILL=yes`.

---

## 3. Backfill Order (FK-safe)

```
1. ensurePersonalOrganization for each User with owned GitSessions
2. For each owned GitSession (batch 200, cursor on id):
   a. upsert Repository (legacy fingerprint = repoRootHash)
   b. create Incident (legacyGitSessionId = GitSession.id)
   c. set GitSession.incidentId = Incident.id
   d. for each Snapshot → set Snapshot.incidentId (keep existing gitSessionId)
   e. for each Analysis → set Analysis.incidentId + create RecoveryPlanRecord
   f. for each Trace → set Trace.incidentId + create AuditEvent
   g. for verification_completed traces → create VerificationRun
   h. set bridge columns (recoveryPlanRecordId, auditEventId) on legacy rows
   i. update checkpoint
3. reconcile totals
4. apply CHECK constraint on Snapshot parent columns (if all deltas zero)
```

**Transaction boundary:** One GitSession + all children = one transaction.

**Concurrency:** Single worker. Advisory lock: `pg_advisory_lock(hashtext('latchops_phase4_backfill'))`.

---

## 4. Entity Mapping

See `PHASE_4A_DESIGN.md` §4.13. Summary:

| Legacy | New / evolved | Bridge / backfill action |
|---|---|---|
| `GitSession` (owned) | `Incident` | `Incident.legacyGitSessionId` UNIQUE; `GitSession.incidentId` set |
| `GitSession.repoRootHash` | `Repository.fingerprint` | `(organizationId, fingerprint)` UNIQUE |
| `Snapshot` | `Snapshot` (same row) | Set `incidentId` on existing row; keep `gitSessionId` |
| `Analysis` | `RecoveryPlanRecord` (new row) | Set `Analysis.incidentId` + `recoveryPlanRecordId` |
| `Trace` | `AuditEvent` (new row) | Set `Trace.incidentId` + `auditEventId` |
| `Trace` (verification_completed) | `VerificationRun` | derived from trace id |

**No `incidentSnapshotId` column.** Snapshot row identity is preserved; both parent FKs may be set during transition.

### 4.1 Nullability by subphase

| Subphase | `Snapshot.gitSessionId` | `Snapshot.incidentId` | Write rule |
|---|---|---|---|
| 4B expand | NOT NULL (existing) | NULL allowed | Legacy writes only |
| 4B dual-write | both set | both set | Atomic single tx |
| 4D backfill | set (legacy) | populated from parent | Backfill sets incidentId |
| 4D switch | both may be set | required for new writes | New writes incidentId only |
| Contract | NULL (no new writes) | NOT NULL | incidentId only |

Same pattern applies to `Analysis` and `Trace`.

### 4.2 Legacy-parent deletion safety

Backfill and reconciliation must confirm:

- Deleting a `GitSession` **SetNull**s `Snapshot.gitSessionId` / `Analysis.gitSessionId` / `Trace.gitSessionId` but **does not** delete canonical `Incident`, `RecoveryPlanRecord`, or `AuditEvent` rows.
- Deleting an `Incident` cascades canonical children and **SetNull**s `GitSession.incidentId`.

### 4.3 Tenant consistency reconciliation

```sql
-- Incident repository must belong to same org
SELECT COUNT(*) FROM "Incident" i
JOIN "Repository" r ON i."repositoryId" = r.id
WHERE i."organizationId" != r."organizationId";

-- Plan source snapshot must belong to same incident (post-backfill)
SELECT COUNT(*) FROM "RecoveryPlanRecord" r
JOIN "Snapshot" s ON r."sourceSnapshotId" = s.id
WHERE s."incidentId" IS DISTINCT FROM r."incidentId";
```

Gate for 4D switch: both counts = 0. Composite FKs on plan/snapshot alignment added in 4D switch migration.

### 4.4 Status mapping

| GitSession.status | Incident.status |
|---|---|
| `pending`, `analyzing` | `detected` |
| `ready` | `plan_ready` |
| `error` | `detected` (+ metadata.legacyError) |

Post-backfill enrichment: if latest verification trace shows `succeeded` → `resolved`.

### 4.5 JSON validation

| Field | Strategy |
|---|---|
| `signalsJson` valid | Use as-is; quality: `canonical` |
| `signalsJson` invalid, snapshot valid | `analyzeSnapshot(snapshot)`; quality: `recomputed` |
| Both invalid | Create incident shell; `incomplete=true`; quality: `unrecoverable` |
| `planJson` | Same pattern |
| `snapshotJson` invalid | Store raw with `metadata.corrupt=true` |

**Never silently cast.** Record quality in `MigrationBackfillError` table or checkpoint metadata.

---

## 5. Anonymous Sessions

**Do not migrate in bulk.**

| Handling | Action |
|---|---|
| `GitSession WHERE userId IS NULL` | Skip; count in report as `skipped_anonymous` |
| Access | Remain legacy-only; no public exposure |
| Future | One-time claim token (Phase 5+) |

**Do not** assign anonymous sessions to any organization.

---

## 6. Invalid Data Handling

**Table:** `MigrationBackfillError`

```prisma
model MigrationBackfillError {
  id          String   @id @default(cuid())
  sourceTable String
  sourceId    String
  errorCode   String   // SIGNALS_INVALID, PLAN_INVALID, SNAPSHOT_INVALID, ...
  errorDetail String?  @db.Text
  occurredAt  DateTime @default(now())
}
```

**Error codes:** `SIGNALS_INVALID`, `PLAN_INVALID`, `SNAPSHOT_INVALID`, `TRACE_INVALID`, `MISSING_FK`, `ORPHAN_ANALYSIS`.

**Behavior:**
- Log error with row ID (no snapshot body content).
- Continue to next row (default).
- `--fail-fast` flag stops on first error.

---

## 7. Idempotency

| Entity | Key | Upsert |
|---|---|---|
| Incident | `legacyGitSessionId` | `ON CONFLICT DO NOTHING` (default) |
| RecoveryPlanRecord | `legacyAnalysisId` | same |
| AuditEvent | `legacyTraceId` | same |
| Snapshot backfill | `Snapshot.id` (same row) | `UPDATE SET incidentId = ?` (idempotent) |

**`--force-repair`:** Upsert by legacy id (update metadata only, never mutate immutable plan JSON).

**Checkpoint:**

```prisma
model MigrationCheckpoint {
  id                      String   @id // "phase4_backfill_v1"
  lastProcessedGitSessionId String?
  lastProcessedAt           DateTime?
  mode                      String
  statsJson                 Json?
}
```

---

## 8. Reconciliation

Run after apply (and in CI against staging clone):

```sql
-- Owned sessions without incident
SELECT COUNT(*) FROM "GitSession" gs
WHERE gs."userId" IS NOT NULL AND gs."incidentId" IS NULL;

-- Snapshot parity: owned sessions with incident but snapshots missing incidentId
SELECT COUNT(*) FROM "Snapshot" s
JOIN "GitSession" gs ON s."gitSessionId" = gs.id
WHERE gs."incidentId" IS NOT NULL AND s."incidentId" IS NULL;

-- Analysis parity
SELECT COUNT(*) FROM "Analysis" a
JOIN "GitSession" gs ON a."gitSessionId" = gs.id
WHERE gs."incidentId" IS NOT NULL AND a."incidentId" IS NULL;

-- Trace parity
SELECT COUNT(*) FROM "Trace" t
JOIN "GitSession" gs ON t."gitSessionId" = gs.id
WHERE gs."incidentId" IS NOT NULL AND t."incidentId" IS NULL;

-- Orphan snapshots (neither parent)
SELECT COUNT(*) FROM "Snapshot"
WHERE "gitSessionId" IS NULL AND "incidentId" IS NULL;
```

**Gate for switch:** All owned-session deltas = 0. Orphan snapshot count = 0. Document unrecoverable count. Acknowledge anonymous skip count.

**Report format:**

```
GitSession (owned):     1,234
Incident created:       1,234  (delta 0) ✓
Snapshot incidentId:    3,456  (delta 0) ✓
Recomputed JSON:             37
Unrecoverable:                3  ⚠
Skipped anonymous:           89
```

---

## 9. Compatibility Routes

Refactor existing routes to **delegate** to domain services. Single business-logic path.

| Legacy route | Delegation |
|---|---|
| `GET /api/incident/[id]` | Resolve `legacyGitSessionId` or `incidentId` → `incidentService.buildIncidentPayload` |
| `GET /api/sessions/[id]` | Same |
| `GET /api/sessions` | `incidentService.listIncidents` for user's orgs |
| `POST /api/sessions` | `incidentService.ingest` via user's default org (session auth) |
| `GET/POST /api/sessions/[id]/plan` | `planService` |
| `POST /api/sessions/[id]/verify` | `verificationService` |
| `POST /api/sessions/[id]/explain` | deterministic explanation from incident payload |
| `POST /api/snapshots/ingest` | Per 4C policy (410 or delegate) |

**Deprecation headers (4D+):**

```
Deprecation: true
Sunset: Sat, 25 Jan 2027 00:00:00 GMT
Link: </api/v1/organizations/{orgId}/incidents/{id}>; rel="successor-version"
```

### 9.1 URL resolution

`/incident/[id]` accepts:
1. `Incident.id` (new)
2. `Incident.legacyGitSessionId` (old GitSession.id)

Lookup order: incident by id → incident by legacyGitSessionId → 404.

### 9.2 Remove interim guard

After all routes delegate to `requireIncidentAccess`, remove `authorizeSessionAccess` usage. Keep `authz-core.ts` tests migrated to `authz-org-core.ts`.

---

## 10. Dual-Write Cutover

| Flag | Phase | Behavior |
|---|---|---|
| `PHASE4_DUAL_WRITE=true` | 4B–4C | Write legacy + new in **one transaction** |
| `PHASE4_READ_SOURCE=new` | 4D | Read new model first |
| `PHASE4_LEGACY_WRITES=false` | 4D end | Stop writing legacy tables |

**4D end state:** New-only writes; legacy read fallback for unmigrated anonymous rows only.

**Contract condition:** After switch, new `Snapshot` rows require `incidentId`; `gitSessionId` is no longer written. Existing rows may retain both FKs until legacy table drop (Phase 7+).

---

## 11. Rollback

Document in `docs/architecture/phase4/MIGRATION_RUNBOOK.md`:

| Scenario | Action |
|---|---|
| Backfill partial | Stop tool; `UPDATE "GitSession" SET "incidentId" = NULL`; `UPDATE "Snapshot" SET "incidentId" = NULL`; truncate new tables; re-run |
| Switch caused bad reads | Set `PHASE4_READ_SOURCE=legacy` |
| Wrong data in new tables | Truncate new tables + null bridges; legacy intact |
| Migration SQL failed | `prisma migrate resolve --rolled-back`; fix; redeploy |

**Production rollback = DB restore from `pg_dump` taken before `--apply`.** No `migrate down` in production.

---

## 12. Required Tests

| Test | Description |
|---|---|
| Dry run writes nothing | Count unchanged after `--dry-run` |
| Apply migrates owned sessions | Fixture DB with 3 sessions |
| Snapshot backfill sets incidentId on same row | No new Snapshot rows created |
| Second run no duplicates | Idempotency |
| Interrupted batch resumes | Kill mid-batch; `--resume` continues |
| Invalid JSON reported | Corrupt analysis row → error logged, continues |
| Anonymous skipped | `userId=null` not migrated |
| Tenant ownership correct | Incident.organizationId matches user's personal org |
| Canonical artefacts validate | Zod parse all migrated JSON |
| Compatibility routes delegate | Legacy GET returns same shape as v1 |
| Reconciliation deltas zero | After full apply |
| URL resolution | Old session ID opens incident room |
| Dual-parent snapshots | Both gitSessionId and incidentId set after backfill |
| CHECK constraint | Orphan snapshot count = 0 before constraint applied |

**Fixtures:** `apps/web/scripts/migrate-phase4/fixtures/legacy-db-seed.ts`

---

## 13. Validation (Phase 4D exit criteria)

Against disposable DB populated with representative Phase 3 fixtures:

```bash
pnpm migrate:phase4 --dry-run    # review report
pnpm migrate:phase4 --apply        # migrate
pnpm migrate:phase4 --reconcile  # delta 0
pnpm -r test
pnpm build:web
```

---

## 14. Approval Gate

```text
Phase 4D approved. Continue with Phase 4E.
```
