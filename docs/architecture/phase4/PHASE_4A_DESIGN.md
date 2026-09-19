# Phase 4A — Domain and Migration Design

> **Status:** Design only (Phase 4A). No production code, Prisma schema, or database changes in this subphase.
> **Revision:** 4A design-correction pass 2 (final focused review). See `reports/PHASE_4A_REPORT.md` §16.
> **Approval gate:** Explicit user approval required before Phase 4B implementation begins.

---

## 1. Purpose

Phase 4 converts LatchOps from a single-user/session prototype into a **secure multi-tenant SaaS domain** while preserving the deterministic analysis path:

```text
CLI / Web ingest
  → @latchops/state-engine (SnapshotV1 → RepoSignalsV1)
  → @latchops/recovery-engine (RecoveryPlanV1)
  → deterministic verification
```

Phase 4A defines the target domain model, authorization model, migration strategy, and file-level plans for subphases 4B–4E. Implementation is deferred.

---

## 2. Current State (Phase 3 Baseline)

### 2.1 Persistence

| Model | Role today |
|---|---|
| `GitSession` | Primary incident aggregate; optional `userId`; `repoRootHash` (16-char SHA-256 of absolute path) |
| `Snapshot` | `snapshotJson` (`SnapshotV1`) |
| `Analysis` | Canonical `signalsJson`, `planJson`, `risk`, `engineVersion` + legacy `issueType` |
| `ConflictFile` / `ConflictHunk` | Relational conflict UI data (also in snapshot JSON) |
| `PlanStep` | **Dead** — never written; UI reads `planJson` |
| `Trace` | Deterministic pipeline stages + verification in `outputJson` |
| `Event` | **Unused** |

### 2.2 Authorization

- Interim guard: `decideSessionAccess` in `authz-core.ts` — user must own `GitSession.userId`.
- Anonymous sessions (`userId: null`) return **404** on protected routes.
- `POST /api/snapshots/ingest` and `POST /api/sessions` allow **anonymous write** (S-6 gap).

### 2.3 Schema tooling

- `prisma db push` only; no `prisma/migrations/` directory.
- Manual DDL record: `apps/web/prisma/manual-migrations/20260725_phase3_canonical_fields.sql`.

### 2.4 Tests

- 143 passing tests; web DB integration tests **not present** (pure `core.test.ts` only).

---

## 3. Architectural Principles (Binding)

### 3.1 Relational vs JSON

| Relational | Zod-validated JSON (immutable artefacts) |
|---|---|
| Users, organizations, memberships | `SnapshotV1` |
| Repository identity metadata | `RepoSignalsV1` |
| Incident lifecycle + denormalized indexes | `RecoveryPlanV1` |
| Plan version headers | `VerificationResultV1` |
| Verification run metadata | |
| Audit event headers | |
| CLI credential metadata | |

**Do not** normalize plan steps, commands, warnings, prerequisites, alternatives, undo strategies, or signal reasons into relational rows in Phase 4.

### 3.2 Security

- Every tenant-owned query **must** include `organizationId` from auth context — never from request body.
- Cross-tenant resource access → **404** (no existence leak).
- Same-tenant insufficient role → **403**.
- Unauthenticated → **401**.
- Archived organization → all writes **403** (`ORG_ARCHIVED`).
- CLI tokens: `lops_live_<16-char-token-id>.<43-char-secret>` format (`.` separator); plaintext shown once; HMAC hash stored; direct lookup by `tokenId`.
- `LATCHOPS_TOKEN_PEPPER` **required in production**; startup fails closed if absent.
- Production anonymous ingest **denied by default** (`LATCHOPS_ALLOW_ANONYMOUS_INGEST=false`).
- Authoritative audit events are **transactional** with their mutations; telemetry audit is best-effort only.

### 3.3 Migration

Expand → backfill → switch → contract. **Do not drop legacy tables in Phase 4.**

From Phase 4B onward: **committed Prisma migrations only** (`prisma migrate`). `db push` is dev-only.

---

## 4. Target Domain Model

### 4.1 Enums

```prisma
enum OrganizationStatus {
  active
  archived
}

enum MembershipRole {
  owner
  admin
  member
  viewer
}

enum IncidentStatus {
  detected
  triaged
  plan_ready
  recovery_in_progress
  verification_pending
  resolved
  dismissed
}

enum IncidentSource {
  cli
  web_import
  legacy_migration
}

enum SnapshotKind {
  capture
  verification
}

enum AuditActorType {
  user
  system
  cli
}
```

### 4.2 Organization

```prisma
model Organization {
  id        String             @id @default(cuid())
  slug      String             @unique
  name      String
  status    OrganizationStatus @default(active)
  kind      String             @default("team") // "personal" | "team"
  createdAt DateTime           @default(now())
  updatedAt DateTime           @updatedAt
  archivedAt DateTime?

  // Database-enforced one-personal-org-per-user invariant.
  // Set only when kind = "personal". NULL for team orgs.
  personalOwnerUserId String? @unique

  personalOwner User? @relation("PersonalOrganization", fields: [personalOwnerUserId], references: [id], onDelete: SetNull)

  memberships    Membership[]
  repositories   Repository[]
  incidents      Incident[]
  cliCredentials CliCredential[]
  auditEvents    AuditEvent[]

  @@index([status])
  @@index([kind])
}
```

**Invariants:**
- `slug` is URL-safe and globally unique.
- **Exactly one personal org per user**, enforced by `personalOwnerUserId @unique` at the database level (not application-only).
- When `kind = "personal"`, `personalOwnerUserId` must be non-null. When `kind = "team"`, `personalOwnerUserId` must be null.
- Archived org rejects normal writes (service-layer `assertOrgWritable`).

**Concurrent personal-org creation (`ensurePersonalOrganization`):**

```typescript
// Inside a transaction with SERIALIZABLE or advisory lock per userId:
// 1. SELECT Organization WHERE personalOwnerUserId = userId
// 2. If found → return
// 3. Else INSERT Organization { kind: "personal", personalOwnerUserId: userId, slug: "personal-{userId}", ... }
//    + INSERT Membership { role: owner }
// 4. On unique violation (personalOwnerUserId) → retry step 1 (another request won the race)
```

Use `pg_advisory_xact_lock(hashtext('personal_org:' || userId))` inside the transaction to serialize concurrent first-login/backfill attempts for the same user.

### 4.3 Membership

```prisma
model Membership {
  id             String         @id @default(cuid())
  organizationId String
  userId         String
  role           MembershipRole @default(member)
  createdAt      DateTime       @default(now())
  updatedAt      DateTime       @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  user         User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([organizationId, userId])
  @@index([userId])
}
```

