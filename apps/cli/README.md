# LatchOps CLI (`@latchops/cli`)

Workspace package for read-only Git diagnostics and deterministic recovery. Diagnosis, planning, and verification all run **locally and deterministically** (`@latchops/state-engine` + `@latchops/recovery-engine`) — no network call and no LLM are required. **Not published to npm**—use the monorepo commands below.

## Run from monorepo (recommended)

```bash
# From repository root
pnpm install
pnpm build:cli

# Read-only SnapshotV1 JSON
pnpm cli snapshot --pretty
pnpm cli snapshot -o diagnostics.json

# Deterministic diagnosis / plan / verify, all local
pnpm cli diagnose --json
pnpm cli plan --output plan.json
pnpm cli verify --plan plan.json
pnpm cli doctor

# Upload to local web (start pnpm dev:web first; requires API token)
export LATCHOPS_API_TOKEN=lops_live_<tokenId>.<secret>   # from dashboard → Organization → CLI credentials
pnpm cli send
pnpm cli send --open
pnpm cli send -u http://localhost:3000
```

### CLI authentication (Phase 4C)

`latchops send` posts to `POST /api/v1/cli/incidents/ingest` with a bearer token. Tokens are created in the web dashboard (admin+) and shown **once** at creation.

| Variable | Purpose |
|---|---|
| `LATCHOPS_API_TOKEN` | Bearer token (`lops_live_<16-char-id>.<43-char-secret>`) |
| `LATCHOPS_API_URL` | API base URL (default `http://localhost:3000`) |

`latchops doctor` checks token presence and format. Missing/invalid token exits with code **2** on `send`.

### Retry-safe idempotency (client state)

`latchops send` persists a **pending-send record** before upload so retries after network failures reuse the same `Idempotency-Key`:

| Platform | State directory |
|---|---|
| Linux / macOS | `~/.latchops/pending-sends.json` |
| Windows | `%LOCALAPPDATA%\LatchOps\pending-sends.json` |

- Keys are reused when the **request body hash** and **API origin** match a pending entry.
- Pending records are cleared on definite success (2xx) or non-retryable errors (400/401/403/413/409).
- Uncertain failures (timeouts, 5xx) retain the key for safe retry.
- Entries older than **7 days** are pruned on read.
- Files are written with mode `0600`; directories `0700` where supported.
- Bearer tokens are **never** stored in the state file.
- Override for CI: `latchops send --idempotency-key <key>`

The root `package.json` script `"cli": "pnpm --filter @latchops/cli --"` forwards arguments to the built CLI (`latchops` binary inside the package).

## Commands

| Command | Description |
|---------|-------------|
| `snapshot` | Capture repository state as `SnapshotV1` JSON |
| `diagnose` | Capture state and print the deterministic classification (`RepoSignalsV1`) |
| `plan` | Generate a deterministic, advisory `RecoveryPlanV1` (never executes commands) |
| `verify` | Verify recovery progress against a previously saved plan artifact |
| `doctor` | Check the local environment (git, repository, read-only commands, runtime) |
| `send` | Capture + POST to `/api/v1/cli/incidents/ingest` (requires `LATCHOPS_API_TOKEN`) |

### Options

**snapshot**

- `-o, --output <file>` — write JSON to file instead of stdout
- `--pretty` — formatted JSON

**diagnose**

- `--json` — output signals as JSON

**plan**

- `--json` — output the plan artifact as JSON
- `-o, --output <file>` — write the plan artifact to a file for later verification
- `-a, --alternative <id>` — select a specific alternative path where applicable

**verify**

- `-p, --plan <file>` — path to a plan artifact produced by `latchops plan --output`
- `--json` — output the verification result as JSON

**doctor**

- `--json` — output the checks as JSON
- `-u, --api-url <url>` — validate an API URL format (optional)
- `--check-api` — also check API reachability (requires `--api-url`)

**send**

- `-u, --api-url <url>` — API base (default `http://localhost:3000`)
- `-o, --open` — open incident URL in browser

**Environment:** `LATCHOPS_API_URL` overrides the default API URL.

Exit codes are stable and documented in `apps/cli/src/exit-codes.ts` (`0` success/clean, `1` runtime error, `2` usage error, `3` not a repo / git missing, `4` issues found, `5` verification incomplete).

## Direct binary (after build)

```bash
node apps/cli/dist/index.js snapshot --pretty
# or, when linked in development:
pnpm --filter @latchops/cli exec latchops --help
```

## Related workspace packages

- `@latchops/schema` — shared Zod schemas (`SnapshotV1`, `RepoSignalsV1`, `RecoveryPlanV1`, `VerificationResultV1`)
- `@latchops/state-engine` — capture + pure classifier
- `@latchops/recovery-engine` — deterministic plan generation + verification

## Future publishing

A public `npm install -g @latchops/cli` release is planned but **not available yet**. Track the root [README](../../README.md) for updates.
