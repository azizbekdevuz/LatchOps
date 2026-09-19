# LatchOps — Migration Plan

> Companion to `REBUILD_AUDIT.md` and `TARGET_ARCHITECTURE.md`.
> Work proceeds in the numbered phases from the product brief. Each phase ends with a full report and a
> hard stop for explicit approval. This plan records the migration strategy, ordering, and the
> "identify consumers → migrate → update imports → add tests → delete after replacement works" rule.

Legend: 🟢 preserve/evolve · 🟡 rewrite/replace · 🔴 remove.

---

## Guiding migration rules

1. Never delete working code before its replacement is proven and its consumers are migrated.
2. Every extraction ships with tests (state-engine gets the highest coverage).
3. Keep the build green at each phase boundary (typecheck + tests + lint).
4. Change the deterministic core and the destructive-command policy **before** touching UI polish or billing.

---

## Phase-by-phase migration

### Phase 1 — State engine extraction & hardening 🟡🟢
- **Create** `packages/state-engine`. Move the **good primitives** out of `apps/cli`:
  collectors (`git-info`, `rebase-detector`, `conflict-extractor`) and parsers
  (`status`, `branch`, `log`, `reflog`, `diffstat`).
- **Rewrite** the git runner: replace `execSync`+string (finding S-1) with an `execFile`/`spawn`
  argument-array runner featuring timeouts, output-size limits, CRLF/LF normalization, explicit
  working directory / `-C`, git-version detection, worktree/git-dir resolution, and structured errors.
- **Harden parsing:** NUL-delimited (`-z`) status where possible; correct space/Unicode/rename handling;
  fix `rebase-detector` cwd assumption.
- **Normalize** to `RepoSignalsV1` + an initial deterministic classifier
  (`clean, dirty_worktree, merge_conflict, detached_head, rebase_in_progress, unknown`).
- **Consumers to migrate:** `apps/cli` imports the engine instead of local modules; keep CLI behavior identical.
- **Tests:** exhaustive unit tests for every parser/classifier + temp-repo integration tests
  (spaces, detached HEAD, conflicts, rebase, Windows execution).
- **Do NOT** touch GitHub or LLM. Old CLI modules deleted only after the engine passes and CLI is repointed.

### Phase 2 — Deterministic recovery planner & verifier 🟡
- Define `RecoveryPlanV1`/`RecoveryStepV1`/`VerificationResultV1` in `packages/schema` (unified).
- **Rewrite planning as deterministic templates** for merge_conflict, detached_head, rebase_in_progress,
  dirty_worktree, clean, unknown. Every step carries the full safety envelope; destructive steps are
  advisory + flagged + require confirmation. Add preflight backup steps (safety branch / patch / stash /
  reflog ref / tag).
- Deterministic verification via signal diff.
- CLI: add `diagnose`, `plan`, `verify`, `doctor`; **preserve** `snapshot`, `send`; add JSON + human
  output modes and CI-friendly exit codes. Fixtures per incident type.
- **No LLM** in the core planner. This phase directly retires the "LLM authors the plan" violation for local use.

### Phase 3 — Remove prototype agent architecture 🔴 ✅ DONE
- Confirm no unique value (already decided: none — see TARGET §6 D1–D3).
- **Removed** `apps/agent`, `spoon-ai-sdk`, the systemd unit, `AGENT_URL`, and agent-specific docs
  (`AGENT_SERVICE_GUIDE.md`).
- **Removed dead code:** `apps/web/src/lib/api.ts` (Spring Boot), `apps/web/src/app/result/page.jsx`,
  inline secrets in `ecosystem.config.js` (now env-only), the LLM agent (`apps/web/src/lib/agent/*`),
  `lib/llm.ts`, and the legacy schemas `plan.ts`/`analysis.ts`/`signals.ts`/`api.ts`.
- **Migrated** the ingest/plan/verify/explain routes off the Python call + `generateFallbackAnalysis`
  onto the Phase 1–2 deterministic engines via `apps/web/src/lib/recovery/` (single analysis path).
  Persisted canonical `RepoSignalsV1`/`RecoveryPlanV1` (Zod-validated) in additive nullable `Analysis`
  columns; traces are deterministic pipeline stages.
- **Mandatory correctness fix:** cherry-pick/revert/bisect conflicts route to a sequencer-operation
  planner and never emit `git merge --abort`/`--continue` for a non-merge operation (unit + integration
  tests added).
- Demoted manual snapshot upload to an advanced import/air-gapped feature.
- Updated all architecture docs. Build/tests pass (143 tests green).
- **Deferred to later phases:** the `session/[id]` → `incident/[id]` consolidation is a redirect only
  (full Phase 7 incident-room redesign deferred); the legacy `PlanStep`/`ConflictFile` Prisma tables are
  retained but unused (normalized into first-class tables in Phase 4); the natural-language explanation
  layer (Anthropic) is Phase 8.

### Phase 4 — SaaS domain model & incident lifecycle 🟡🟢
- Redesign Prisma schema (keep Prisma+Postgres — D6): add `User` (exists), `Organization`, `Membership`,
  `Repository`, `GitHubInstallation`, `PullRequest`, `WorkflowRun`, `Incident`, `IncidentSignal`,
  `RecoveryPlan`, `RecoveryStep`, `VerificationRun`, `Policy`, `PolicyEvaluation`, `AuditEvent`.