**Invariants (single-owner model — chosen):**
- Unique user membership per organization.
- **Exactly one active `owner` per organization** (partial unique index below). Not "at least one" — precisely one.
- The sole owner cannot leave, be removed, or be demoted without **`transferOwnership`** first.
- **`transferOwnership(orgId, fromUserId, toUserId)`** is the only way to change who holds `owner`. It runs atomically in one transaction:
  1. Verify `fromUserId` is the current sole owner.
  2. `UPDATE Membership SET role = 'admin' WHERE organizationId = ? AND userId = fromUserId AND role = 'owner'`
  3. `UPDATE Membership SET role = 'owner' WHERE organizationId = ? AND userId = toUserId` (target must already be a member)
  4. Write authoritative `AuditEvent` (`membership.ownership_transferred`) — failure rolls back steps 2–3.
- Concurrent `transferOwnership` attempts: optimistic check on owner row; second attempt gets `409 CONFLICT`.
- **Archived organizations:** ownership transfer is blocked (`403 ORG_ARCHIVED`). Reads remain allowed.
- **Deleted users:** `onDelete` on Membership is Cascade; the sole owner cannot delete their account without transferring ownership first (application blocks account deletion while `Membership.role = 'owner'` for any org).

**PostgreSQL partial unique index (raw SQL in migration):**

```sql
CREATE UNIQUE INDEX "Membership_one_owner_per_org"
  ON "Membership" ("organizationId")
  WHERE role = 'owner';
```

Prisma does not declare partial unique indexes in the schema DSL; they are added via explicit `migration.sql` companion SQL. Verified compatible with `prisma migrate deploy` and disposable Postgres test databases (see §4.13).

### 4.4 Repository

```prisma
model Repository {
  id             String   @id @default(cuid())
  organizationId String
  fingerprint    String   // sha256 hex, see §6
  displayName    String
  primaryRemote  String?  // normalized, credential-free
  rootCommitOid  String?  // 40-char SHA, nullable
  missingRemote  Boolean  @default(false)
  platform       String?  // win32 | darwin | linux
  lastSeenAt     DateTime @default(now())
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt
  archivedAt     DateTime?

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  incidents      Incident[]

  @@unique([organizationId, fingerprint])
  @@unique([id, organizationId])  // composite parent for tenant-consistent Incident FK
  @@index([organizationId])
}
```

**Invariants:**
- Fingerprint scoped unique per organization (not global).
- Absolute local path is **never** stored or used in fingerprint.
- CLI cannot assign a repository to an arbitrary organization — org comes from token only.

### 4.5 Incident

Replaces `GitSession` as the primary aggregate.

```prisma
model Incident {
  id             String         @id @default(cuid())
  organizationId String
  repositoryId   String
  createdById    String?
  title          String?
  status         IncidentStatus @default(detected)
  source         IncidentSource @default(cli)

  // Denormalized indexes (from latest signals/plan)
  incidentType  String   // RepoStateV1
  risk          String?  // RiskLevelV1
  summary       String?  @db.Text
  engineVersion String?

  // Lifecycle timestamps
  detectedAt   DateTime  @default(now())
  triagedAt    DateTime?
  resolvedAt   DateTime?
  dismissedAt  DateTime?

  // Migration bridge
  legacyGitSessionId String? @unique

  // Optimistic concurrency for lifecycle transitions
  version Int @default(0)

  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  organization     Organization         @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  repository       Repository           @relation(fields: [repositoryId, organizationId], references: [id, organizationId], onDelete: Restrict)
  createdBy        User?                @relation(fields: [createdById], references: [id], onDelete: SetNull)
  snapshots        Snapshot[]
  recoveryPlans    RecoveryPlanRecord[]
  verificationRuns VerificationRun[]
  auditEvents      AuditEvent[]
  idempotencyRecords IdempotencyRecord[]

  @@unique([id, organizationId])  // composite parent for tenant-consistent child FKs
  @@index([organizationId, status])
  @@index([organizationId, createdAt])
  @@index([repositoryId])
  @@index([incidentType])
  @@index([legacyGitSessionId])
}
```

**ID strategy:** New `Incident.id` (cuid). `legacyGitSessionId` preserves old URLs during migration. `/incident/[id]` resolves incident first, then legacy session bridge.

### 4.6 Snapshot (evolved in place — dual-parent transition)

The existing `Snapshot` table is **extended**, not replaced. No separate `IncidentSnapshot` table. No `incidentSnapshotId` bridge column.

```prisma
model Snapshot {
  id        String   @id @default(cuid())
  createdAt DateTime @default(now())

  // Dual-parent transition: at least one must be non-null at all times.
  // Both may be set temporarily during expand/backfill/switch.
  gitSessionId String?  // legacy parent (nullable after contract)
  incidentId   String?  // new parent (nullable before backfill)

  kind         SnapshotKind @default(capture)
  snapshotJson Json
  truncated    Boolean      @default(false)
  sequence     Int          @default(1)

  gitSession GitSession? @relation(fields: [gitSessionId], references: [id], onDelete: SetNull)
  incident   Incident?   @relation(fields: [incidentId], references: [id], onDelete: Cascade)

  analysis         Analysis?
  recoveryPlans    RecoveryPlanRecord[] @relation("PlanSourceSnapshot")
  verificationRuns VerificationRun[]
  traces           Trace[]

  @@unique([id, incidentId])  // composite parent for tenant-consistent plan/verify FKs (incidentId NOT NULL required)
  @@index([gitSessionId])
  @@index([incidentId, createdAt])
  @@index([incidentId, sequence])
}
```

**Deletion behaviour (canonical vs legacy parent):**

| Relation | Canonical side | `onDelete` | Rationale |
|---|---|---|---|
| `Snapshot.gitSession` | `Incident` | **SetNull** | Legacy `GitSession` deletion must not delete canonical snapshot rows |
| `Snapshot.incident` | `Incident` | **Cascade** | Incident deletion removes canonical snapshots |
| `Analysis.gitSession` | `RecoveryPlanRecord` | **SetNull** | Legacy session deletion must not delete canonical plans |
| `Analysis.incident` | `RecoveryPlanRecord` | **Cascade** | Incident deletion removes legacy analysis rows |
| `Analysis.recoveryPlanRecord` | `RecoveryPlanRecord` | **SetNull** | Legacy analysis deletion must not delete canonical plan |
| `Trace.gitSession` | `AuditEvent` | **SetNull** | Legacy session deletion must not delete traces bridged to audit |
| `Trace.incident` | `AuditEvent` | **SetNull** | Incident deletion cascades via `AuditEvent`; legacy trace orphaned safely |
| `Trace.auditEvent` | `AuditEvent` | **SetNull** | Legacy trace deletion must not delete canonical audit |
| `GitSession.incident` | `Incident` | **SetNull** | Incident deletion must not delete legacy session row |
| `RecoveryPlanRecord.legacyAnalysis` | `RecoveryPlanRecord` | **SetNull** | Legacy analysis deletion must not delete canonical plan |

