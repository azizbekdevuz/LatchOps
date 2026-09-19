# Phase 4B — Multi-Tenant Domain Foundation Implementation Plan

> **Prerequisite:** Phase 4A approved (including design-correction pass).
> **Scope:** Organizations, memberships, repositories, incidents, recovery-plan records, verification runs, audit events, lifecycle, centralized tenant authorization. **No CLI credentials** (Phase 4C).

---

## 1. Objective

Implement the approved Phase 4A schema and domain services so that:

1. All new domain entities exist in committed Prisma migrations.
2. Domain services enforce tenant isolation and lifecycle rules.
3. Interim `authorizeSessionAccess` remains until 4D switches all consumers.
4. Legacy tables are retained with bridge columns (dual-parent nullable FK pattern).

---

## 2. Prisma Migration (Expand)

### 2.1 Bootstrap committed migrations

One-time setup (first commit in 4B):

```bash
# 1. Baseline current schema as migration 0
pnpm --filter @latchops/web exec prisma migrate diff \
  --from-empty --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/0_baseline_phase3/migration.sql

# 2. On existing DBs: mark baseline applied without re-running
pnpm --filter @latchops/web exec prisma migrate resolve --applied 0_baseline_phase3

# 3. Add Phase 4 models
pnpm --filter @latchops/web exec prisma migrate dev --name phase4b_expand_domain
```

Update `apps/web/package.json`:

```json
"db:migrate": "prisma migrate deploy",
"db:migrate:dev": "prisma migrate dev"
```

Deprecate `db:push` in docs (dev-only with warning).

### 2.2 Migration contents

**New tables:** `Organization`, `Membership`, `Repository`, `Incident`, `RecoveryPlanRecord`, `VerificationRun`, `AuditEvent`, `IdempotencyRecord` (schema only; used in 4C).

**New columns on `Organization`:**

| Column | Constraint |
|---|---|
| `personalOwnerUserId String?` | `@unique` — one personal org per user |

**Bridge columns on legacy tables (nullable; no NOT NULL before backfill):**

| Legacy | Column | Notes |
|---|---|---|
| `GitSession` | `incidentId String? @unique` | Bridge to `Incident` |
| `Snapshot` | `incidentId String?` | Dual-parent: keep existing `gitSessionId`; add nullable `incidentId` |
| `Analysis` | `incidentId String?` | Dual-parent: keep existing `gitSessionId`; add nullable `incidentId` |
| `Analysis` | `recoveryPlanRecordId String? @unique` | Bridge to `RecoveryPlanRecord` |
| `Trace` | `incidentId String?` | Dual-parent: keep existing `gitSessionId`; add nullable `incidentId` |
| `Trace` | `auditEventId String? @unique` | Bridge to `AuditEvent` |

**Do NOT add:** `incidentSnapshotId` or any separate snapshot bridge table.

**Legacy-parent `onDelete` (mandatory in expand migration):**

| Table.column | `onDelete` |
|---|---|
| `Snapshot.gitSessionId` | `SetNull` |
| `Snapshot.incidentId` | `Cascade` |
| `Analysis.gitSessionId` | `SetNull` |
| `Analysis.incidentId` | `Cascade` |
| `Trace.gitSessionId` | `SetNull` |
| `Trace.incidentId` | `SetNull` |
| `GitSession.incidentId` | `SetNull` |

**Tenant composite FKs (4B expand):**

```prisma
Repository  @@unique([id, organizationId])
Incident      @@unique([id, organizationId])
Incident.repository → Repository(id, organizationId)
IdempotencyRecord.incident → Incident(id, organizationId)  // schema in 4B, used in 4C
```

**Deferred to 4D switch** (requires `Snapshot.incidentId` NOT NULL on owned rows):

```prisma
Snapshot @@unique([id, incidentId])
RecoveryPlanRecord.sourceSnapshot → Snapshot(id, incidentId)
VerificationRun.afterSnapshot → Snapshot(id, incidentId)
```

**Partial unique indexes (raw SQL in migration):**

