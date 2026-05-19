# LatchOps

**AI agent safety layer for Git recovery and DevOps resilience**

LatchOps detects dangerous repository states (merge conflicts, detached HEAD, failed rebases, risky AI-generated commits) and produces **deterministic recovery plans** with explicit undo paths via `git reflog`. It is a **local monorepo** today: run everything from this repository with `pnpm`. **`@latchops/cli` is not published to npm yet.**

---

## What it does (30 seconds)

| Piece | Role |
|-------|------|
| **CLI** (`apps/cli`) | Read-only git diagnostics → `SnapshotV1` JSON; optional upload to the web API |
| **Web** (`apps/web`) | Incident room: diagnosis, recovery tree, verify with a new snapshot |
| **Schema** (`packages/schema`) | Shared Zod types for snapshots, signals, and plans |
| **Agent** (`apps/agent`, optional) | Python analysis service on port 8000; web falls back to TypeScript if unavailable |

Deterministic rules and schemas run first; LLMs only fill structured plan/explanation fields when `ANTHROPIC_API_KEY` is set.

---

## Local setup

**Requirements:** Node.js 20+, pnpm 9+, Git. Optional: Python 3.11+ for `apps/agent`.

```bash
git clone <your-repo-url>
cd LatchOps
pnpm install
pnpm build
```

Copy environment templates:

```bash
cp apps/web/.env.example apps/web/.env.local
# Optional agent:
cp apps/agent/.env.example apps/agent/.env
```

Set `DATABASE_URL` in `apps/web/.env.local` (PostgreSQL per `prisma/schema.prisma`, or adjust schema for SQLite locally). Set `ANTHROPIC_API_KEY` only if you want LLM-assisted plans (otherwise mocks are used).

---

## CLI demo (from monorepo)

All CLI commands run via the workspace script—no global npm install required.

```bash
# Build CLI + schema
pnpm build:cli

# From any git repository — read-only diagnostic JSON
pnpm cli snapshot --pretty

# With web running (see below) — capture + open incident room
pnpm cli send --open
```

| `pnpm cli …` | Maps to | Description |
|--------------|---------|-------------|
| `snapshot` | `latchops snapshot` | Emit SnapshotV1 to stdout or `-o file` |
| `send` | `latchops send` | POST to `/api/snapshots/ingest`, print incident URL |

**Environment:** `LATCHOPS_API_URL` (default `http://localhost:3000`)

After a future npm release, a global `latchops` binary may be published as `@latchops/cli`; until then, use `pnpm cli` from this repo.

---

## Web dashboard demo

**Terminal 1 — web app**

```bash
pnpm dev:web
# http://localhost:3000
```

**Terminal 2 — optional Python agent**

```bash
cd apps/agent
python -m venv venv
# Windows: venv\Scripts\activate
# macOS/Linux: source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python main.py
# http://localhost:8000/health
```

Set `AGENT_URL=http://localhost:8000` in `apps/web/.env.local` if the agent is running.

**Terminal 3 — exercise the flow**

```bash
cd /path/to/a/git/repo/with/issues
pnpm cli send --open
```

In the browser:

1. **Dashboard** (`/dashboard`) — sessions list  
2. **Incident room** (`/incident/[id]`) — diagnosis, recovery plan, verify  
3. **Session** (`/session/[id]`) — recovery pipeline trace  

Manual JSON upload is supported for offline snapshots; `pnpm cli send` is the primary path.

---

## Architecture

```
latchops/
├── packages/schema/     # SnapshotV1, PlanV1, Signals
├── apps/cli/            # latchops CLI (workspace package @latchops/cli)
├── apps/web/            # Next.js + Prisma
└── apps/agent/          # Optional FastAPI analysis service
```

**TypeScript pipeline (default):** collector → classifier → planner → verifier  

**Optional:** web calls `AGENT_URL/analyze` when the Python service is up.

---

## Environment variables

| Variable | Where | Purpose |
|----------|-------|---------|
| `DATABASE_URL` | `apps/web` | Prisma database URL |
| `ANTHROPIC_API_KEY` | web / agent | LLM-backed planner (optional) |
| `AGENT_URL` | web | Python service (default `http://localhost:8000`) |
| `NEXTAUTH_URL` / `NEXTAUTH_SECRET` | web | Auth, if enabled |
| `LATCHOPS_API_URL` | CLI | API base for `pnpm cli send` |

See `apps/web/.env.example` and `apps/agent/.env.example`.

---

## Deterministic-first design

| Layer | Deterministic | LLM role |
|-------|---------------|----------|
| Snapshot schema | Zod validation | — |
| Signal extraction | Rules on status, reflog, conflicts | — |
| Classification | Rule-based + schema | Optional tie-break |
| Plan structure | Fixed step/undo schema | Wording suggestions |
| Verification | Signal diff vs plan | Progress narrative |

---

## Scenarios (local testing)

- [Merge conflict](./demos/merge-conflict/README.md)  
- [Detached HEAD / rebase](./demos/detached-head/README.md)  

---

## Deployment

See [DEPLOYMENT_GUIDE.md](./DEPLOYMENT_GUIDE.md) for VPS setup (Nginx, PM2, optional systemd agent). Replace placeholder domains and secrets with your own values.

Optional agent details: [AGENT_SERVICE_GUIDE.md](./AGENT_SERVICE_GUIDE.md).

---

## Roadmap (not shipped yet)

- npm publish for `@latchops/cli` and `@latchops/schema`  
- CI/CD failure ingestion  
- Git hosting integrations  
- IDE extensions  

---

## Security and privacy

- CLI snapshot/send is **read-only** on the repository  
- Snapshots stay on infrastructure you control  
- LatchOps is **not** secret scanning or credential detection  
- LLM providers receive snapshot excerpts only when keys are configured  

## License

MIT