**Rule:** Legacy-parent deletion **never** cascade-deletes canonical Phase 4 data (`Incident`, `RecoveryPlanRecord`, `AuditEvent`, `VerificationRun`).

**Nullability by subphase:**

| Subphase | `gitSessionId` | `incidentId` | CHECK constraint |
|---|---|---|---|
| 4B expand | NOT NULL (existing rows) | NULL allowed, no FK enforced yet* | none |
| 4B expand (DDL) | nullable column added | nullable column added | deferred |
| 4D backfill | set (legacy rows) | populated | `gitSessionId IS NOT NULL OR incidentId IS NOT NULL` |
| 4D switch | both may be set | required for new writes | same |
| Contract (post-4) | NULL | NOT NULL for new rows | incidentId required |

\*Foreign keys to `Incident` are added only after the `Incident` table exists. Do **not** add NOT NULL or required FK constraints to populated legacy tables before backfill completes.

**Write behaviour:**

| Phase | New snapshot writes |
|---|---|
| 4B (dual-write flag on) | Set both `gitSessionId` and `incidentId` in **one transaction** |
| 4D switch | Set `incidentId` required; `gitSessionId` optional (bridge) |
| Contract | `incidentId` only |

**Backfill:** For each legacy `Snapshot`, set `incidentId` from parent `GitSession.incidentId` bridge. Row identity is preserved (same `Snapshot.id`).

**Reconciliation:** `COUNT(Snapshot WHERE gitSessionId IS NOT NULL AND incidentId IS NULL)` among owned sessions = 0 before switch.

### 4.7 RecoveryPlanRecord (new table; Analysis evolved in parallel)

`RecoveryPlanRecord` is the canonical plan store for new incidents. The legacy `Analysis` table is **extended in place** with bridge columns (same dual-parent pattern as Snapshot).

**Legacy `Analysis` evolution:**

```prisma
model Analysis {
  // ... existing Phase 3 fields unchanged ...

  gitSessionId String?  // was NOT NULL; made nullable at contract
  incidentId   String?  // new; nullable until backfill

  recoveryPlanRecordId String? @unique  // bridge to RecoveryPlanRecord after backfill

  gitSession GitSession? @relation(..., onDelete: SetNull)
  incident   Incident?   @relation(..., onDelete: Cascade)
  recoveryPlanRecord RecoveryPlanRecord? @relation(..., onDelete: SetNull)
}
```

**New `RecoveryPlanRecord`:**

```prisma
model RecoveryPlanRecord {
  id               String  @id @default(cuid())
  incidentId       String
  sourceSnapshotId String
  version          Int
  isCurrent        Boolean @default(true)

  signalsJson   Json
  planJson      Json
  incidentType  String
  summary       String? @db.Text
  risk          String
  engineVersion String
  incomplete    Boolean @default(false)

  generatedAt DateTime @default(now())
  createdAt   DateTime @default(now())

  legacyAnalysisId String? @unique  // maps Analysis.id after backfill

  incident       Incident  @relation(fields: [incidentId, organizationId], references: [id, organizationId], onDelete: Cascade)
  sourceSnapshot Snapshot  @relation("PlanSourceSnapshot", fields: [sourceSnapshotId, incidentId], references: [id, incidentId], onDelete: Cascade)
  verificationRuns VerificationRun[]
  legacyAnalysis   Analysis? @relation(fields: [legacyAnalysisId], references: [id], onDelete: SetNull)

  organizationId String  // denormalized for composite FK (matches Incident.organizationId)

  @@unique([incidentId, version])
  @@unique([id, incidentId])  // composite parent for VerificationRun FK
  @@index([incidentId, isCurrent])
}
```

**Invariants:**
- At most one `isCurrent = true` per incident (partial unique index).
- Historical plans are immutable (no UPDATE on `planJson`/`signalsJson`).
- Regenerate: set prior `isCurrent = false`, insert new row with `version + 1`.

```sql
CREATE UNIQUE INDEX "RecoveryPlanRecord_one_current_per_incident"
  ON "RecoveryPlanRecord" ("incidentId")
  WHERE "isCurrent" = true;
```

### 4.8 VerificationRun

```prisma
model VerificationRun {
  id                    String @id @default(cuid())
  incidentId            String
  organizationId        String  // denormalized for composite FKs
  recoveryPlanRecordId  String
  afterSnapshotId       String
  selectedAlternativeId String?
  status                String // VerificationStatusV1
  resultJson            Json   // VerificationResultV1
  durationMs            Int?
  createdAt             DateTime @default(now())

  incident           Incident           @relation(fields: [incidentId, organizationId], references: [id, organizationId], onDelete: Cascade)
  recoveryPlanRecord RecoveryPlanRecord @relation(fields: [recoveryPlanRecordId, incidentId], references: [id, incidentId], onDelete: Cascade)
  afterSnapshot      Snapshot           @relation(fields: [afterSnapshotId, incidentId], references: [id, incidentId], onDelete: Cascade)

  @@index([incidentId, createdAt])
  @@index([recoveryPlanRecordId])
}
```

### 4.9 AuditEvent

Two audit tiers:

| Tier | When | Transaction | On failure |
|---|---|---|---|
| **Authoritative** | Security-relevant mutations (see list below) | Same DB transaction as mutation | **Rolls back mutation** |
| **Telemetry** | Pipeline timing, non-security diagnostics | Separate / best-effort | Logged; does not roll back |

**Authoritative actions (must be transactional):**
- `membership.ownership_transferred`
- `membership.role_changed` / `membership.removed`
- `organization.archived`
- `incident.status_changed` (lifecycle transitions)
- `recovery_plan.regenerated`
- `cli_credential.created` / `cli_credential.revoked`
- `incident.ingested` (security boundary)

**Telemetry actions (best-effort):** `pipeline.stage_completed`, debounced `cli_credential.used`.