```sql
CREATE UNIQUE INDEX "Membership_one_owner_per_org"
  ON "Membership" ("organizationId") WHERE role = 'owner';

CREATE UNIQUE INDEX "RecoveryPlanRecord_one_current_per_incident"
  ON "RecoveryPlanRecord" ("incidentId") WHERE "isCurrent" = true;
```

**Post-backfill CHECK (added in 4D migration, not 4B):**

```sql
ALTER TABLE "Snapshot" ADD CONSTRAINT "Snapshot_at_least_one_parent"
  CHECK ("gitSessionId" IS NOT NULL OR "incidentId" IS NOT NULL);
```

**Prisma partial-index compatibility:** Partial indexes are not expressible in Prisma schema DSL. They are added via explicit SQL in `migration.sql`. CI runs `prisma migrate deploy` against disposable Postgres and asserts indexes exist via `pg_indexes` query.

**Do not drop:** `GitSession`, `Analysis`, `PlanStep`, `ConflictFile`, `ConflictHunk`, `Trace`, `Event`.

---

## 3. Repository Layer

Create `apps/web/src/lib/repositories/` with org-scoped access:

| File | Responsibility |
|---|---|
| `organization.repository.ts` | CRUD, membership queries |
| `repository.repository.ts` | Fingerprint upsert, list by org |
| `incident.repository.ts` | CRUD with mandatory `organizationId` |
| `plan.repository.ts` | Versioned plan records |
| `verification.repository.ts` | VerificationRun persistence |
| `audit.repository.ts` | Append-only AuditEvent (authoritative + telemetry) |

**Rule:** Every method signature includes `organizationId: string` for tenant-owned models. `findById(id, organizationId)` — never `findById(id)` alone.

---

## 4. Domain Services

### 4.1 organization-service.ts

| Method | Description |
|---|---|
| `createOrganization(userId, { name, slug? })` | Create team org; caller → sole owner |
| `ensurePersonalOrganization(userId)` | Idempotent; `personalOwnerUserId @unique` + advisory lock + retry |
| `getOrganizationsForUser(userId)` | List with roles |
| `addMember(orgId, email, role)` | Invite (admin+) |
| `updateMemberRole(orgId, targetUserId, role)` | Cannot change owner without `transferOwnership` |
| `transferOwnership(orgId, fromUserId, toUserId)` | Atomic sole-owner transfer + authoritative audit |
| `removeMember(orgId, targetUserId)` | Block sole owner removal |
| `archiveOrganization(orgId)` | Owner-only; authoritative audit; set status archived |

### 4.2 repository-service.ts

| Method | Description |
|---|---|
| `computeFingerprint(snapshot)` | Pure algorithm (§6 of PHASE_4A_DESIGN) |
| `upsertRepository(orgId, snapshot)` | Find-or-create by fingerprint |
| `listRepositories(orgId, pagination)` | Tenant-scoped list |
| `touchLastSeen(repoId, orgId)` | Update lastSeenAt |

### 4.3 incident-service.ts

| Method | Description |
|---|---|
| `ingest({ orgId, snapshot, userId?, source })` | Transactional ingest pipeline |
| `getIncident(orgId, incidentId)` | Load with relations |
| `buildIncidentPayload(incident)` | Replaces `buildIncidentPayload(session)` |
| `listIncidents(orgId, filters)` | Paginated, tenant-scoped |
| `transition(incidentId, orgId, action, actor, meta)` | Lifecycle state machine + authoritative audit |

### 4.4 plan-service.ts

| Method | Description |
|---|---|
| `getCurrentPlan(incidentId, orgId)` | Return `RecoveryPlanV1` |
| `regeneratePlan(incidentId, orgId)` | New version; authoritative audit; mark old `isCurrent=false` |
| `persistPlan(incidentId, orgId, signals, plan, snapshotId)` | Insert RecoveryPlanRecord |

### 4.5 verification-service.ts

