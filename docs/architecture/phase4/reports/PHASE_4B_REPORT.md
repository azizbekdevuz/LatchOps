# Phase 4B Report — Multi-Tenant Domain Foundation (Validation Pass)

> **Subphase:** 4B (Implementation + validation)
> **Date:** 2026-07-25
> **Status:** Validation complete — awaiting approval before Phase 4C

---

## 1. Summary

Phase 4B implements the approved Phase 4A multi-tenant domain foundation. This **validation and correction pass** executed migrations against disposable PostgreSQL, verified legacy upgrade safety, inspected PostgreSQL constraints directly, added real database integration tests, fixed atomic dual-write ingest, ran production builds, and documented the CliCredential migration decision.

**Not in scope (deferred to 4C):** CliCredential table and services, authenticated CLI ingest, token verification.

---

## 2. Disposable PostgreSQL setup

| Item | Value |
|---|---|
| **Engine** | PostgreSQL **16** (`postgres:16-alpine`) |
| **Container** | `latchops_test_pg` (Docker, isolated from developer DB on port 5432) |
| **Connection** | `localhost:5433` via Docker port mapping |
| **Databases** | `latchops_empty`, `latchops_phase3`, `latchops_integration` |
| **Credentials** | Stored in local env only — **not committed** |
| **Cleanup** | `docker rm -f latchops_test_pg` removes container and all disposable data |

---

## 3. Empty-database migration validation

**Database:** `latchops_empty` (fresh, no prior schema)

```bash
DATABASE_URL=postgresql://…@localhost:5433/latchops_empty \
  pnpm --filter @latchops/web exec prisma migrate deploy

pnpm --filter @latchops/web exec prisma validate
pnpm --filter @latchops/web exec prisma generate
```

**Result:** ✅ Success

```
Applying migration `0_baseline_phase3`
Applying migration `20260725210000_phase4b_expand_domain`
All migrations have been successfully applied.
The schema at prisma/schema.prisma is valid 🚀
```

Migration sequence matches the committed history exactly.

---

## 4. Representative Phase 3 upgrade validation

**Database:** `latchops_phase3`

### 4.1 Baseline + seed (Phase 3 schema only)

1. Applied `0_baseline_phase3/migration.sql` via `psql`
2. Seeded representative data (`apps/web/scripts/seed-phase3-fixture.sql`):
   - NextAuth `User`, `Account`
   - Owned + anonymous `GitSession`
   - `Snapshot`, `Analysis` (Phase 3 canonical `signalsJson`/`planJson` columns)
   - `PlanStep`, `ConflictFile`, `ConflictHunk`, `Trace`, `Event`

### 4.2 Row counts **before** Phase 4B expand

| Table | Rows |
|---|---:|
| User | 2 |
| GitSession | 2 |
| Snapshot | 2 |
| Analysis | 2 |
| PlanStep | 1 |
| ConflictFile | 1 |
| ConflictHunk | 1 |
| Trace | 2 |
| Event | 2 |
| Organization | 0 |

### 4.3 Upgrade procedure

```bash
DATABASE_URL=postgresql://…@localhost:5433/latchops_phase3 \
  pnpm --filter @latchops/web exec prisma migrate resolve --applied 0_baseline_phase3

DATABASE_URL=postgresql://…@localhost:5433/latchops_phase3 \
  pnpm --filter @latchops/web exec prisma migrate deploy
```

**Result:** ✅ Only `20260725210000_phase4b_expand_domain` applied after baseline resolve.

### 4.4 Row counts **after** Phase 4B expand

| Table | Rows | Notes |
|---|---:|---|
| User | 2 | unchanged |
| GitSession | 2 | unchanged; nullable `incidentId` bridge added |
| Snapshot | 2 | unchanged; nullable `incidentId`, `kind`, `sequence` added |
| Analysis | 2 | unchanged; nullable `incidentId`, `recoveryPlanRecordId` added |
| PlanStep | 1 | unchanged |
| ConflictFile | 1 | unchanged |
| ConflictHunk | 1 | unchanged |
| Trace | 2 | unchanged; nullable `incidentId`, `auditEventId` added |
| Event | 2 | unchanged |
| Organization | 0 | new table; no legacy rows dropped |

**Confirmed:** no legacy table dropped; no legacy row deleted; bridge columns added with safe defaults/nullability.

---

## 5. PostgreSQL constraint inspection

Inspected via `apps/web/scripts/inspect-constraints.mjs` against `latchops_empty`.

### 5.1 Partial unique indexes

| Index | Definition |
|---|---|
| `Membership_one_owner_per_org` | `UNIQUE (organizationId) WHERE role = 'owner'` |
| `RecoveryPlanRecord_one_current_per_incident` | `UNIQUE (incidentId) WHERE isCurrent = true` |

### 5.2 Composite foreign keys

| Constraint | On delete |
|---|---|
| `Incident_repositoryId_organizationId_fkey` | RESTRICT |
| `IdempotencyRecord_incidentId_organizationId_fkey` | CASCADE |
| `RecoveryPlanRecord_incidentId_organizationId_fkey` | CASCADE |
| `VerificationRun_incidentId_organizationId_fkey` | CASCADE |
| `VerificationRun_recoveryPlanRecordId_incidentId_fkey` | CASCADE |

### 5.3 Personal-owner, fingerprint, and legacy-ID uniqueness

| Index | Purpose |
|---|---|
| `Organization_personalOwnerUserId_key` | one personal org per user |
| `Repository_organizationId_fingerprint_key` | tenant-scoped repository identity |
| `Incident_legacyGitSessionId_key` | legacy URL bridge |
| `Incident_id_organizationId_key` | composite tenant key for child FKs |

### 5.4 Legacy / bridge on-delete actions (sample)

