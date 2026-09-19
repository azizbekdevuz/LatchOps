# LatchOps — Phase 0 Rebuild Audit

> Status: Phase 0 (read-only audit). No production code was modified.
> Method: full file-by-file inspection of the tracked repository plus a workspace typecheck.
> Date of audit: see git history for this document.

> **Phase 3 addendum (historical record).** This document describes the *original
> prototype* as it existed before the rebuild. Much of what it audits has since
> been removed:
> - **Removed in Phase 3:** the Python FastAPI service (`apps/agent`), `spoon-ai-sdk`,
>   the TypeScript LLM agent (`apps/web/src/lib/agent/*`), `lib/llm.ts`, the dead
>   Spring Boot client (`lib/api.ts`), the static mock result page, `AGENT_URL`, and
>   all LLM/"fallback" analysis paths.
> - **Now the single production path:** `SnapshotV1 → @latchops/state-engine
>   (RepoSignalsV1) → @latchops/recovery-engine (RecoveryPlanV1) → deterministic
>   verification`. There is no LLM in the recovery path.
> References below to three competing analysis systems, LLM-generated plans, or
> `AGENT_URL` reflect the pre-rebuild state and are retained only as an audit record.
> See `TARGET_ARCHITECTURE.md` for the current design.

This document is the honest source of truth for the current state of the codebase. Where the
original product brief and the code disagree, the code wins and is described here.

---

## 1. Executive summary

LatchOps is a pnpm/TypeScript monorepo (3 TS workspaces + 1 Python service) that today implements a
**single-user, local "git incident room" demo**:

1. A CLI captures a read-only `SnapshotV1` of the current repo and either prints it or POSTs it to the web app.
2. The web app persists the snapshot, runs analysis, and renders an incident room UI.
3. Analysis is performed by **three overlapping and inconsistent implementations** (Python LLM graph, TypeScript LLM agent, TypeScript rule-based fallback).

The deterministic-first principle in the brief is **not** met by the current implementation:
the primary recovery-plan path is generated **entirely by an LLM** (both in the Python service and in
`apps/web/src/lib/agent/planner.ts`). Rule-based analysis exists only as a *fallback* when the LLM is
unavailable, which is the inverse of the intended architecture.

The foundation worth keeping is real: the CLI collectors/parsers (porcelain v2, reflog, rebase-state,
conflict extraction) are competent deterministic building blocks, and the Zod schema package is a
reasonable starting contract. Almost everything above that line needs restructuring.

**Overall verdict:** solid prototype-grade primitives, prototype-grade architecture. Keep the git
primitives and the schema discipline; rebuild the analysis core to be deterministic-first; remove the
Python/`spoon-ai-sdk` service; and evolve (not rewrite) the Next.js app toward a real multi-tenant model.

Validation performed during the audit:
- `pnpm -r typecheck` → **passes** (schema, cli, web all clean).
- No linter is configured (no ESLint/Biome config, no `lint` script).
- No test runner is configured and there are **zero** test files.

---

## 2. Repository layout (as-built)

```
LatchOps/
├── package.json                 # root scripts, pnpm overrides, engines node>=20
├── pnpm-workspace.yaml          # packages: apps/*, packages/*
├── tsconfig.base.json           # strict, NodeNext, ES2022
├── .npmrc                       # @azizbekdevuz scoped registry (see finding S-9)
├── ecosystem.config.js          # PM2 web process (secrets inline — see S-2)
├── nginx.conf.example
├── README.md  DEPLOYMENT_GUIDE.md  AGENT_SERVICE_GUIDE.md
├── packages/
│   └── schema/                  # @latchops/schema — Zod contracts
│       └── src/{index,snapshot,signals,plan,analysis,api}.ts
├── apps/
│   ├── cli/                     # @latchops/cli — commander CLI (snapshot, send)
│   │   └── src/
│   │       ├── index.ts
│   │       ├── utils/exec.ts    # execSync-based git runner (see S-1)
│   │       ├── collectors/{git-info,rebase-detector,conflict-extractor}.ts
│   │       └── parsers/{status,branch,log,reflog,diffstat}-parser.ts
│   ├── web/                     # @latchops/web — Next.js 16 + Prisma + NextAuth
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   │       ├── middleware.ts
│   │       ├── lib/{auth,auth.config,prisma,db,llm,api,utils}.ts
│   │       ├── lib/agent/{index,collector,classifier,planner,verifier,explainer}.ts
│   │       └── app/
│   │           ├── page.tsx (marketing)  dashboard/  history/
│   │           ├── incident/[id]/ (+ tabs/*)   session/[id]/   result/page.jsx
│   │           ├── auth/{signin,signup,error}/
│   │           └── api/{snapshots/ingest, sessions/[id]/{plan,verify,explain}, incident/[id], auth/*}
│   └── agent/                   # Python FastAPI service (spoon-ai-sdk graph)
│       └── {main,graph,nodes,tools,models,fallback,llm_utils}.py + requirements.txt + .service
└── demos/                       # merge-conflict / detached-head READMEs + sample snapshots
```