| Method | Description |
|---|---|
| `verify({ incidentId, orgId, afterSnapshot, selectedAlternativeId })` | Full verify flow + authoritative audit |
| `getLatestVerification(incidentId, orgId)` | For payload assembly |

### 4.6 audit-service.ts

| Method | Description |
|---|---|
| `recordAuthoritative(tx, event)` | **Throws on failure** — rolls back caller transaction |
| `recordTelemetry(event)` | Best-effort; catches errors; never throws to caller |
| `listForIncident(incidentId, orgId)` | Admin+ audit trail |

Authoritative actions: ownership transfer, role change/removal, org archival, lifecycle transitions, plan regeneration, CLI credential create/revoke (4C), ingest.

### 4.7 lifecycle.ts (pure)

```typescript
export function canTransition(from: IncidentStatus, action: TransitionAction, role: MembershipRole): boolean
export function nextStatus(from: IncidentStatus, action: TransitionAction): IncidentStatus | null
```

---

## 5. Authorization

### 5.1 New modules

```
apps/web/src/lib/authz-org-core.ts   # pure decisions
apps/web/src/lib/authz-org.ts        # async wrappers
```

### 5.2 Functions

- `requireOrganizationMember(orgId, { minRole })`
- `requireOrganizationRole(orgId, roles[])`
- `requireRepositoryAccess(repoId, { minRole })`
- `requireIncidentAccess(incidentId, { minRole })`
- `assertOrgWritable(orgId)`

### 5.3 Interim guard

Keep `authorizeSessionAccess` unchanged in 4B. New v1 routes use org authz. Legacy routes continue using interim guard until 4D.

---

## 6. Snapshot Schema Extension

**Package:** `packages/schema/src/snapshot.ts`

Add optional fields (backward compatible):

```typescript
remotes?: Array<{ name: string; url: string }>;
rootCommitOid?: string | null;
```

**State engine:** `packages/state-engine/src/collectors/remotes.ts`, `root-commit.ts`; wire in `capture.ts`.

---

## 7. Personal Organization Bootstrap

**Trigger points:**

1. Post-login hook in `auth.ts` callbacks (`signIn` / `session` callback).
2. `POST /api/auth/register` — create personal org after user creation.

**Idempotency:** `ensurePersonalOrganization` uses:
- `Organization.personalOwnerUserId @unique` (database-enforced)
- `pg_advisory_xact_lock(hashtext('personal_org:' || userId))` inside transaction
- On unique violation → retry read (concurrent first-login race)

---

## 8. Dual-Write (Feature-Flagged)

During 4B, new ingest paths write to **both** legacy and new models when `PHASE4_DUAL_WRITE=true`:

```
ingestSnapshot (legacy) + incidentService.ingest (new)
```

**Atomic requirement:** When dual-write is enabled, the legacy `Snapshot` row receives **both** `gitSessionId` and `incidentId` in the **same database transaction** as the new `Incident` + `RecoveryPlanRecord` writes. Never split across separate transactions.

Default `false` until 4D switch. Allows testing new model without breaking existing UI.

---

## 9. Required Tests

