# LatchOps CLI (`@latchops/cli`)

Workspace package for read-only Git diagnostics and incident upload. **Not published to npm**—use the monorepo commands below.

## Run from monorepo (recommended)

```bash
# From repository root
pnpm install
pnpm build:cli

# Read-only SnapshotV1 JSON
pnpm cli snapshot --pretty
pnpm cli snapshot -o diagnostics.json

# Upload to local web (start pnpm dev:web first)
pnpm cli send
pnpm cli send --open
pnpm cli send -u http://localhost:3000
```

The root `package.json` script `"cli": "pnpm --filter @latchops/cli --"` forwards arguments to the built CLI (`latchops` binary inside the package).

## Commands

| Command | Description |
|---------|-------------|
| `snapshot` | Capture repository state as SnapshotV1 JSON |
| `send` | Capture + POST to `/api/snapshots/ingest`; prints incident room URL |

### Options

**snapshot**

- `-o, --output <file>` — write JSON to file instead of stdout  
- `--pretty` — formatted JSON  

**send**

- `-u, --api-url <url>` — API base (default `http://localhost:3000`)  
- `-o, --open` — open incident URL in browser  

**Environment:** `LATCHOPS_API_URL` overrides the default API URL.

## Direct binary (after build)

```bash
node apps/cli/dist/index.js snapshot --pretty
# or, when linked in development:
pnpm --filter @latchops/cli exec latchops --help
```

## Related workspace package

- `@latchops/schema` — shared Zod schemas (SnapshotV1, PlanV1, Signals)

## Future publishing

A public `npm install -g @latchops/cli` release is planned but **not available yet**. Track the root [README](../../README.md) for updates.