Approx. 111 tracked files. The three uncommitted/working-tree changes noted at audit start
(`apps/agent/{main,nodes}.py`, new `apps/agent/llm_utils.py`, `AGENT_SERVICE_GUIDE.md`) are part of
the existing Python service and do not change the conclusions.

---

## 3. Dependency map

### Workspace packages
- `@latchops/schema` → `zod`. No internal deps. Consumed by `@latchops/cli` and `@latchops/web` via `workspace:*`.
- `@latchops/cli` → `@latchops/schema`, `commander`, `zod`. Node built-ins (`child_process`, `fs`, `path`).
- `@latchops/web` → `@latchops/schema`, `next` (see version note below), `react@19`, `@prisma/client@6`, `next-auth@5-beta`, `@auth/prisma-adapter`, `bcryptjs`, `nanoid`, `lucide-react`, `class-variance-authority`, `clsx`, `tailwind-merge`, `@radix-ui/react-slot`, `zod`.
- `apps/agent` (Python) → `fastapi`, `uvicorn`, `pydantic`, `httpx`, `python-dotenv`, `anthropic`, **`spoon-ai-sdk`**.

### Runtime coupling
- CLI → Web via HTTP `POST /api/snapshots/ingest` (default `http://localhost:3000`, override `LATCHOPS_API_URL`).
- Web → Python agent via HTTP `POST {AGENT_URL}/analyze` (default `http://localhost:8000`).
- Web → Anthropic API directly from `apps/web/src/lib/llm.ts` (used by the TS `lib/agent` path).
- Web → PostgreSQL via Prisma.

### Notable version / config observations
- **Declared vs. installed drift (corrected during Phase 1, Amendment B).** Package manifests understate the installed versions because the root `pnpm.overrides` force-upgrade several packages. Verified via `pnpm --filter @latchops/web ls`:

  | Package | Declared in `package.json` | Actually installed |
  |---|---|---|
  | `next` | `^15.1.3` | **16.2.2** |
  | `next-auth` | `^5.0.0-beta.25` | `5.0.0-beta.30` |
  | `@prisma/client` / `prisma` | `^6.1.0` | `6.19.3` |
  | `react` / `react-dom` | `^19.0.0` | `19.2.4` |

  The original Phase 0 draft said "Next.js 15"; the real installed major is **16**. The `next` override
  chain in root `package.json` (`"next@>=10.0.0 <15.5.14": ">=15.5.14"`) resolves to the latest `next`,
  which is why a `^15.1.3` declaration installs 16.x. The manifest `next` range should be reconciled with
  the override (cleanup item, not Phase 1 scope).
- `next-auth@5.0.0-beta.30` — still pre-release; API can shift.
- Root `pnpm.overrides` force-upgrade `next`/`effect`/`picomatch` for CVE mitigation — reasonable, but a sign of dependency drift (and the cause of the manifest/installed mismatch above).
- `.npmrc` scopes `@azizbekdevuz` to npmjs while package names are `@latchops/*` — inconsistent publishing story (finding S-9).

---

## 4. Runtime & data flow (as-built)

### 4.1 CLI `snapshot`
`collectGitInfo()` runs a fixed set of git commands → parsers build a `SnapshotV1` → Zod validates → JSON to stdout/file. Read-only. Progress noise is written to **stderr** so stdout stays clean JSON. Good.

### 4.2 CLI `send`
Same collection, then `POST /api/snapshots/ingest`. Optionally opens the returned incident URL using a shell string (finding S-3).

