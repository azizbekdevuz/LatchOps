# Phase 4A Report — Domain and Migration Design

> **Subphase:** 4A (Design only — final focused correction pass complete)
> **Date:** 2026-07-25
> **Status:** Complete — awaiting approval before Phase 4B implementation

---

## 1. Executive Summary

Phase 4A produced the canonical design for converting LatchOps from a single-user/session prototype into a secure multi-tenant SaaS domain. Five design documents were created under `docs/architecture/phase4/`. Two design-correction passes resolved all review issues before approval. No production code, Prisma schema, or database changes were made.

**Key decisions locked:**

| Decision | Choice |
|---|---|
| CLI authentication | Organization-scoped bearer token (`lops_live_<16-char-id>.<43-char-secret>`) with HMAC-SHA256 of complete token |
| Token lookup | Direct lookup by `tokenId` (16 chars, ≥96-bit); fixed-length parse; dummy HMAC on unknown id; constant-time compare |
| Token pepper | `LATCHOPS_TOKEN_PEPPER` **required in production**; fail closed if absent |
| Repository identity | Normalized remote URL + root commit fingerprint (not absolute path) |
| Incident ID | New `Incident.id` + `legacyGitSessionId` bridge |
| Default org | One personal org per user; `Organization.personalOwnerUserId @unique` + advisory lock + retry |
| Ownership model | **Single owner** per org; `transferOwnership()` atomic ceremony |
| Snapshot migration | Evolve `Snapshot` in place; dual nullable parents; legacy `gitSession` onDelete SetNull |
| Tenant consistency | Composite FKs (`Repository`, `Incident`, plan/snapshot alignment); service enforcement during transition |
| Lifecycle verify | Explicit source states only; terminal must reopen before verify |
| Audit writes | Authoritative = transactional (failure rolls back mutation); telemetry = best-effort |
| IP in audit | **Omitted from Phase 4** (privacy/retention) |
| Anonymous sessions | Skip bulk backfill; no new anonymous prod ingest after 4C |
| Plan storage | JSON only (`RecoveryPlanRecord.planJson`); no step normalization |
| Migration strategy | Expand → backfill → switch → contract; legacy tables retained |
| Schema tooling | Committed `prisma migrate` from Phase 4B onward |
| Cross-tenant access | 404; same-tenant insufficient role → 403 |
| Archived org | All writes blocked (403) |

---

## 2. Multi-Agent Task Plan

| Agent | Role | Output |
|---|---|---|
| Lead orchestrator | Coordinate, reconcile conflicts, write docs | This report + 5 design docs |
| Schema/persistence | Prisma models, JSON/relational split, indexes | Incorporated in PHASE_4A_DESIGN.md §4–§16 |
| Authorization/security | Role matrix, token design, threat analysis | Incorporated in PHASE_4A_DESIGN.md §5, §8–§10, §15 |
| Migration | Expand/backfill/switch/contract, backfill tool | PHASE_4D_MIGRATION_PLAN.md |
| API/domain | Routes, services, lifecycle, fingerprint | PHASE_4A_DESIGN.md §6–§7, §11; 4B/4C plans |
| Adversarial reviewer | Challenge design, find gaps | Findings incorporated below + §14 corrections |

---

## 3. Deliverables

| Document | Path | Status |
|---|---|---|
| Domain design | `docs/architecture/phase4/PHASE_4A_DESIGN.md` | ✅ (final corrected) |
| Phase 4B plan | `docs/architecture/phase4/PHASE_4B_IMPLEMENTATION_PLAN.md` | ✅ (final corrected) |
| Phase 4C plan | `docs/architecture/phase4/PHASE_4C_CLI_AUTH_PLAN.md` | ✅ (final corrected) |
| Phase 4D plan | `docs/architecture/phase4/PHASE_4D_MIGRATION_PLAN.md` | ✅ (final corrected) |
| Phase 4E plan | `docs/architecture/phase4/PHASE_4E_VALIDATION_PLAN.md` | ✅ (final corrected) |
| This report | `docs/architecture/phase4/reports/PHASE_4A_REPORT.md` | ✅ |

---

## 4. Target Entities (Designed, Not Implemented)

```text
Organization (with personalOwnerUserId)
Membership
Repository
Incident
Snapshot (evolved — dual nullable parents)
RecoveryPlanRecord
VerificationRun
AuditEvent (no ipAddress in Phase 4)
CliCredential (tokenId + tokenHash)
IdempotencyRecord (with incident FK)
MigrationCheckpoint / MigrationBackfillError (backfill tooling)
```