| Relation | onDelete |
|---|---|
| `Snapshot.gitSessionId` → GitSession | SET NULL |
| `GitSession.incidentId` → Incident | SET NULL |
| `Snapshot.incidentId` → Incident | CASCADE |
| `Analysis.gitSessionId` → GitSession | SET NULL |
| `Analysis.incidentId` → Incident | CASCADE |
| `Trace.gitSessionId` → GitSession | SET NULL |
| `Trace.incidentId` → Incident | SET NULL |

---

## 6. Database integration tests

**Harness:** `TEST_DATABASE_URL` + `vitest.integration.config.ts` + global `prisma migrate deploy`

```bash
TEST_DATABASE_URL=postgresql://…@localhost:5433/latchops_integration \
  pnpm --filter @latchops/web run test:integration
```

**Result:** ✅ **45 integration tests passed**

| Suite | Tests | Coverage |
|---|---:|---|
| `organization.integration.test.ts` | 7 | personal org idempotency, concurrency, ownership transfer, audit rollback |
| `tenant-isolation.integration.test.ts` | 6 | cross-tenant not-found, viewer deny, member allow, archived deny |
| `lifecycle.integration.test.ts` | 19 | approved/rejected transitions, verification matrix, concurrency, audit rollback |
| `plan-persistence.integration.test.ts` | 4 | version 1 current, atomic supersede, immutable history, corrupt JSON |
| `constraints.integration.test.ts` | 7 | PostgreSQL rejects invalid owner/plan/tenant/fingerprint rows |
| `dual-write.integration.test.ts` | 2 | single-transaction dual parent snapshot; forced failure rollback |

Unit tests remain in `vitest.config.ts` (integration files excluded via `*.integration.test.ts`).

---

## 7. Atomic dual-write (`PHASE4_DUAL_WRITE=true`)

**Correction applied:** `apps/web/src/lib/recovery/dual-write-ingest.ts`

When the flag is enabled and `userId` is present, `ingestSnapshot` delegates to a **single** `prisma.$transaction` that:

1. Ensures personal organization (with advisory lock)
2. Upserts repository fingerprint
3. Creates legacy `GitSession`, `Snapshot`, `Analysis`, conflicts, traces
4. Creates canonical `Incident`, `RecoveryPlanRecord`, links both parent FKs on one `Snapshot` row
5. Writes authoritative `incident.ingested` audit in the same transaction

**Rollback test:** `ingestSnapshotDualWriteWithFailureHook({ failAfterLegacy: true })` proves zero rows remain on either side after forced failure.

**Activation:** set `PHASE4_DUAL_WRITE=true` in environment. Default remains legacy-only ingest.

---

## 8. CliCredential migration decision

**Chosen: Option B — separate Phase 4C migration**

| Option | Decision |
|---|---|
| A — include table in 4B expand migration | ❌ Not chosen |
| B — add `CliCredential` in a dedicated Phase 4C migration | ✅ **Chosen** |

**Rationale:** Phase 4B expand migration is already applied on validation databases without `CliCredential`. Adding the table now would require a third migration anyway; keeping CLI auth schema + services together in 4C matches the approved boundary (“foundation in 4B, credentials in 4C”). Updated `PHASE_4C_CLI_AUTH_PLAN.md` §2.1 accordingly.

**No token behaviour implemented in this pass.**

---

## 9. Full validation commands

| Command | Result |
|---|---|
| `pnpm install` | ✅ |
| `pnpm --filter @latchops/web exec prisma format` | ✅ |
| `pnpm --filter @latchops/web exec prisma validate` | ✅ |
| `pnpm --filter @latchops/web exec prisma generate` | ✅ |
| `pnpm run lint` | ✅ |
| `pnpm -r typecheck` | ✅ |
| `pnpm -r test` (unit) | ✅ **179 passed** (52 web, 45 state-engine, 73 recovery, 9 cli) |
| `pnpm --filter @latchops/web run test:integration` | ✅ **45 passed** (requires `TEST_DATABASE_URL`) |
| `pnpm run build:cli` | ✅ |
| `pnpm build:web` | ✅ (`prisma generate` + `next build`) |
| `prisma migrate deploy` (empty DB) | ✅ both migrations |
| `prisma migrate deploy` (Phase 3 DB) | ✅ phase4b only after baseline resolve |

**Total tests when integration DB available:** **224** (179 unit + 45 integration)

---

## 10. Key files added/updated in validation pass

```
apps/web/src/lib/recovery/dual-write-ingest.ts
apps/web/src/lib/test-support/test-db.ts
apps/web/src/lib/test-support/fixtures.ts
apps/web/src/lib/test-support/integration-setup.ts
apps/web/vitest.integration.config.ts
apps/web/scripts/vitest-integration-global-setup.ts
apps/web/scripts/seed-phase3-fixture.sql
apps/web/scripts/inspect-constraints.mjs
apps/web/src/lib/domain/*.integration.test.ts
apps/web/src/lib/recovery/dual-write.integration.test.ts
docs/architecture/phase4/PHASE_4C_CLI_AUTH_PLAN.md  (Option B note)
```

---

## 11. Remaining limitations

| Limitation | Target phase |
|---|---|
| `CliCredential` table + token services | 4C |
| Authenticated `POST /api/cli/incidents/ingest` | 4C |
| Composite `RecoveryPlanRecord.sourceSnapshot → Snapshot(id, incidentId)` enforcement | 4D (after backfill) |
| `PHASE4_DUAL_WRITE` off by default; not wired to CLI ingest path yet | 4C/4D |
| Route/component e2e tests | 4E |
| Billing, policy engine, LLM explanation layer | post-4E |

---

## 12. Approval gate

Phase 4C has **not** been started.

```text
Phase 4B approved. Continue with Phase 4C.
```