### 4.3 Web ingest (`POST /api/snapshots/ingest`)
1. Validate snapshot (Zod).
2. `auth()` — user optional; **anonymous uploads allowed** (`userId: null`).
3. Create `GitSession` + `Snapshot`, save an `ingest` trace.
4. Call Python `AGENT_URL/analyze`. On any failure, fall back to `generateFallbackAnalysis()` (deterministic TS in `ingest/utils.ts`).
5. Persist `Analysis`, `ConflictFile`, `ConflictHunk`, `PlanStep`, pipeline `Trace`s.
6. Return `{ sessionId, url, analysis }`.

### 4.4 Web session/plan/verify/explain (`/api/sessions/[id]/*`)
A **second, parallel** pipeline that uses `apps/web/src/lib/agent/*`:
- `collector.ts` (deterministic signals) → `classifier.ts` (LLM only when `unknown`) → `planner.ts` (**LLM generates the entire plan**) → `verifier.ts` (rule check + LLM guidance) → `explainer.ts` (LLM).
- `POST /api/sessions/[id]/plan` *also* tries the Python agent first, then falls back to this TS LLM pipeline.

### 4.5 UI
Two incident UIs coexist:
- `app/incident/[id]/` (tabbed: Overview/Conflicts/Plan/Verify/Trace) → reads `GET /api/incident/[id]`.
- `app/session/[id]/` (~921 lines, older, richer explain-driven UI) → reads `GET /api/sessions/[id]`.
- `app/result/page.jsx` is a static hard-coded mock (no data wiring).

---

## 5. Git diagnosis flow (deterministic primitives) — quality notes

These live in `apps/cli/src` and are the strongest part of the codebase.

Good:
- Uses `git status --porcelain=v2 --branch`, `rev-parse`, `reflog`, `branch -vv`, `log`, `diff --numstat`.
- Rebase detection reads `rebase-merge`/`rebase-apply` via `rev-parse --git-path` — worktree-aware in intent.
- Conflict extraction bounds output (max blocks, truncation) and normalizes CRLF→LF.

Weak / risky (to be hardened in Phase 1):
- **Process execution is unsafe/limited** — see finding S-1. `execGit` builds a shell string and lacks timeouts and structured errors.
- **Path parsing splits on spaces.** `parseStatus` reconstructs paths with `parts.slice(n).join(' ')`, which is fragile for paths with runs of spaces and does not use the `-z` NUL-delimited format. Rename entries rely on a literal tab, which porcelain v2 only emits under specific conditions. Unicode paths are not explicitly handled/quoted.
- **`rebase-detector` resolves paths against `process.cwd()`**, not the repo/git dir, so it can misbehave when invoked from a subdirectory or a linked worktree.
- **No detection** for cherry-pick, revert, bisect, unborn branch, diverged/stale branch, or conflict-markers-without-merge. `IssueType` is limited to `merge_conflict | detached_head | rebase_in_progress | clean | unknown`.
- **No git version detection**, no shallow-repo handling, no explicit `--work-tree`/`-C <dir>` targeting (always operates on CWD).

---

## 6. LLM flow (as-built) vs. the deterministic-first requirement

| Concern | Requirement | As-built | Gap |
|---|---|---|---|
| Classification | Deterministic rules | Deterministic in `collector.ts` / Python `DetectIssueTool`; LLM only for `unknown` | Mostly OK |
| Recovery plan | Deterministic templates | **LLM generates the whole plan** (`planner.ts`, Python `generate_analysis_node`) | **Violation** |
| Destructive commands | Never LLM-authored | LLM can emit `git reset --hard HEAD@{N}` etc. | **Violation** |
| Verification | Deterministic | Rule check + LLM narrative | Partial |
| Explanation | LLM allowed | LLM (`explainer.ts`) | OK |
| Output validation | Strict schema | `callLLMWithJSON` validates with Zod + regex JSON extraction + retry | Acceptable but brittle (regex extraction, `data.content[0].text` unchecked) |
| No-key behavior | Safe fallback | `llm.ts` returns **hard-coded mock plans** | Misleading: emits fake "analysis" instead of a deterministic plan |

Model config is inconsistent: `llm.ts` hard-codes `claude-3-haiku-20240307`; the Python service defaults to `claude-sonnet-4-20250514`. No prompt versioning, no token accounting, no redaction layer — conflict *file contents* are sent to the model.