Legacy tables retained: `GitSession`, `Analysis`, `ConflictFile`, `ConflictHunk`, `PlanStep`, `Trace`, `Event`.

---

## 5. Adversarial Review — Findings Addressed in Design

| Severity | Finding | Design response |
|---|---|---|
| Critical | Anonymous ingest still open | Hard cutoff in 4C; `LATCHOPS_ALLOW_ANONYMOUS_INGEST` dev-only |
| Critical | No org scoping in queries today | Repository layer mandates `organizationId`; ban unscoped finds |
| Critical | Fingerprint undefined without remotes in snapshot | Snapshot v1 extension: `remotes[]`, `rootCommitOid`; legacy fallback for backfill |
| Critical | Dual-ID migration window IDOR risk | Short window; legacy routes delegate to `requireIncidentAccess` in 4D |
| Critical | `tokenPrefix` invalid (prefix consumed by `lops_live_`) | Replaced with `tokenId` direct lookup (≥96-bit entropy) |
| High | Bare SHA-256 for tokens | HMAC-SHA256 of complete token with server pepper |
| High | Token in logs | Explicit redaction policy in 4C |
| High | Lifecycle race conditions | Optimistic locking on `Incident.version` |
| High | Anonymous session retention | Skip backfill; TTL policy documented; claim-later deferred |
| High | Personal org duplicate on concurrent login | `personalOwnerUserId @unique` + advisory lock + retry |
| High | prisma migrate bootstrap | Baseline migration + `migrate resolve` documented in 4B plan |
| High | Archived org CLI ingest | `assertOrgWritable` blocks all mutations including ingest |
| High | Audit never throws breaks authoritative integrity | Split authoritative (transactional) vs telemetry (best-effort) |
| Medium | No ingest idempotency | `IdempotencyRecord` table + required header in 4C |
| Medium | Ingest not transactional | Single transaction per ingest in 4B incident-service |
| Medium | PlanStep/ConflictFile dual-write risk | No dual-write to legacy tables; read from JSON only |
| Medium | Snapshot bridge inconsistency | Dual nullable FK model; no `incidentSnapshotId` |
| Medium | Ownership model contradiction | Single owner chosen; `transferOwnership` ceremony |

**Rejected:** `RecoveryStepRecord` normalization (per master prompt and Phase 4A scope).

---

## 6. Resolved Agent Conflicts

| Conflict | Resolution |
|---|---|
| ApiToken vs CliCredential | **CliCredential** |
| IncidentSnapshot vs evolve Snapshot | **Evolve Snapshot in place** with dual nullable parents |
| Auto lifecycle: detected vs plan_ready on ingest | **detected → plan_ready** when plan succeeds |
| SHA-256 vs HMAC for token hash | **HMAC-SHA256 of complete token with pepper** |
| Token prefix vs tokenId lookup | **tokenId direct lookup** |
| Single vs multiple owners | **Single owner** + `transferOwnership` |
| Anonymous in 4A vs 4C | **No ingest auth change in 4A**; cutoff in 4C |
| ConflictFile dual-write | **No dual-write**; deprecated read-only |
| Audit never throws vs transactional | **Authoritative transactional** |
| IP address persistence | **Omitted Phase 4** |

---

## 7. Current State Inspection Summary

### 7.1 Prisma (unchanged in 4A)

- 11 application models + NextAuth tables
- Phase 3 canonical JSON on `Analysis`: `signalsJson`, `planJson`, `risk`, `engineVersion`
- `db push` only; no `migrations/` directory
- PostgreSQL provider

### 7.2 API routes (9 route files)

All session/incident routes use interim `authorizeSessionAccess`. Ingest routes allow anonymous write.

### 7.3 CLI

`send.ts` posts to `/api/snapshots/ingest` without authentication.

### 7.4 Tests

143 passing (state-engine 45, recovery-engine 73, cli 9, web 16). No DB integration tests.

---

## 8. Validation Results

Phase 4A required validation (no migrations, no `db push`):

| Command | Result |
|---|---|
| `pnpm run lint` | ✅ exit 0 |
| `pnpm -r typecheck` | ✅ all 5 projects clean |
| `pnpm -r test` | ✅ 143 passed, exit 0 |
| `pnpm --filter @latchops/web exec prisma format` | ✅ formatted |
| `pnpm --filter @latchops/web exec prisma validate` | ✅ valid |