- Migrate existing `GitSession/Snapshot/Analysis/...` data model into the incident model with a
  migration path (keep read compatibility during transition).
- Add org-scoped authorization and repository ownership checks; **fix the IDOR (S-2)** on all
  incident/session routes. Add incident status state machine
  (`detected → triaged → plan_ready → recovery_in_progress → verification_pending → resolved/dismissed`).
- Introduce a repository/service layer; remove route-level duplicated DB logic. Seed a local demo org.
  Add integration tests, request validation, consistent IDs/timestamps, soft-delete/archival. No billing yet.

### Phase 5 — GitHub App foundation 🟡
- `packages/github-app`: App config docs, signed+replay-protected webhook endpoint, installation storage,
  handlers for installation(_repositories), pull_request, push, workflow_run, check_suite, check_run.
- Idempotency + event persistence + repo/PR/workflow sync + a job abstraction with retries and
  failure persistence (dead-letter). **Introduce `apps/worker` only if processing cannot stay
  request-bound (D7); start with a persisted job/event table, no external queue (D8).**
- Signed-webhook fixture tests; local webhook dev instructions. No PR comments yet unless needed to validate.

### Phase 6 — Pull request risk engine 🟡
- `PullRequestSignalsV1` + explainable classification + `packages/policy-engine` with default policies
  (large AI PR w/o tests, protected-branch high-risk, failed CI on agent PR, dependency/lockfile,
  migration w/o rollback, force-push, stale branch, conflict risk).
- Structured PR report; one updated GitHub comment per PR (no spam); check-run output; configurable verbosity.
- Unit + GitHub fixture tests + example reports.

### Phase 7 — Incident room rebuild 🟡🟢
- Consolidate the two incident UIs (`incident/[id]` vs `session/[id]`) into one production-grade room.
- Dashboard, repository detail, incident room (type/risk/reasons/signals/recovery tree/undo/verification/
  audit), policy management. Real empty/loading/error states, accessible, responsive. No fake analytics.

### Phase 8 — Claude explanation layer 🟡
- Typed provider abstraction + Anthropic impl; structured, Zod-validated outputs; prompt versioning;
  token accounting; timeout/retry; **redaction layer** (no secrets/full repo contents); configurable
  model; graceful no-key fallback. LLM never alters deterministic facts or emits executable commands
  outside validated templates. Mocked-provider tests.

### Phase 9 — Pilot onboarding & notifications 🟢
- Onboarding (create org → connect GitHub → select repos → enable starter policies → first report),
  installation health, sync status, email/Slack notifications, high-risk alerts, weekly report,
  invitations + roles (owner/admin/member/viewer), privacy/terms/data-deletion/export, privacy-safe telemetry.

### Phase 10 — Monetization foundation 🟢
- Plans (Free/Team/Startup), entitlements, usage tracking, Stripe **test-mode** checkout + portal +
  subscription webhooks, plan enforcement, trials, manual pilot override, billing audit logs, pricing
  page. No fake savings claims. Entitlement-boundary tests.

### Phase 11 — Production hardening 🟢
- Security review, threat model, webhook-abuse review, authz audit, secret handling, snapshot redaction,
  rate limiting, log redaction, job durability, observability/error monitoring, health endpoints, backups,
  migration strategy, retention controls, dependency audit, CI, preview deploys, deployment/DR docs,
  release/versioning, CLI publish readiness, marketplace readiness, ADRs.

### Phase 12 — Market launch readiness 🟢
- Marketing homepage, product/CLI/security/pricing/docs/pilot pages, one real end-to-end demo, founder
  onboarding material, Claude/AWS Activate application content, outreach templates, screenshots, launch
  article, OSS CLI release plan, success criteria + product metrics.

---

## Immediate security remediations (fold into the earliest relevant phase)

| ID | Fix | Phase |
|---|---|---|
| S-1 | Argument-array git runner with timeouts + structured errors | 1 |
| S-2 | Org-scoped authorization on all incident/session/API routes (fix IDOR) | 4 (interim guard acceptable sooner) |
| S-3 | Remove inline secrets from `ecosystem.config.js`; avoid shell-string URL open in `send.ts` | 3 |
| S-4 | LLM redaction layer | 8 |
| S-5 | Snapshot retention/redaction | 4 / 11 |
| S-6 | Ingest auth + rate limiting | 5 / 11 |
| S-7 | Production CORS | 3 (removed with Python) / 11 |
| S-9 | Reconcile `.npmrc` scope vs package names | 11 |

---

## Cross-phase test build-out

Unit → temp-git integration → webhook fixtures → DB integration → authorization → e2e → migration →
CLI smoke → Windows compatibility. The **state-engine carries the highest coverage**. Prioritize
correctness over a coverage percentage.

---

## Definition of done per phase

Build green (typecheck+lint+tests), consumers migrated, dead code removed **only after** replacement
works, docs updated, and a complete phase report delivered (inspected/changed/added/modified/removed,
decisions, tests, commands, results, known failures, risks, migration concerns, next-phase recommendation).
Then **stop** and await approval.