```prisma
model AuditEvent {
  id             String         @id @default(cuid())
  organizationId String?
  incidentId     String?
  actorUserId    String?
  actorType      AuditActorType @default(system)
  action         String
  tier           String         @default("authoritative") // "authoritative" | "telemetry"
  payload        Json?
  // IP addresses omitted from Phase 4 (privacy/retention). Revisit in Phase 11 if needed.
  userAgent      String?        @db.Text
  createdAt      DateTime       @default(now())

  legacyTraceId String? @unique

  organization Organization? @relation(fields: [organizationId], references: [id], onDelete: SetNull)
  incident     Incident?     @relation(fields: [incidentId], references: [id], onDelete: SetNull)
  actor        User?         @relation(fields: [actorUserId], references: [id], onDelete: SetNull)

  @@index([organizationId, createdAt])
  @@index([incidentId, createdAt])
  @@index([action])
}
```

**Legacy `Trace` evolution (dual-parent, same pattern as Snapshot):**

```prisma
model Trace {
  // ... existing fields ...
  gitSessionId String?  // legacy; nullable at contract
  incidentId   String?  // new; nullable until backfill
  auditEventId String?  @unique  // bridge to AuditEvent after backfill

  gitSession GitSession? @relation(..., onDelete: SetNull)
  incident   Incident?   @relation(..., onDelete: SetNull)
  auditEvent AuditEvent? @relation(..., onDelete: SetNull)
}
```

Append-only through application code (no UPDATE/DELETE on `AuditEvent` rows).

### 4.10 CliCredential

```prisma
model CliCredential {
  id             String    @id @default(cuid())
  organizationId String
  createdById    String?
  name           String
  tokenId        String    @unique  // dedicated lookup key (≥96 bits entropy)
  tokenHash      String    // HMAC-SHA256 hex of the COMPLETE token string
  scopes         String[]  @default(["ingest:write"])
  lastUsedAt     DateTime?
  expiresAt      DateTime?
  revokedAt      DateTime?
  createdAt      DateTime  @default(now())

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Cascade)
  createdBy      User?        @relation(fields: [createdById], references: [id], onDelete: SetNull)

  @@index([organizationId])
}
```

`createdBy` uses `SetNull` on user deletion so credential rows survive for audit; `createdById` becomes null but the credential remains revocable.

### 4.11 IdempotencyRecord (CLI ingest)

```prisma
model IdempotencyRecord {
  id             String   @id @default(cuid())
  organizationId String
  key            String
  requestHash    String
  incidentId     String
  createdAt      DateTime @default(now())
  expiresAt      DateTime

  incident Incident @relation(fields: [incidentId, organizationId], references: [id, organizationId], onDelete: Cascade)

  @@unique([organizationId, key])
  @@index([expiresAt])
  @@index([incidentId])
}
```

### 4.12 Legacy Tables (retained, not dropped)

`GitSession`, `Analysis`, `ConflictFile`, `ConflictHunk`, `PlanStep`, `Trace`, `Event` — retained through Phase 4.

**`GitSession` bridge:**

```prisma
model GitSession {
  // ... existing fields ...
  incidentId String? @unique  // bridge to Incident after backfill
  incident   Incident? @relation(fields: [incidentId], references: [id], onDelete: SetNull)
}
```

No dual-write to `PlanStep`. `ConflictFile` read-only deprecated; UI reads from `snapshotJson` + `planJson`.

### 4.13 Migration Bridge Model (coherent dual-parent pattern)

All legacy↔new bridges follow the same rules:

| Table | Legacy parent column | New parent column | Row-identity bridge | New-side table |
|---|---|---|---|---|
| `GitSession` | — | `incidentId` → `Incident` | `Incident.legacyGitSessionId` | `Incident` (new row) |
| `Snapshot` | `gitSessionId` (nullable at contract) | `incidentId` (nullable until backfill) | same `Snapshot.id` | n/a (in-place) |
| `Analysis` | `gitSessionId` | `incidentId` | `recoveryPlanRecordId` → `RecoveryPlanRecord` | `RecoveryPlanRecord` (new row) |
| `Trace` | `gitSessionId` | `incidentId` | `auditEventId` → `AuditEvent` | `AuditEvent` (new row) |

**Rules:**
1. Do **not** add NOT NULL constraints to new columns on populated tables before backfill.
2. Foreign keys to new tables are added in expand migration but columns remain nullable.
3. CHECK `gitSessionId IS NOT NULL OR incidentId IS NOT NULL` added only after backfill validates zero orphans.
4. Dual-writes (when enabled) set **both** parent columns in **one database transaction**.
5. Partial unique indexes are declared in companion `migration.sql` SQL, not Prisma DSL. Test workflow: `prisma migrate deploy` against disposable Postgres in CI; integration tests assert indexes exist via `pg_indexes` query.

**Contract condition (post-Phase 4):** New application writes require `incidentId` only; `gitSessionId` is no longer written. Legacy columns remain for read fallback until table drop (Phase 7+).

### 4.14 Tenant Consistency Constraints

Database-level guarantees prevent cross-tenant references. Composite foreign keys use denormalized `organizationId` / `incidentId` on child rows.

| Relationship | Constraint | Enforceable subphase |
|---|---|---|
| `Incident` → `Repository` | `FK (repositoryId, organizationId) → Repository(id, organizationId)` | **4B expand** (both columns NOT NULL on new rows) |
| `IdempotencyRecord` → `Incident` | `FK (incidentId, organizationId) → Incident(id, organizationId)` | **4C** (table created with constraint) |
| `RecoveryPlanRecord` → `Incident` | `FK (incidentId, organizationId) → Incident(id, organizationId)` | **4B expand** |
| `RecoveryPlanRecord` → `Snapshot` | `FK (sourceSnapshotId, incidentId) → Snapshot(id, incidentId)` | **4D switch** (`Snapshot.incidentId` NOT NULL on all owned rows) |
| `VerificationRun` → `Incident` | `FK (incidentId, organizationId) → Incident(id, organizationId)` | **4B expand** |
| `VerificationRun` → `RecoveryPlanRecord` | `FK (recoveryPlanRecordId, incidentId) → RecoveryPlanRecord(id, incidentId)` | **4B expand** |
| `VerificationRun` → `Snapshot` | `FK (afterSnapshotId, incidentId) → Snapshot(id, incidentId)` | **4D switch** |

**During nullable transition (4B expand → 4D backfill):**

| Invariant | Enforcement | Reconciliation |
|---|---|---|
| `RecoveryPlanRecord.sourceSnapshot.incidentId = RecoveryPlanRecord.incidentId` | Service transaction on `persistPlan` / ingest | `SELECT COUNT(*) FROM RecoveryPlanRecord r JOIN Snapshot s ON r.sourceSnapshotId = s.id WHERE s.incidentId IS DISTINCT FROM r.incidentId` = 0 |
| `Snapshot.incidentId` set when written via ingest | Dual-write transaction | See §4.6 reconciliation |
| `IdempotencyRecord.organizationId = Incident.organizationId` | Composite FK at 4C | N/A (constraint enforced at creation) |

