# LatchOps — Target Architecture

> Companion to `REBUILD_AUDIT.md`. This describes the recommended end-state and records the explicit
> architectural decisions required by Phase 0. It is a target, not a directive to scaffold empty folders.
> Packages are created only when a phase needs them.

> **Phase 3 status: the deterministic core is now the single production path.**
> Decisions D1–D3 below (remove `apps/agent`, drop Python, reject `spoon-ai-sdk`) are
> **implemented**. The web app (`apps/web`) runs `@latchops/state-engine` and
> `@latchops/recovery-engine` in-process:
> `SnapshotV1 → RepoSignalsV1 → RecoveryPlanV1 → verifyRecovery`. No Python service,
> no `spoon-ai-sdk`, and no LLM call exist in the recovery path. A natural-language
> explanation layer (Anthropic) remains deferred to Phase 8. The PM2/Nginx runbook
> in `DEPLOYMENT_GUIDE.md` no longer includes a systemd analysis service.

---

## 1. Design principles (restated, binding)

1. **Deterministic-first.** Classification, git parsing, command generation, rollback planning, policy
   evaluation, and verification are pure, rule-based, reproducible functions. LLMs never author
   destructive commands, git-state classification, rollback decisions, or merge approvals.
2. **Safe by default.** Destructive steps are advisory, flagged, and require explicit confirmation.
   Every recovery step carries: command, reason, risk, prerequisites, expected outcome, undo strategy,
   verification command, destructive flag, confirmation requirement.
3. **Cross-platform.** Windows/macOS/Linux, worktrees, spaces, Unicode, detached HEAD, unborn branch,
   shallow repos. Process execution is always argument-array based (`execFile`/`spawn`), never a shell
   string built from interpolated input.
4. **Boring infrastructure.** TypeScript, Node, PostgreSQL, Zod, Prisma, explicit domain services,
   testable pure functions, standard GitHub App architecture. No graph-agent frameworks, no custom
   orchestration engines, no speculative microservices.
5. **No fake enterprise claims.** No invented customers, funding, certifications, or usage.
6. **Explainable risk.** Every score exposes its contributing reasons.

---

## 2. Target package/app topology

Introduced incrementally. Bold = exists today (in some form).

```
packages/
  schema/            # UNIFIED Zod contracts (fixes plan.ts vs analysis.ts split)
    snapshot/  signals/  incidents/  plans/  policies/  github/  billing/
  state-engine/      # deterministic git engine (extracted + hardened from apps/cli)
    git-runner/  collectors/  parsers/  normalizers/  classifiers/
    planners/  verifiers/  fixtures/  tests/
  policy-engine/     # rule evaluation over normalized signals (Phase 6)
    evaluator/  rules/  presets/  tests/
  github-app/        # GitHub App auth, webhooks, sync, PR/checks (Phase 5–6)
  shared/            # errors, logging, ids, config, telemetry

apps/
  cli/               # latchops CLI: snapshot, send, diagnose, plan, verify, doctor
  web/               # Next.js multi-tenant SaaS (evolve existing app)
  worker/            # background jobs — ONLY when processing outgrows request scope (Phase 5+)
  optional-demo-fixtures/
```

Import boundaries (enforced later via lint/tsconfig references):
`schema` depends on nothing; `state-engine`/`policy-engine`/`github-app` depend on `schema` + `shared`;
`apps/*` depend on packages, never the reverse; `state-engine` has **no** web/DB/LLM dependency.

---

## 3. Core domain contracts (target shape)