---

## 7. Incident lifecycle (as-built)

There is no real lifecycle. `GitSession.status` is a free-form string (`pending | analyzing | ready | error`). There is no `Incident` entity, no state machine (`detected → triaged → plan_ready → … → resolved/dismissed`), no ownership beyond an optional `userId`, and no organization scoping. "Verification" writes a `verify` trace but does not transition any status.

---

## 8. Dead-code and demo-only candidates

| Item | Evidence | Recommendation |
|---|---|---|
| `apps/web/src/lib/api.ts` | References a **Spring Boot** backend at `:8080`; `analyzeRepository` is imported nowhere. | Remove (dead). |
| `apps/web/src/app/result/page.jsx` | Hard-coded static `analysisResult`; not wired to any data. | Remove or fold into a real view. |
| Duplicate incident UI | `app/session/[id]/` (~921 lines) vs `app/incident/[id]/`. | Consolidate to one (Phase 7). |
| `packages/schema/src/plan.ts` **and** `analysis.ts` | Two different `IssueTypeSchema` and two different `PlanStep` shapes; `index.ts` cherry-picks to avoid collisions. | Unify into one schema family. |
| `generateFallbackAnalysis` (ingest utils) vs `lib/agent/*` vs Python nodes | Triplicated analysis logic with divergent output shapes. | Collapse into one deterministic engine. |
| Python service | See §10 and the removal decision in TARGET_ARCHITECTURE. | Remove in Phase 3. |
| Verbose emoji `console.log`/`console.error` blocks in routes/CLI | Present throughout. | Replace with structured logging. |

---

## 9. Security risks

| ID | Severity | Finding | Location |
|---|---|---|---|
| S-1 | High | Git runner uses `execSync("git " + args.join(" "))` — shell string construction, no argument-array execution, no timeout, only a 10MB buffer cap, no structured errors. Args are currently static so not exploitable *today*, but it violates the "never construct shell strings" rule and is unsafe once any user input reaches it. | `apps/cli/src/utils/exec.ts` |
| S-2 | High | **Broken access control (IDOR).** `GET /api/incident/[id]`, `GET /api/sessions/[id]`, and `POST /api/sessions/[id]/{plan,verify,explain}` perform **no ownership/auth check**. `middleware.ts` explicitly excludes `/api/`. Any caller who knows/guesses a `cuid` can read snapshots, diffs, and reflog of any session, including other users'. | web API routes + `middleware.ts` |
| S-3 | Medium | Committed secrets/placeholders: `ecosystem.config.js` inlines `NEXTAUTH_SECRET: 'change-this-...'` and `DATABASE_URL`. `send.ts` opens a URL via `exec(\`${open} "${url}"\`)` shell string. | `ecosystem.config.js`, `apps/cli/src/commands/send.ts` |
| S-4 | Medium | No data redaction before sending to the LLM — conflict `oursContent`/`theirsContent` (source code) is placed directly into prompts. No secret filtering. | `lib/agent/*`, Python `nodes.py` |
| S-5 | Medium | Snapshots persist `repoRoot` (absolute filesystem path) and full diffs/logs in the DB with no retention or redaction; ingest stores them for anonymous users. | ingest route + Prisma |
| S-6 | Medium | No signature/authentication on ingest — anyone can POST arbitrary snapshots and create sessions (spam/DoS vector). No rate limiting anywhere. | `POST /api/snapshots/ingest` |
| S-7 | Low | Python service `CORSMiddleware` uses `allow_origins=[localhost:3000]` with `allow_credentials=True`, `allow_methods/headers=["*"]`. Fine for dev, not production. | `apps/agent/main.py` |
| S-8 | Low | Verbose logging prints repo paths, branch names, and snapshot sizes to stdout/PM2 logs. | routes + CLI |
| S-9 | Low | `.npmrc` scope/registry mismatch (`@azizbekdevuz` vs `@latchops/*`) — publishing ambiguity. | `.npmrc` |

Auth positives: password hashing with bcrypt (cost 12), user-enumeration-safe failed-login logging, an `AuthenticationLog` audit table, JWT strategy.

---

## 10. `spoon-ai-sdk` / Python service assessment