**Service rule:** All mutations that set `repositoryId`, `sourceSnapshotId`, or `afterSnapshotId` must validate tenant consistency inside the same transaction before commit. Route-level checks alone are insufficient.

**Required unique indexes for composite FK parents:**

```prisma
Repository  @@unique([id, organizationId])
Incident    @@unique([id, organizationId])
Snapshot    @@unique([id, incidentId])           // after incidentId NOT NULL
RecoveryPlanRecord @@unique([id, incidentId])
```

---

## 5. CLI Authentication Design

### 5.1 Decision: Organization-scoped bearer token

| Option | Verdict |
|---|---|
| **Org bearer token** | ✅ **Selected** — smallest secure solution; one env var; rotatable |
| OAuth device flow | ❌ Deferred — too heavy for Phase 4 CLI `send` |
| Claim token in body | ❌ Forgeable without server secret |
| User session JWT in CLI | ❌ No browser cookie flow |

### 5.2 Token format

```text
lops_live_<16-character-token-id>.<43-character-secret>
```

The `.` separator is **not** part of the Base64URL alphabet, so parsing is unambiguous (unlike `_`).

| Component | Entropy | Length | Storage | Example |
|---|---|---|---|---|
| Prefix | — | 10 chars | Not stored | `lops_live_` |
| `token-id` | ≥96 bits (`randomBytes(12)` → base64url) | **exactly 16** | `CliCredential.tokenId` `@unique` | `k7mNpQxR2vLwY9zA` |
| Separator | — | 1 char | — | `.` |
| `secret` | ≥256 bits (`randomBytes(32)` → base64url) | **exactly 43** | **Never stored** | `xK9mP2nQ7vR4wL8jH3fG6dS1aZ5cV0bN8yT2uI5oP7qW3eR` |

**Full example (shown once at creation):**

```text
lops_live_k7mNpQxR2vLwY9zA.xK9mP2nQ7vR4wL8jH3fG6dS1aZ5cV0bN8yT2uI5oP7qW3eR6tY9uI0oP
```

Plaintext shown **once** at creation; never stored, logged, or returned by list endpoints.

### 5.3 Storage and verification

```typescript
// Pepper: LATCHOPS_TOKEN_PEPPER required in production (fail closed at startup).

const TOKEN_RE = /^lops_live_([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;

function getTokenPepper(): string {
  const pepper = process.env.LATCHOPS_TOKEN_PEPPER;
  if (process.env.NODE_ENV === 'production' && !pepper) {
    throw new Error('LATCHOPS_TOKEN_PEPPER is required in production');
  }
  return pepper ?? process.env.NEXTAUTH_SECRET!; // dev fallback only
}

// At rest: HMAC-SHA256 of the COMPLETE token string
tokenHash = HMAC_SHA256(pepper, fullToken).hex

// Verification (direct lookup; constant-time; dummy compare on miss):
1. Parse Bearer token with TOKEN_RE; reject if length or segment lengths wrong
2. Extract tokenId (capture group 1, exactly 16 chars)
3. Lookup CliCredential WHERE tokenId = ? AND revokedAt IS NULL AND (expiresAt IS NULL OR expiresAt > now())
4. presentedHash = HMAC_SHA256(pepper, fullToken)
5. If cred found:
     timingSafeEqual(presentedHash, cred.tokenHash)
   Else:
     // Dummy compare so unknown tokenId timing matches invalid-secret path
     timingSafeEqual(presentedHash, DUMMY_HASH)
6. On match: debounced lastUsedAt update (telemetry tier, non-blocking)
7. Resolve organizationId from credential — NEVER from request body
```

`DUMMY_HASH` is a fixed 64-char hex constant (e.g. HMAC of a known sentinel string with the same pepper). Never branch on lookup result before the compare.

**Rate limiting:** Per-IP failed attempts (in-memory stub in 4C; Redis in Phase 11).

### 5.4 Scopes (Phase 4 minimum)

| Scope | Grants |
|---|---|
| `ingest:write` | `POST /api/cli/incidents/ingest` |
| `incident:read` | Read incident (optional, Phase 5+) |

Viewers cannot create CLI credentials. Only `owner` and `admin`.

### 5.5 Environment variables

| Variable | Purpose |
|---|---|
| `LATCHOPS_API_TOKEN` | CLI bearer token (user machine) |
| `LATCHOPS_ALLOW_ANONYMOUS_INGEST` | `true` only for local dev; default `false` |
| `LATCHOPS_TOKEN_PEPPER` | **Required in production.** Dedicated HMAC pepper for CLI tokens. Startup fails closed if absent when `NODE_ENV=production`. Dev-only fallback to `NEXTAUTH_SECRET` documented in `.env.example`. |

---

## 6. Repository Fingerprint Design

### 6.1 Goal

Stable logical repo identity across machines **without** absolute paths or credentials.

### 6.2 Snapshot schema extension (v1 — additive optional fields)

Add to `SnapshotV1` (backward compatible):

```typescript
remotes?: Array<{ name: string; url: string }>;  // from git remote -v
rootCommitOid?: string | null;                   // from git rev-list --max-parents=0 HEAD
commonGitDir?: string;                           // for worktree disambiguation (not in fingerprint)
```

Capture in `@latchops/state-engine` (`capture.ts`). Older snapshots without these fields use legacy fallback during backfill.

### 6.3 Algorithm

```
1. PRIMARY_REMOTE:
   - Prefer remote named "origin"; else first alphabetically.
   - If none: primaryRemote = null, missingRemote = true.

2. NORMALIZE_URL(url):
   - Strip credentials (user:pass@, token in path).
   - Parse SCP form (git@host:path) → https://host/path.
   - Lowercase host.
   - Remove trailing .git, query strings, fragments.
   - Normalize path slashes.

3. ROOT_COMMIT:
   - rootCommitOid from snapshot (40-char SHA).
   - If unborn/empty: null.

4. FINGERPRINT_MATERIAL:
   - If primaryRemote: "remote:{normalized_url}\nroot:{rootCommitOid ?? 'none'}"
   - Else: "local:{rootCommitOid ?? 'unborn'}\nroot:{rootCommitOid ?? 'none'}"

5. FINGERPRINT = sha256(FINGERPRINT_MATERIAL).hex

6. DISPLAY_NAME:
   - If primaryRemote: last path segment (e.g. "latchops")
   - Else: "local/{first8(rootCommitOid)}" or "local/unknown"
```