| Area | Test file | Cases |
|---|---|---|
| Organization | `organization-service.test.ts` | create, slug uniqueness, personal org idempotent |
| Personal org concurrency | `organization-service.test.ts` | parallel `ensurePersonalOrganization` → one org |
| Membership | `organization-service.test.ts` | uniqueness, sole-owner invariant |
| Ownership transfer | `organization-service.test.ts` | atomic transfer; concurrent transfer → 409 |
| Archived org | `organization-service.test.ts` | writes blocked; transfer blocked |
| Roles | `authz-org-core.test.ts` | owner/admin/member/viewer matrix |
| Repository | `fingerprint.test.ts` | 20+ URL normalization vectors |
| Incident | `incident-service.test.ts` | create, tenant isolation |
| Plan versioning | `plan-service.test.ts` | one-current invariant, immutability |
| Lifecycle | `lifecycle.test.ts` | all valid transitions, invalid rejected, no wildcard verify |
| Verification sources | `lifecycle.test.ts` | verify from plan_ready, recovery_in_progress, verification_pending; reject detected/triaged/terminal |
| Terminal reopen | `lifecycle.test.ts` | resolved→triaged required before verify |
| Tenant composite FK | `incident-service.test.ts` | cross-org repositoryId rejected by DB/service |
| Plan-snapshot alignment | `plan-service.test.ts` | sourceSnapshot.incidentId must match plan.incidentId |
| Legacy onDelete | `migration.test.ts` | GitSession delete SetNulls snapshot.gitSessionId; incident data retained |
| Concurrency | `incident-service.test.ts` | concurrent transition → 409 |
| Cross-tenant | `authz-org-core.test.ts` | 404 for wrong org |
| Corrupted JSON | `plan-service.test.ts` | safe rejection |
| Authoritative audit rollback | `audit-service.test.ts` | audit failure rolls back mutation |
| Partial indexes | `migration.test.ts` | `pg_indexes` confirms owner + current-plan indexes |
| Dual-write atomicity | `incident-service.test.ts` | both FK columns set or neither |

**Test DB:** `TEST_DATABASE_URL` + `prisma migrate deploy` in `vitest` global setup.

---

## 10. Implementation Order

1. Prisma expand migration + generate
2. Repository layer (org-scoped)
3. `authz-org-core` + tests
4. `lifecycle.ts` + tests
5. `fingerprint.ts` + snapshot extension + state-engine collectors
6. Domain services (organization → repository → incident → plan → verification → audit)
7. Service integration tests against disposable Postgres
8. Feature-flagged dual-write in pipeline (optional, behind flag)
9. `POST /api/v1/organizations` and incident routes (minimal, for testing)
10. Full validation

---

## 11. Files to Create/Modify

### Create

```
apps/web/prisma/migrations/0_baseline_phase3/migration.sql
apps/web/prisma/migrations/YYYYMMDD_phase4b_expand_domain/migration.sql
apps/web/src/lib/repositories/*.ts
apps/web/src/lib/domain/*.ts
apps/web/src/lib/authz-org-core.ts
apps/web/src/lib/authz-org.ts
apps/web/src/lib/domain/fingerprint.test.ts
apps/web/src/lib/domain/lifecycle.test.ts
apps/web/src/lib/authz-org-core.test.ts
packages/schema/src/organization.ts
packages/schema/src/incident-lifecycle.ts
packages/state-engine/src/collectors/remotes.ts
packages/state-engine/src/collectors/root-commit.ts
```

### Modify

```
apps/web/prisma/schema.prisma
apps/web/package.json
packages/schema/src/snapshot.ts
packages/schema/src/index.ts
packages/state-engine/src/capture.ts
apps/web/vitest.config.ts  # add integration test setup
```

---

## 12. Validation (Phase 4B exit criteria)

```bash
pnpm install
pnpm --filter @latchops/web exec prisma format
pnpm --filter @latchops/web exec prisma validate
pnpm --filter @latchops/web exec prisma generate
pnpm --filter @latchops/web exec prisma migrate dev   # disposable DB
pnpm run lint
pnpm -r typecheck
pnpm -r test
pnpm run build:cli
pnpm build:web
```

**Gate:** All tests green; migration applies cleanly; no legacy table drops.

---

## 13. Risks

| Risk | Mitigation |
|---|---|
| Baseline migration on existing DB | `migrate resolve --applied` documented in runbook |
| Dual-write divergence | Feature flag off by default; atomic single-tx dual-write; reconciliation in 4D |
| Missing tenant filter in new code | Repository layer enforces orgId; adversarial tests |
| Snapshot schema bump breaks CLI | Optional fields only; old snapshots valid |
| Partial index not created | Explicit SQL in migration; CI `pg_indexes` assertion |
| Concurrent personal org creation | `personalOwnerUserId @unique` + advisory lock + retry |

---

## 14. Approval Gate

Stop after 4B report. Request:

```text
Phase 4B approved. Continue with Phase 4C.
```
