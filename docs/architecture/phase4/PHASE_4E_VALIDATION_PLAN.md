# Phase 4E — Minimal UI Migration, Security Review, and Full Regression Plan

> **Prerequisite:** Phase 4D approved.
> **Scope:** Minimum UI updates for org context, security review, adversarial testing, documentation, final Phase 4 report.

---

## 1. Objective

Update current UI to consume the new domain model **without** Phase 7 incident-room redesign. Complete security review and full regression validation.

---

## 2. Minimal UI Changes

### 2.1 In scope

| Area | Change |
|---|---|
| Organization context | Org selector in header/sidebar (if user has multiple orgs) |
| Incident list | `/history` and dashboard use `/api/v1/organizations/[orgId]/incidents` |
| Incident detail | Show `lifecycleStatus` badge (replace `GitSession.status`) |
| Repository | Show `displayName` + `primaryRemote` (no absolute paths) |
| Verification history | List `VerificationRun` records |
| Membership awareness | Show current user role in org |
| No-org state | Empty state prompting org creation or login |
| CLI token management | Simple admin page: create (show once), list by `tokenId`, revoke |
| Plan tab | Unchanged structure; reads `RecoveryPlanV1` from new model |
| Conflicts tab | Read from snapshot JSON (no legacy ConflictFile dependency) |

### 2.2 Out of scope

- Full incident-room redesign (Phase 7)
- Fake analytics/metrics
- Billing UI
- GitHub integration UI
- Policy engine UI

### 2.3 Page changes

| Page | Updates |
|---|---|
| `/dashboard` | Org context; import via v1 route; link to token management |
| `/history` | Tenant-scoped incident list; `lifecycleStatus` filter |
| `/incident/[id]` | `lifecycleStatus` badge; repository info; verification history section |
| `/auth/signin` | Post-login → ensure personal org → redirect dashboard |
| `/settings/tokens` (new) | CLI credential management (admin+) |
| `/settings/organization` (new) | Org name, members list (admin+) |

### 2.4 API client changes

Replace direct `/api/sessions` calls with v1 org-scoped endpoints. Keep `/incident/[id]` page route (URL stable via legacy bridge).

---

## 3. Security Review Checklist

Authorization/security agent must review every item before 4E sign-off.

### 3.1 Routes

- [ ] Every `/api/v1/*` route calls appropriate `require*` primitive
- [ ] No route accepts `organizationId` from body for authorization decisions
- [ ] CLI ingest route has no CORS (CLI only)
- [ ] Legacy shim routes delegate to same authz as v1

### 3.2 Tenant queries

- [ ] Repository layer: no unscoped `findUnique({ where: { id } })` on tenant models
- [ ] List endpoints filter by `organizationId` from auth context
- [ ] Cross-tenant ID → 404 (automated test matrix)

### 3.3 Mutations

- [ ] Archived org writes return 403
- [ ] Viewer cannot POST/PATCH/DELETE
- [ ] Final owner cannot be removed or demoted
- [ ] Lifecycle transitions require correct role

### 3.4 Token management

- [ ] Plaintext shown once on create
- [ ] List endpoint shows `tokenId` only (not secret, not hash)
- [ ] Direct lookup by `tokenId` (no candidate limit)
- [ ] `LATCHOPS_TOKEN_PEPPER` required in production (startup fails closed)
- [ ] Revoked tokens fail ingest
- [ ] Token never in logs, traces, or error responses
- [ ] Create/revoke audit is transactional (failure rolls back mutation)

### 3.5 List payload redaction

- [ ] No absolute `repoRoot` paths in list responses
- [ ] No snapshot JSON in list endpoints
- [ ] No conflict file contents in list endpoints
- [ ] No IP addresses persisted in audit events (omitted Phase 4)

### 3.6 Incident detail

- [ ] Full artefacts only for authorized members
- [ ] Corrupted JSON returns 409, not 500 with raw DB content

### 3.7 Legacy compatibility

- [ ] Legacy ID resolution cannot bypass org authz
- [ ] Anonymous legacy sessions not exposed via shim

### 3.8 Audit transactional integrity

- [ ] Authoritative audit failure rolls back mutation (ownership transfer, role change, archival, lifecycle, plan regen, credential create/revoke)
- [ ] Telemetry audit failure does not roll back pipeline
- [ ] Personal org creation uses `personalOwnerUserId @unique` + concurrent retry test

---

## 4. Migration Agent Verification

- [ ] `prisma migrate deploy` succeeds on empty database
- [ ] `prisma migrate deploy` succeeds on Phase 3 schema (baseline resolve)
- [ ] Backfill dry-run produces expected report
- [ ] Backfill apply + reconcile → delta 0
- [ ] Second backfill run → no duplicates
- [ ] Rollback documentation accurate (tested on disposable DB)

---

## 5. Adversarial Test Matrix

Test agent must execute and document results:

| Attack | Expected result |
|---|---|
| Cross-tenant incident ID (org A token, org B incident) | 404 |
| Cross-tenant incident ID (org A user, org B incident) | 404 |
| Viewer POST plan regenerate | 403 |
| Viewer POST verify | 403 |
| Member dismiss without reason | 400 |
| Admin remove sole owner | 409/403 (must transferOwnership first) |
| Concurrent transferOwnership | One wins, other 409 |
| Concurrent ensurePersonalOrganization | One org created |
| Archived org ingest | 403 |
| Archived org lifecycle transition | 403 |
| Invalid lifecycle transition (resolved → detected) | 409 |
| Verify from `detected` | 409 |
| Verify from `triaged` | 409 |
| Verify from `resolved` without reopen | 409 |
| Verify from `dismissed` without reopen | 409 |
| Verify from `plan_ready` | 200 → `verification_pending` |
| Verify from `recovery_in_progress` | 200 → `verification_pending` |
| Repeated verify from `verification_pending` | 200 (new VerificationRun) |
| Reopen then verify | 200 after `resolved → triaged → ...` |
| Cross-org repositoryId on incident create | 409/DB reject |
| Malformed CLI token (wrong segment lengths) | 401 |
| Unknown tokenId (dummy HMAC path) | 401 |
| Concurrent lifecycle transitions | One wins, other 409 |
| Revoked token ingest | 401 |
| Expired token ingest | 401 |
| Token replay after revocation | 401 |
| Anonymous production ingest (no flag) | 401/410 |
| Malicious `organizationId` in ingest body | Ignored; org from token |
| Forged repository fingerprint in body | Ignored; server computes |
| Corrupted planJson read | 409 |
| Oversized ingest payload (>5MB) | 413 |
| Idempotency key replay (same body) | 200, same incident |
| Idempotency key conflict (different body) | 409 |
| Rate limit exceeded on bad tokens | 429 |
| Valid tokenId + wrong secret | 401 |
| Production startup without LATCHOPS_TOKEN_PEPPER | Process exit / startup error |
| Authoritative audit write failure | Mutation rolled back |
| Dual-write ingest atomicity | Both Snapshot FKs set or neither |

---

## 6. CLI Smoke Tests

```bash
# Setup
export LATCHOPS_API_TOKEN=lops_live_k7mNpQxR2vLwY9zA.xK9mP2nQ7vR4wL8jH3fG6dS1aZ5cV0bN8yT2uI5oP7qW3eR6tY9uI0oP
export LATCHOPS_API_URL=http://localhost:3000

# Valid send
pnpm cli send

# Auth status (if implemented)
pnpm cli auth status

# Invalid token
LATCHOPS_API_TOKEN=invalid pnpm cli send  # expect failure

# Revoked token (after revoke in UI)
LATCHOPS_API_TOKEN=<revoked> pnpm cli send  # expect 401

# Anonymous ingest (production mode)
curl -X POST $LATCHOPS_API_URL/api/snapshots/ingest \
  -H 'Content-Type: application/json' \
  -d '{"snapshot":{}}'  # expect 401/410

# Local anonymous (dev only)
LATCHOPS_ALLOW_ANONYMOUS_INGEST=true pnpm dev:web
# legacy ingest may work for dashboard testing only
```

---

## 7. Database Test Matrix

| Database state | Tests |
|---|---|
| Empty (migrate deploy only) | Org create, ingest, lifecycle |
| Phase 3 representative fixture | Backfill dry-run + apply + reconcile |
| Partially migrated (interrupted backfill) | Resume + reconcile |
| Post-4D (legacy + new) | Compatibility routes + v1 routes |

**CI:** Ephemeral Postgres service container; `TEST_DATABASE_URL`; `prisma migrate deploy` in global setup.

---

## 8. Full Validation Commands

```bash
pnpm install
pnpm --filter @latchops/web exec prisma format
pnpm --filter @latchops/web exec prisma validate
pnpm --filter @latchops/web exec prisma generate
pnpm run lint
pnpm -r typecheck
pnpm -r test
pnpm run build:cli
pnpm build:web
```

**Additional 4E:**

```bash
pnpm migrate:phase4 --dry-run
pnpm migrate:phase4 --reconcile  # on fixture DB after apply
```

---

## 9. Documentation Updates

| File | Updates |
|---|---|
| `README.md` | Multi-tenant overview, CLI token setup, org model |
| `apps/cli/README.md` | `LATCHOPS_API_TOKEN`, auth commands, idempotency |
| `DEPLOYMENT_GUIDE.md` | `prisma migrate deploy`, token pepper, no anonymous prod |
| `apps/web/.env.example` | New env vars |
| `docs/architecture/TARGET_ARCHITECTURE.md` | Phase 4 complete status |
| `docs/architecture/MIGRATION_PLAN.md` | Phase 4 complete |
| `docs/architecture/phase4/MIGRATION_RUNBOOK.md` | Backfill, rollback, reconciliation |
| Token security guidance | In DEPLOYMENT_GUIDE or dedicated section |
| Organization/role docs | In README or `docs/architecture/phase4/ROLES.md` |

---

## 10. Final Phase 4 Report Contents

Save to `docs/architecture/phase4/reports/PHASE_4_FINAL_REPORT.md`:

1. Final domain model summary
2. Migrations applied (list of migration names)
3. Relational vs JSON decisions (confirmed)
4. Lifecycle state machine (as implemented)
5. Authorization model (roles, primitives)
6. CLI token design (as implemented)
7. Repository fingerprint (as implemented + test vector count)
8. Backfill results (counts from staging run)
9. Compatibility routes (shim behavior)
10. UI migration (pages changed)
11. Test totals (before/after Phase 4)
12. Migration validation results
13. Security findings and fixes
14. Remaining risks
15. Rollback instructions (link to runbook)
16. Phase 5 readiness recommendation

---

## 11. Test Count Target

| Package | Phase 3 baseline | Phase 4 target (estimate) |
|---|---|---|
| state-engine | 45 | 50+ (remote/root collectors) |
| recovery-engine | 73 | 73 (unchanged) |
| cli | 9 | 15+ (auth, send updates) |
| web | 16 | 80+ (domain, authz, integration) |
| **Total** | **143** | **220+** |

---

## 12. Approval Gate

After `PHASE_4_FINAL_REPORT.md` is complete:

```text
Phase 4 approved. Continue with Phase 5.
```

(Phase 5 scope defined separately — likely GitHub App / installation model.)