### 6.4 Excluded from fingerprint

| Input | Reason |
|---|---|
| `repoRoot` absolute path | Machine-specific |
| Branch name / HEAD OID | Incident context only |
| Hostname / OS | Metadata only |

### 6.5 Known limitations (documented)

| Case | Behavior |
|---|---|
| HTTPS vs SSH same repo | **Different fingerprints** in Phase 4 (Phase 5 may add canonical host mapping) |
| Template repos (same root, different remotes) | Correctly separate repositories |
| Shallow clone missing root | `rootCommitOid = null`; fingerprint uses remote only |
| Copied `.git` directory | Same fingerprint if remote + root match — documented collision risk |
| No remote, no commits | `local:unborn` fingerprint; may collide across unrelated empty repos |

### 6.6 Legacy migration fallback

Existing `GitSession.repoRootHash` → create `Repository` with `fingerprint = repoRootHash`, `missingRemote = true`, `displayName = 'legacy/{sessionIdPrefix}'` as migration marker. New ingests use canonical fingerprint only.

---

## 7. Incident Lifecycle

### 7.1 State machine

```text
detected → triaged → plan_ready → recovery_in_progress → verification_pending → resolved
                                                                              ↘ dismissed
```

Terminal states: `resolved`, `dismissed`. **No wildcard transitions.** Terminal incidents must reopen via `resolved|dismissed → triaged` (admin+) before any recovery or verification activity resumes.

### 7.2 Transition matrix

**Lifecycle transitions:**

| From → To | Trigger | Actor | Auto? |
|---|---|---|---|
| — → `detected` | Ingest starts | system | Yes |
| `detected` → `plan_ready` | Plan persisted successfully | system | Yes |
| `detected` → `detected` | Plan incomplete | system | Yes |
| `detected` → `triaged` | User acknowledges | member+ | Manual |
| `triaged` → `recovery_in_progress` | User starts recovery | member+ | Manual |
| `plan_ready` → `recovery_in_progress` | User starts recovery | member+ | Manual |
| `detected` → `dismissed` | User dismisses (reason required) | member+ | Manual |
| `triaged` → `dismissed` | User dismisses (reason required) | member+ | Manual |
| `plan_ready` → `dismissed` | User dismisses (reason required) | member+ | Manual |
| `recovery_in_progress` → `dismissed` | User dismisses (reason required) | member+ | Manual |
| `verification_pending` → `dismissed` | User dismisses (reason required) | member+ | Manual |
| `resolved\|dismissed` → `triaged` | Reopen | admin+ | Manual |

**Verification transitions (explicit — no `*` wildcard):**

| From → To | Trigger | Actor | Allowed? |
|---|---|---|---|
| `plan_ready` → `verification_pending` | Verify POST received | member+ | ✅ Yes |
| `recovery_in_progress` → `verification_pending` | Verify POST received | member+ | ✅ Yes |
| `verification_pending` → `verification_pending` | Repeated verify POST | member+ | ✅ Yes (new `VerificationRun`; status unchanged until result processed) |
| `verification_pending` → `resolved` | `verifyRecovery` status = `succeeded` | system | Auto |
| `verification_pending` → `recovery_in_progress` | `verifyRecovery` failed / `manual_review` | system | Auto |
| `detected` → `verification_pending` | Verify POST | — | ❌ **409** — plan not ready for verification |
| `triaged` → `verification_pending` | Verify POST | — | ❌ **409** — must reach `plan_ready` or `recovery_in_progress` first |
| `resolved` → `verification_pending` | Verify POST | — | ❌ **409** — must reopen to `triaged` first |
| `dismissed` → `verification_pending` | Verify POST | — | ❌ **409** — must reopen to `triaged` first |

**Viewer:** read-only; cannot transition or verify.

### 7.3 Concurrency control

```sql
UPDATE "Incident"
SET status = $next, version = version + 1, updatedAt = NOW()
WHERE id = $id AND organizationId = $orgId AND status = $expected AND version = $version
```

Returns row count 0 → `409 CONFLICT` (`INVALID_TRANSITION`). All transitions run in a transaction with `AuditEvent` write.

### 7.4 Archived organization

All lifecycle transitions and writes return `403 ORG_ARCHIVED`. Read access retained for members during retention window.

---

## 8. Role Permission Matrix

| Action | owner | admin | member | viewer |
|---|---|---|---|---|
| View org settings | ✅ | ✅ | 🔒 | 🔒 |
| Edit org settings | ✅ | ✅ | ❌ | ❌ |
| Archive org | ✅ | ❌ | ❌ | ❌ |
| Invite/remove members | ✅ | ✅ | ❌ | ❌ |
| Change roles | ✅ | ⚡ | ❌ | ❌ |
| Create/revoke CLI tokens | ✅ | ✅ | ❌ | ❌ |
| List repositories | ✅ | ✅ | ✅ | ✅ |
| CLI ingest | ✅ | ✅ | ❌ | ❌ |
| Create incident (web import) | ✅ | ✅ | ✅ | ❌ |
| View incidents | ✅ | ✅ | ✅ | ✅ |
| Triage / start recovery | ✅ | ✅ | ✅ | ❌ |
| Regenerate plan | ✅ | ✅ | ✅ | ❌ |
| Submit verification | ✅ | ✅ | ✅ | ❌ |
| Resolve / dismiss | ✅ | ✅ | ✅ | ❌ |
| Reopen | ✅ | ✅ | ❌ | ❌ |
| View audit log | ✅ | ✅ | 🔒 | 🔒 |

⚡ = admin cannot promote to owner or demote owner without transfer ceremony.

---

## 9. Authorization Primitives

Pure functions in `authz-org-core.ts` (testable); async wrappers in `authz-org.ts`.

```typescript
requireOrganizationMember(orgId, { minRole?: MembershipRole })
requireOrganizationRole(orgId, allowedRoles: MembershipRole[])
requireRepositoryAccess(repositoryId, { minRole?: 'read' | 'write' })
requireIncidentAccess(incidentId, { minRole?, allowCliToken?: boolean })
requireCliCredential(request) // Bearer → organizationId + scopes
assertOrgWritable(organizationId) // throws if archived
```

**Tenant isolation contract:** Repository layer methods require `organizationId` parameter. Ban unscoped `findUnique({ where: { id } })` on tenant models.

Legacy shim: `authorizeSessionAccess` resolves `legacyGitSessionId` → `Incident` → `requireIncidentAccess`.

---

## 10. Domain Service Boundaries