The Python service uses `spoon-ai-sdk` for exactly three things:
- `ChatBot` — a thin Anthropic wrapper (a `httpx`/`anthropic` call would do the same).
- `StateGraph` — used to build a **strictly linear** 5-node pipeline (`detect_issue → build_graph → extract_conflicts → collect_signals → generate_analysis`). A plain `async` function chain is equivalent.
- `BaseTool` — three deterministic "tools" that are all reimplemented in TypeScript already.

Only one node (`generate_analysis`) does anything an LLM is required for, and that duplicates
`apps/web/src/lib/agent/planner.ts`. The deterministic nodes duplicate the CLI collectors and the TS
collector. **`spoon-ai-sdk` provides no defensible unique value**; the graph abstraction is overhead
for a linear pipeline. See `TARGET_ARCHITECTURE.md` for the explicit removal decision.

---

## 11. Architectural debt (ranked)

1. **LLM is the primary plan authority** (should be deterministic-first). Highest priority.
2. **Triplicated analysis** across Python, `lib/agent`, and `ingest/utils` with divergent output shapes.
3. **Schema fragmentation** — `plan.ts` vs `analysis.ts` define competing `IssueType`/`PlanStep`; DB stores plans as loose JSON blobs.
4. **No isolated domain packages** — git logic lives in the CLI app, analysis lives in the web app; nothing is reusable/testable in isolation. No `state-engine`, `policy-engine`, or `github-app` packages exist.
5. **Single-tenant data model** — no org/membership/repository/incident entities.
6. **Two competing incident UIs** and a dead static result page.
7. **Unsafe/limited process execution** and space/Unicode-fragile parsers.
8. **No tests, no lint, no CI.**
9. **Deploy story is a hand-rolled VPS runbook** (PM2 + systemd + Nginx) rather than reproducible infra.

---

## 12. Product gaps (vs. the brief's first commercial version)

Not started: GitHub App + webhooks; PR risk reports; CI-failure ingestion; policy engine; org/team onboarding; multi-tenant incident rooms; recovery verification as a lifecycle; billing/pilot flow; notifications; audit history as a first-class entity; AI-authorship signals; the expanded incident-type and risk-factor models.

Partially present: local git diagnosis (CLI captures state but the CLI has **no** `diagnose`/`plan`/`verify`/`doctor` commands — only `snapshot`/`send`); recovery plans (exist but LLM-authored); a web incident room (demo-grade, single-tenant, IDOR-exposed).

---

## 13. Test & tooling gaps

- **0 test files.** No unit tests for parsers/collectors (the most testable, correctness-critical code). No temp-repo integration tests. No webhook/DB/authz/e2e tests.
- **No linter** configured; **no CI** pipeline.
- Typecheck is the only automated gate and it passes.

Highest-value first tests (Phase 1): porcelain v2 parser (spaces/Unicode/renames), reflog parser, rebase-state detection, conflict extraction, and classifier — all as pure-function unit tests plus temp-git integration tests.

---

## 14. What to preserve vs. rewrite (summary; decisions justified in TARGET_ARCHITECTURE.md)

**Preserve / evolve:**
- Git collectors & parsers (move into `packages/state-engine`, harden execution + parsing).
- Zod schema discipline (unify the competing schemas).
- CLI snapshot/send flows and stderr/stdout hygiene.
- NextAuth credentials/OAuth flow (harden, add org scoping).
- Prisma + PostgreSQL choice.

**Rewrite / replace:**
- Recovery planner → deterministic templates (LLM only explains).
- `execGit` → `execFile`/`spawn` runner with timeouts + structured errors.
- Analysis: collapse three impls into one deterministic engine.
- DB schema → multi-tenant + real incident lifecycle.
- Incident UI → consolidate to one production-grade room.

**Remove:**
- `apps/agent` + `spoon-ai-sdk` (Phase 3), `lib/api.ts`, `result/page.jsx`, inline secrets, duplicate schema definitions.

---

## 15. Validation log (Phase 0)

- `git version 2.47.0.windows.1`, `node v22.18.0`, `pnpm 9.15.0`.
- `node_modules` present at root and in `apps/web`; `packages/schema/dist` and `apps/cli/dist` present.
- `pnpm -r typecheck` → exit 0 (schema, cli, web all "Done").
- Lint: none configured. Tests: none present. Build: not re-run (dist artifacts already present; not required for the audit).
- No production code modified. Only `docs/architecture/*` created.