**Not run (per 4A scope):** `prisma migrate dev`, `db push`, `build:cli`, `build:web` (no code changes).

---

## 9. Migration Risks

| Risk | Mitigation |
|---|---|
| Baseline migration on existing DB | `migrate resolve --applied` for 0_baseline |
| Dual-write divergence | Feature flag off by default; atomic single-tx dual-write; reconciliation in 4D |
| Anonymous data orphaned | Documented skip; no arbitrary org assignment |
| Fingerprint collision (template repos) | Per-org uniqueness; documented limitation |
| SSH vs HTTPS different fingerprints | Documented; Phase 5 canonicalization |
| Backfill on large datasets | Batched with checkpoint; advisory lock |
| Rollback complexity | DB restore from pre-apply dump; truncate + null bridges |
| Partial index Prisma compatibility | Explicit SQL in migration.sql; CI pg_indexes assertion |

---

## 10. Local Data Compatibility

- Existing `GitSession`/`Analysis`/`Snapshot` rows preserved through expand + bridge columns.
- Phase 3 canonical JSON (`signalsJson`, `planJson`) backfilled into `RecoveryPlanRecord` with Zod validation.
- Invalid JSON rows: incident shell created with `incomplete=true`; reported in backfill error log.
- Anonymous sessions: remain in legacy tables; not migrated; not exposed.
- Snapshot rows: same `Snapshot.id` preserved; `incidentId` set during backfill on existing row.

---

## 11. Remaining Security Risks (Post-4A Design)

| Risk | Phase |
|---|---|
| Open registration spam | Phase 9 invite-only toggle |
| No rate limiting infrastructure | Stub in 4C; Redis in Phase 11 |
| Snapshot content sensitivity (paths, diffs) | Redaction layer Phase 11 |
| OAuth account linking | Standard NextAuth; monitor |
| SSH/HTTPS fingerprint split | Phase 5 canonical host mapping |
| IP address audit trail | Deferred to Phase 11 with retention policy |

---

## 12. Phase 4B Readiness

Phase 4B can begin immediately after approval. First implementation steps:

1. Bootstrap `prisma/migrations/0_baseline_phase3`
2. Add Phase 4 models via `phase4b_expand_domain` migration
3. Implement repository layer with mandatory org scoping
4. Implement `authz-org-core` + domain services (including audit split)
5. Extend `SnapshotV1` with optional `remotes`/`rootCommitOid`
6. Add integration test harness with `TEST_DATABASE_URL`

---

## 13. Approval Command

Phase 4A is complete. Implementation of Phase 4B must not begin until explicit approval.

```text
Phase 4A approved. Continue with Phase 4B.
```

---

## 14. Design Corrections (Review Pass)

Each issue from the design-correction review and its final resolution:

| # | Issue | Resolution |
|---|---|---|
| 1 | **CLI credential lookup:** `tokenPrefix = first 12 chars` invalid because `lops_live_` consumes most characters | Token format changed to `lops_live_<token-id>_<secret>`. `tokenId` (≥96-bit entropy) stored with `@unique` constraint. `tokenHash` = HMAC-SHA256 of complete token. Direct lookup by `tokenId`; constant-time compare; no candidate limit. `LATCHOPS_TOKEN_PEPPER` required in production (fail closed). Updated in PHASE_4A_DESIGN §4.10, §5; PHASE_4C §2; all token examples reconciled across 4A–4E. |
| 2 | **Personal-organization invariant:** Membership uniqueness does not enforce one personal org per user | Added `Organization.personalOwnerUserId String? @unique`. `ensurePersonalOrganization` uses advisory lock + transaction + unique-violation retry. Documented in PHASE_4A_DESIGN §4.2, §12; PHASE_4B §7. |
| 3 | **Security audit writes:** `auditService.record()` never throws for authoritative mutations | Split into `recordAuthoritative(tx, event)` (transactional, throws → rolls back) and `recordTelemetry(event)` (best-effort). Authoritative list defined for ownership transfer, role change/removal, archival, lifecycle, plan regen, credential create/revoke, ingest. Updated PHASE_4A_DESIGN §4.9, §10, §14; PHASE_4B §4.6; PHASE_4E §3.8. |
| 4 | **Snapshot expand/backfill inconsistency:** alternated between required `incidentId` and `incidentSnapshotId` bridge | Chose coherent dual-parent model: `Snapshot.gitSessionId` and `Snapshot.incidentId` both nullable during transition; row may reference legacy session, new incident, or both. No `incidentSnapshotId`. Same pattern for `Analysis` and `Trace`. FK nullability by subphase documented. No required FKs before backfill. PHASE_4A_DESIGN §4.6, §4.13; PHASE_4B §2.2; PHASE_4D §4.1, §8. |
| 5 | **Single-owner vs multiple-owner contradiction** | Chose **single owner**. `transferOwnership()` atomic ceremony. Partial unique index retained. Concurrent transfer → 409. Archived org blocks transfer. Deleted user cannot delete account while sole owner. PHASE_4A_DESIGN §4.3; PHASE_4B §4.1; PHASE_4E adversarial tests. |
| 6a | **`CliCredential.createdBy` Cascade** | Changed to `SetNull` on user deletion (credential survives for audit). PHASE_4A_DESIGN §4.10; PHASE_4C §2.1. |
| 6b | **`IdempotencyRecord.incidentId` no relation** | Added real FK relation to `Incident`. PHASE_4A_DESIGN §4.11; PHASE_4C §4.3. |
| 6c | **IP address retention/privacy** | `ipAddress` omitted from `AuditEvent` in Phase 4. Revisit in Phase 11 with retention policy. PHASE_4A_DESIGN §4.9. |
| 6d | **Dual writes atomicity** | Dual-writes must set both `gitSessionId` and `incidentId` in one database transaction. PHASE_4A_DESIGN §4.13, §14; PHASE_4B §8; PHASE_4D §10. |
| 6e | **Partial PostgreSQL indexes + Prisma workflow** | Partial indexes declared in companion `migration.sql` SQL. CI verifies via `pg_indexes` after `prisma migrate deploy`. PHASE_4A_DESIGN §4.3, §4.13, §16; PHASE_4B §2.2. |
| 6f | **Token examples inconsistent across 4A–4E** | All documents use `lops_live_k7mNpQxR2vLwY9zA.xK9mP2nQ7vR4wL8jH3fG6dS1aZ5cV0bN...` format (updated in pass 2). |

---

## 16. Design Corrections (Final Focused Pass)

| # | Issue | Resolution |
|---|---|---|
| 7 | **Ambiguous CLI token parsing:** `_` separator conflicts with Base64URL alphabet | Format changed to `lops_live_<16-char-id>.<43-char-secret>`. Regex enforces exact lengths. Dummy HMAC on unknown `tokenId`. Updated PHASE_4A_DESIGN §5; PHASE_4C §2; PHASE_4E adversarial + smoke tests. |
| 8 | **Legacy-parent cascade deletes canonical data** | `Snapshot.gitSession`, `Analysis.gitSession`, `Trace.gitSession` → `onDelete: SetNull`. Canonical `incident` FKs → `Cascade`. Deletion table in PHASE_4A_DESIGN §4.6; PHASE_4B §2.2; PHASE_4D §4.2. |
| 9 | **No database-level tenant consistency** | Composite FKs: `Incident → Repository(id, organizationId)`, `IdempotencyRecord → Incident(id, organizationId)`, plan/snapshot incident alignment. Service + reconciliation during nullable transition. PHASE_4A_DESIGN §4.14; PHASE_4B §2.2; PHASE_4D §4.3. |
| 10 | **Lifecycle wildcard `* → verification_pending`** bypasses terminal reopen | Replaced with explicit verification matrix. Terminal states must `reopen → triaged` before verify. Reject verify from `detected`, `triaged`, `resolved`, `dismissed`. Allow from `plan_ready`, `recovery_in_progress`, `verification_pending` (repeat). PHASE_4A_DESIGN §7.2; PHASE_4B §9; PHASE_4E §5. |

---

## 17. Post-Correction Validation (Final)

Design-only validation re-run after correction pass (no migrations, no `db push`):

| Command | Result |
|---|---|
| `pnpm run lint` | ✅ exit 0 |
| `pnpm -r typecheck` | ✅ all 5 projects clean |
| `pnpm -r test` | ✅ 143 passed, exit 0 |
| `pnpm --filter @latchops/web exec prisma format` | ✅ formatted |
| `pnpm --filter @latchops/web exec prisma validate` | ✅ valid |

**Not run (per 4A scope):** `prisma migrate dev`, `db push`, `build:cli`, `build:web` (no code changes).