```
apps/web/src/lib/domain/
  organization-service.ts   # org CRUD, membership, personal org bootstrap, transferOwnership
  repository-service.ts     # fingerprint, upsert, list
  incident-service.ts       # ingest, lifecycle, payload assembly
  plan-service.ts           # RecoveryPlanRecord versioning
  verification-service.ts   # VerificationRun + lifecycle side effects
  audit-service.ts          # authoritative (transactional) + telemetry (best-effort)
  lifecycle.ts              # pure state machine
  fingerprint.ts            # pure fingerprint algorithm
  errors.ts                 # domain error types
```

**Audit service split:**

| Method | Tier | Behaviour |
|---|---|---|
| `recordAuthoritative(tx, event)` | Authoritative | Called inside caller's `$transaction`; throws on failure → rolls back mutation |
| `recordTelemetry(event)` | Telemetry | Best-effort; catches and logs errors; never rolls back pipeline |

Authoritative mutations (ownership transfer, role change/removal, org archival, lifecycle transitions, plan regeneration, CLI credential create/revoke, ingest) **must** call `recordAuthoritative` within the same transaction as the mutation.

Routes call services only. No lifecycle or authorization logic in route handlers.

---

## 11. API Contracts (Summary)

### 11.1 New canonical routes (`/api/v1/`)

| Route | Method | Auth |
|---|---|---|
| `/api/v1/organizations` | GET, POST | session |
| `/api/v1/organizations/[orgId]` | GET, PATCH | session + member+ |
| `/api/v1/organizations/[orgId]/members` | GET, POST | session + admin+ |
| `/api/v1/organizations/[orgId]/members/[userId]` | PATCH, DELETE | session + admin+ |
| `/api/v1/organizations/[orgId]/repositories` | GET | session + member+ |
| `/api/v1/organizations/[orgId]/incidents` | GET | session + member+ |
| `/api/v1/organizations/[orgId]/incidents/import` | POST | session + member+ |
| `/api/v1/organizations/[orgId]/incidents/[id]` | GET, PATCH | session + member+ |
| `/api/v1/organizations/[orgId]/incidents/[id]/plan` | GET, POST | session + member+ |
| `/api/v1/organizations/[orgId]/incidents/[id]/verify` | POST | session + member+ |
| `/api/v1/organizations/[orgId]/incidents/[id]/explain` | POST | session + member+ |
| `/api/v1/organizations/[orgId]/incidents/[id]/audit` | GET | session + admin+ |
| `/api/v1/organizations/[orgId]/cli-credentials` | GET, POST | session + admin+ |
| `/api/v1/organizations/[orgId]/cli-credentials/[id]` | DELETE | session + admin+ |
| `/api/v1/cli/incidents/ingest` | POST | CLI bearer + Idempotency-Key |

### 11.2 Legacy routes (compatibility — delegate in 4D)

All existing `/api/sessions/*`, `/api/incident/*`, `/api/snapshots/ingest` delegate to canonical services via `legacyGitSessionId` bridge.

### 11.3 Error envelope

```typescript
{ error: { code: string; message: string; details?: unknown } }
```

See `PHASE_4E_VALIDATION_PLAN.md` for full HTTP mapping.

---

## 12. Default Organization Onboarding

**Personal org (one per user — database-enforced):**

