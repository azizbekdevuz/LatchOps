# LatchOps

**Deterministic Git recovery for dangerous repository states**

LatchOps detects dangerous repository states (merge conflicts, detached HEAD, failed rebases, dirty worktrees, in-progress cherry-pick/revert/bisect) and produces **deterministic recovery plans** with explicit undo paths grounded in real `git reflog` history. Analysis is **100% rule-based** — there is no LLM in the recovery path. It is a **local monorepo** today: run everything from this repository with `pnpm`. **`@latchops/cli` is not published to npm yet.**

---

## What it does (30 seconds)

| Piece | Role |
|-------|------|
| **CLI** (`apps/cli`) | Read-only git diagnostics → `SnapshotV1` JSON; `diagnose`/`plan`/`verify`/`doctor`; optional upload to the web API |
| **State engine** (`packages/state-engine`) | Captures git state and classifies it into canonical `RepoSignalsV1` (pure, deterministic) |
| **Recovery engine** (`packages/recovery-engine`) | Generates canonical `RecoveryPlanV1` and runs `verifyRecovery` — no LLM |
| **Schema** (`packages/schema`) | Shared Zod types: `SnapshotV1`, `RepoSignalsV1`, `RecoveryPlanV1`, `VerificationResultV1` |
| **Web** (`apps/web`) | Incident room: diagnosis, recovery tree, verify with a new snapshot |

There is **one** analysis path. Every plan is produced by the deterministic engines and validated against the canonical schema.

---

## Single deterministic path

```text
CLI / Web ingest
  → @latchops/state-engine   (SnapshotV1 → RepoSignalsV1, pure classifier)
  → @latchops/recovery-engine (RepoSignalsV1 → canonical RecoveryPlanV1)
  → deterministic verification (verifyRecovery: before/after signals + plan)
  → (future) natural-language explanation layer — not implemented yet (Phase 8)
```

No Python service, no `spoon-ai-sdk`, no LLM call, and no fabricated analysis are involved.

---

## Local setup

**Requirements:** Node.js 20+, pnpm 9+, Git.

```bash
git clone <your-repo-url>
cd LatchOps
pnpm install
pnpm build
```

Copy the environment template and set `DATABASE_URL`:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Set `DATABASE_URL` in `apps/web/.env.local` (PostgreSQL per `prisma/schema.prisma`) and `NEXTAUTH_SECRET`/`NEXTAUTH_URL` if you use dashboard auth. No API keys are required — analysis is deterministic.

---

## CLI demo (from monorepo)

All CLI commands run via the workspace script—no global npm install required.

```bash
# Build CLI + engines
pnpm build:cli

# From any git repository — read-only diagnostic JSON
pnpm cli snapshot --pretty

# Deterministic diagnosis / plan / verify, all local
pnpm cli diagnose
pnpm cli plan
pnpm cli doctor

# With web running (see below) — capture + open incident room
pnpm cli send --open
```

| `pnpm cli …` | Maps to | Description |
|--------------|---------|-------------|
| `snapshot` | `latchops snapshot` | Emit SnapshotV1 to stdout or `-o file` |
| `diagnose` | `latchops diagnose` | Classify local state into `RepoSignalsV1` |
| `plan` | `latchops plan` | Generate a canonical `RecoveryPlanV1` locally |
| `verify` | `latchops verify` | Verify recovery progress from a saved plan artifact |
| `doctor` | `latchops doctor` | Environment/health checks |
| `send` | `latchops send` | POST to `/api/snapshots/ingest`, print incident URL |

**Environment:** `LATCHOPS_API_URL` (default `http://localhost:3000`)

See [`apps/cli/README.md`](./apps/cli/README.md) for exit codes and full flags.

---

## Web dashboard demo

**Terminal 1 — web app**

```bash
pnpm dev:web
# http://localhost:3000
```

**Terminal 2 — exercise the flow**

```bash
cd /path/to/a/git/repo/with/issues
pnpm cli send --open
```

In the browser:

1. **Dashboard** (`/dashboard`) — sessions list; also an advanced/air-gapped **snapshot import**
2. **Incident room** (`/incident/[id]`) — diagnosis, canonical recovery plan, conflicts, verify, deterministic trace
3. **Recovery proof** (`/hacksprint`) — HackSprint demo: isolated Daytona proof + optional Nosana explanation. See [`HACKSPRINT_DEMO.md`](./HACKSPRINT_DEMO.md).

`pnpm cli send` from your repository is the **primary** workflow. Manual JSON upload on the dashboard is an advanced/air-gapped import path.

---

## Architecture

```
latchops/
├── packages/schema/          # SnapshotV1, RepoSignalsV1, RecoveryPlanV1, VerificationResultV1
├── packages/state-engine/    # capture + pure classifier (SnapshotV1 → RepoSignalsV1)
├── packages/recovery-engine/ # plan generation + verifyRecovery (deterministic)
├── apps/cli/                 # latchops CLI (workspace package @latchops/cli)
└── apps/web/                 # Next.js + Prisma incident room
```

The web app runs the same deterministic engines in-process (see `apps/web/src/lib/recovery/`). It never shells out to git server-side and never calls an external analysis service.

---

## Environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `DATABASE_URL` | `apps/web` | Prisma database URL (PostgreSQL) |
| `NEXTAUTH_URL` / `NEXTAUTH_SECRET` | web | Auth, if enabled |
| `LATCHOPS_API_URL` | CLI | API base for `pnpm cli send` |

See `apps/web/.env.example`.

---

## Deterministic-first design

| Layer | How it works |
|-------|--------------|
| Snapshot schema | Zod validation (`SnapshotV1`) |
| Signal extraction | Rules over status/reflog/conflicts → `RepoSignalsV1` |
| Classification | Rule-based canonical incident type (`RepoStateV1`) |
| Plan structure | Deterministic templates → canonical `RecoveryPlanV1` with typed commands, risk, undo |
| Verification | `verifyRecovery`: before/after signal diff against the selected plan |

A natural-language explanation layer (Anthropic) is planned for **Phase 8** and is intentionally not implemented yet.

---

## Scenarios (local testing)

- [Merge conflict](./demos/merge-conflict/README.md)
- [Detached HEAD / rebase](./demos/detached-head/README.md)

---

## Deployment

See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for VPS setup (Nginx + PM2). Secrets are provided via environment variables only. Replace placeholder domains and secrets with your own values.

---

## Roadmap (not shipped yet)

- npm publish for `@latchops/cli` and `@latchops/schema`
- Natural-language explanation layer (Phase 8)
- CI/CD failure ingestion
- Git hosting integrations
- IDE extensions

---

## Security and privacy

- CLI snapshot/send is **read-only** on the repository
- Snapshots stay on infrastructure you control
- LatchOps is **not** secret scanning or credential detection
- Core analysis is fully local and deterministic. The optional HackSprint Nosana explanation (`/hacksprint`) sends only bounded, redacted recovery evidence when `NOSANA_API_KEY` is configured; it never authors commands or the verdict.

## License

MIT