- `SnapshotV1` — keep and extend (git version, worktree info, unborn/shallow flags, NUL-delimited paths).
- `RepoSignalsV1` — normalized, deterministic signals (supersedes today's `Signals`).
- `IncidentTypeV1` — expanded enum (see §5).
- `RiskV1` — `{ level: info|low|medium|high|critical, score, factors: RiskFactor[] }`, always explainable.
- `RecoveryPlanV1` / `RecoveryStepV1` — every step carries the full safety envelope (§1.2).
- `VerificationResultV1` — deterministic before/after signal diff.
- `PolicyV1` / `PolicyEvaluationV1`, `PullRequestSignalsV1`, GitHub entities, billing entities — added per phase.

One canonical `IssueType`/`IncidentType` and one canonical `PlanStep`. The current `plan.ts` vs
`analysis.ts` duplication is removed.

---

## 4. Authorship model (target)

Authorship is a weighted aggregation of weak signals (commit trailer, PR label/template, actor, branch
naming, bot account, CLI metadata, co-author trailer, repo policy), resolving to
`human | ai_agent | mixed | unknown`. A human-authored change is **never** labeled AI from weak
heuristics alone; low-confidence resolves to `unknown`.

---

## 5. Incident types (target, incremental)

`clean, dirty_worktree, merge_conflict, rebase_in_progress, cherry_pick_in_progress,
revert_in_progress, bisect_in_progress, detached_head, unborn_branch, diverged_branch, stale_branch,
unpublished_commits, uncommitted_changes, conflict_markers_present, failed_ci, risky_force_push,
large_change_without_tests, dependency_change_risk, unknown`.

Phase 1 ships: `clean, dirty_worktree, merge_conflict, detached_head, rebase_in_progress, unknown`.
The rest are added explicitly in later phases.

---

## 6. Explicit Phase-0 decisions

| # | Question | Decision | Rationale |
|---|---|---|---|
| D1 | Remove `apps/agent`? | **Yes — remove in Phase 3.** | It duplicates deterministic logic already in TS and adds a second runtime, a linear "graph", and an extra deployment unit for one LLM call. |
| D2 | Keep Python? | **No.** | Nothing in the service needs Python. The single LLM call is trivially the Anthropic TS SDK. Dropping Python removes a whole toolchain, venv, systemd unit, and CORS surface. |
| D3 | Does `spoon-ai-sdk` have defensible value? | **No.** | `ChatBot` = thin Anthropic wrapper; `StateGraph` wraps a strictly linear pipeline; `BaseTool` nodes are already reimplemented in TS. Pure overhead. |
| D4 | Components to preserve | **CLI git collectors/parsers, Zod schema package, snapshot/send flows, NextAuth flow, Prisma+Postgres.** | These are the competent primitives; harden and relocate rather than rewrite. |
| D5 | Components to rewrite | **Recovery planner (LLM→deterministic), git runner (`execFile`), unified analysis engine, DB schema (multi-tenant + lifecycle), incident UI (consolidate).** | These directly violate principles or trap us in demo mode. |
| D6 | Keep Prisma? | **Yes.** | Boring, typed, migration-friendly; fits "boring infrastructure". Redesign the schema, keep the tool. |
| D7 | Worker app now? | **No — not immediately.** | Introduce `apps/worker` only in Phase 5 when GitHub webhook processing genuinely cannot stay request-bound. Until then, keep processing in-request/inline. |
| D8 | Queue infrastructure now? | **No.** | Start with synchronous processing and a persisted job/event table for idempotency. Add a real queue (e.g. pg-based) only when volume/retries demand it. |
| D9 | Is the current auth flow usable? | **Yes, with hardening.** | Keep NextAuth credentials+OAuth and bcrypt. Add organization scoping, fix the API IDOR (S-2), pin `next-auth` off beta when stabilizing, and reconcile `auth.ts`/`auth.config.ts` duplication. |
| D10 | Can the web app evolve or must it be restructured? | **Evolve.** | Next.js 16 (installed 16.2.2) + Prisma is the right stack. Consolidate the two incident UIs, remove dead pages, layer in multi-tenant routes/services. No greenfield rewrite. |

Additional decisions:
- **LLM provider abstraction (Phase 8):** one typed provider interface, Anthropic implementation,
  Zod-validated structured outputs, redaction layer, graceful no-key fallback. Model is configurable;
  no hard-coded model IDs scattered across files.
- **Manual snapshot upload** is demoted from primary flow to an advanced air-gapped/import feature (Phase 3).
- **Deterministic no-key behavior:** with no API key, LatchOps returns the deterministic plan and a
  neutral explanation — never a hard-coded fake "AI" plan (removes `llm.ts` mock plans).

---

## 7. Target end-to-end flow

```
AI-generated or risky change (local OR GitHub PR/CI event)
  → deterministic signal extraction (state-engine / github-app)
  → deterministic incident/PR risk classification (explainable)
  → policy evaluation (policy-engine)
  → incident creation (multi-tenant, lifecycle state machine)
  → deterministic recovery plan (templates, full safety envelope)
  → explicit undo path (reflog/backup-branch/stash/tag grounded)
  → deterministic verification (signal diff)
  → audit history (first-class AuditEvent)
  → optional LLM explanation/summary layer (never authoritative)
```

---

## 8. Deployment target (later phases, non-binding)

Keep it boring: containerized web app + managed PostgreSQL, environment-based secrets (no inline
secrets), health endpoints, structured logging, and a CI pipeline (typecheck + lint + tests). The
current PM2/systemd/Nginx runbook remains valid for a single VPS but is not the reference target.

---

## 9. Non-goals

- No autonomous execution of destructive git operations.
- No code generation / competing with coding agents.
- No microservice sprawl; no bespoke orchestration engine.
- No fabricated metrics, customers, or compliance claims.