```typescript
async function ensurePersonalOrganization(userId: string): Promise<Organization> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`personal_org:${userId}`}))`;
    const existing = await tx.organization.findUnique({ where: { personalOwnerUserId: userId } });
    if (existing) return existing;
    try {
      const org = await tx.organization.create({
        data: {
          kind: 'personal',
          personalOwnerUserId: userId,
          slug: `personal-${userId}`,
          name: 'Personal',
          memberships: { create: { userId, role: 'owner' } },
        },
      });
      await auditService.recordAuthoritative(tx, { action: 'organization.created', ... });
      return org;
    } catch (e) {
      if (isUniqueViolation(e, 'personalOwnerUserId')) {
        return tx.organization.findUniqueOrThrow({ where: { personalOwnerUserId: userId } });
      }
      throw e;
    }
  });
}
```

**Rules:**
- Created on first login (post-auth hook) and during backfill for users with owned sessions.
- Users with zero sessions: created on first login only.
- `personalOwnerUserId @unique` prevents duplicate personal orgs under concurrent requests.
- On unique violation → retry read (another transaction won the race).
- Team orgs created explicitly via `POST /api/v1/organizations` (`personalOwnerUserId` remains null).

---

## 13. Anonymous Session Strategy

| Phase | Policy |
|---|---|
| 4A (design) | Document strategy only |
| 4B | No change to ingest auth |
| 4C | CLI bearer required; `LATCHOPS_ALLOW_ANONYMOUS_INGEST=true` for local dev only |
| 4D backfill | **Skip** `GitSession WHERE userId IS NULL` — report count in reconciliation |
| Future | One-time claim token flow (Phase 5+) |

Anonymous sessions remain in legacy tables, inaccessible via protected routes. No arbitrary org assignment.

---

## 14. Transaction Boundaries

| Operation | Atomic unit | Authoritative audit |
|---|---|---|
| Ingest (CLI or web) | Incident + Snapshot + RecoveryPlanRecord + IdempotencyRecord | `incident.ingested` (same tx) |
| Plan regenerate | Mark old `isCurrent=false` + insert new version | `recovery_plan.regenerated` |
| Verify | Snapshot + VerificationRun + lifecycle transition | `incident.status_changed` |
| Lifecycle transition | Status update (optimistic concurrency) | `incident.status_changed` |
| CLI credential create | Insert credential | `cli_credential.created` |
| CLI credential revoke | Set `revokedAt` | `cli_credential.revoked` |
| Ownership transfer | Demote old owner + promote new owner | `membership.ownership_transferred` |
| Role change / removal | Membership update | `membership.role_changed` / `membership.removed` |
| Org archival | Set `status=archived`, `archivedAt` | `organization.archived` |
| Personal org bootstrap | Organization + Membership owner | `organization.created` |
| Dual-write ingest (flag on) | Legacy Snapshot + new Snapshot fields (`gitSessionId` + `incidentId`) | same tx as ingest |

**Rules:**
- Authoritative audit writes are **inside** the transaction; failure rolls back the mutation.
- Telemetry audit (`cli_credential.used`, `pipeline.stage_completed`) is best-effort outside the transaction.
- Dual-writes, when enabled, set **both** `gitSessionId` and `incidentId` on the same `Snapshot` row in **one** transaction — never split across requests.

**Current gap (Phase 3):** `ingestSnapshot` performs 8+ sequential awaits without transaction. Phase 4B fixes this.

---

## 15. Threat Analysis

| Threat | Mitigation |
|---|---|
| Cross-tenant IDOR | Mandatory `organizationId` in all queries; 404 on cross-tenant |
| Token theft | Scoped tokens, rotation, expiry, HTTPS only, log redaction |
| Ingest flooding | Require token + rate limits + payload size cap (5MB) |
| Archived org writes | `assertOrgWritable` on all mutations |
| Privilege escalation | Role changes admin+ only; owner transfer ceremony |
| Fingerprint spoofing | Org from token, not body; fingerprint computed server-side |
| Migration data loss | Idempotent backfill + reconciliation + no legacy drops |
| Concurrent lifecycle races | Optimistic locking on `Incident.version` |
| DB leak of token hashes | HMAC with server pepper (not bare SHA-256) |
| Anonymous data retention | TTL policy documented; no new anonymous in prod after 4C |

---

## 16. Indexes and Constraints Summary

| Constraint | Type |
|---|---|
| `Organization.personalOwnerUserId` | UNIQUE (nullable; one personal org per user) |
| `Membership(organizationId, userId)` | UNIQUE |
| One owner per org (single-owner model) | PARTIAL UNIQUE INDEX (`WHERE role = 'owner'`) |
| `Repository(organizationId, fingerprint)` | UNIQUE |
| `Repository(id, organizationId)` | UNIQUE (composite parent) |
| `Incident(id, organizationId)` | UNIQUE (composite parent) |
| `Snapshot(id, incidentId)` | UNIQUE (composite parent; after incidentId NOT NULL) |
| `RecoveryPlanRecord(incidentId, version)` | UNIQUE |
| `RecoveryPlanRecord(id, incidentId)` | UNIQUE (composite parent) |
| One current plan per incident | PARTIAL UNIQUE INDEX (`WHERE isCurrent = true`) |
| `Incident.repository` composite FK | `(repositoryId, organizationId) → Repository(id, organizationId)` |
| `IdempotencyRecord.incident` composite FK | `(incidentId, organizationId) → Incident(id, organizationId)` |
| `RecoveryPlanRecord.sourceSnapshot` composite FK | `(sourceSnapshotId, incidentId) → Snapshot(id, incidentId)` (4D switch) |
| `VerificationRun` composite FKs | plan + snapshot incident-aligned (4B/4D) |
| `Incident.legacyGitSessionId` | UNIQUE (nullable) |
| `IdempotencyRecord(organizationId, key)` | UNIQUE |
| `CliCredential.tokenId` | UNIQUE (direct lookup key) |
| `Snapshot` parent CHECK (post-backfill) | CHECK (`gitSessionId IS NOT NULL OR incidentId IS NOT NULL`) |

Partial indexes and CHECK constraints are declared in companion `migration.sql` SQL (not Prisma DSL). CI verifies via `pg_indexes` / `pg_constraint` queries after `prisma migrate deploy`.

---

## 17. File-Level Implementation Map

### 17.1 New files (Phase 4B+)

```
apps/web/prisma/migrations/           # committed migrations from 4B
apps/web/src/lib/domain/              # §10
apps/web/src/lib/authz-org-core.ts
apps/web/src/lib/authz-org.ts
apps/web/src/lib/repositories/        # org-scoped Prisma access
apps/web/src/lib/api/errors.ts
apps/web/src/lib/api/validate.ts
apps/web/src/app/api/v1/              # new routes
packages/schema/src/organization.ts
packages/schema/src/incident-lifecycle.ts
packages/schema/src/api/v1/
packages/state-engine/src/collectors/remotes.ts
packages/state-engine/src/collectors/root-commit.ts
apps/web/scripts/migrate-phase4/        # backfill tool (4D)
```

### 17.2 Modified files

```
apps/web/prisma/schema.prisma
apps/web/src/lib/db.ts                 # legacy adapter behind repositories
apps/web/src/lib/recovery/pipeline.ts  # delegate to incident-service
apps/web/src/lib/recovery/incident.ts  # delegate to incident-service
apps/web/package.json                  # db:migrate scripts
packages/schema/src/snapshot.ts        # optional remotes/rootCommitOid
packages/state-engine/src/capture.ts
apps/cli/src/commands/send.ts          # bearer token + idempotency (4C)
```

---

## 18. Resolved Agent Conflicts

| Conflict | Resolution |
|---|---|
| RecoveryStep normalization | **Rejected** — JSON only; no `RecoveryStepRecord` table |
| ApiToken vs CliCredential | **CliCredential** (per master prompt) |
| IncidentSnapshot vs Snapshot | **Evolve Snapshot in place** with dual nullable parents (`gitSessionId`, `incidentId`); no `incidentSnapshotId` bridge |
| Incident.id reuse vs new id | **New id** + `legacyGitSessionId` bridge |
| SHA-256 vs HMAC for tokens | **HMAC-SHA256 of complete token with server pepper** |
| Token lookup: prefix vs tokenId | **`tokenId` direct lookup** (≥96-bit, 16 chars); `.` separator; dummy HMAC on miss |
| Legacy parent onDelete | **SetNull** on `gitSession` FKs; **Cascade** on canonical `incident` FKs |
| Tenant consistency | **Composite FKs** for org/incident alignment; service enforcement during nullable transition |
| Lifecycle wildcard verify | **Rejected** — explicit verification source states only |
| Single vs multiple owners | **Single owner** + `transferOwnership` ceremony |
| Personal org uniqueness | **`personalOwnerUserId @unique`** + advisory lock + retry |
| Audit: never throws vs transactional | **Authoritative = transactional**; telemetry = best-effort |
| IP address in AuditEvent | **Omitted from Phase 4** (privacy/retention); revisit Phase 11 |
| Anonymous ingest in 4A | **No change**; hard cutoff in 4C with env flag |
| Auto lifecycle on ingest | **detected → plan_ready** when plan succeeds (skip triaged) |
| PlanStep/ConflictFile dual-write | **No dual-write**; legacy tables read-only deprecated |
| CliCredential.createdBy onDelete | **SetNull** (credential survives for audit) |
| IdempotencyRecord.incidentId | **Real FK relation** to `Incident` |

---

## 19. Out of Scope (Phase 4)

- GitHub App, webhooks, worker queues
- Policy engine, Claude/Anthropic integration
- Billing, full UI redesign (Phase 7)
- Dropping legacy tables
- Repository-level role overrides (defer to Phase 5)
- Rate limiting infrastructure (stub only in 4C)

---

## 20. Approval

Phase 4A is complete when this document and companion plans (4B–4E) are reviewed and approved.

**Next command after approval:**

```text
Phase 4A approved. Continue with Phase 4B.
```
