# LatchOps Recovery Proof — HackSprint demo

**Nosana explains. Daytona isolates. LatchOps proves.**

Before a recovery plan touches a real repository, LatchOps reproduces a broken Git state in a disposable Daytona sandbox, executes only allowlisted plan steps, and decides **VERIFIED** or **FAILED** with the deterministic engines.

## Required environment variables

Copy `apps/web/.env.example` to `apps/web/.env.local`.

| Variable | Required for live demo? | Purpose |
|---|---|---|
| `DAYTONA_API_KEY` | Yes, to prove Daytona | Creates a real disposable sandbox |
| `NOSANA_API_KEY` | Optional | Human explanation of evidence only |
| `DAYTONA_API_URL` | No | Defaults to Daytona cloud API |
| `DAYTONA_TARGET` | No | Optional region (`us`, `eu`, …) |
| `HACKSPRINT_ISOLATION=local` | Emergency only | Skip Daytona and use a host temp dir (never the LatchOps repo) |

`DATABASE_URL` is **not** required for `/hacksprint`. The proof path does not persist to Postgres.

Never put sponsor keys in client code. They are read only on the server.

## Exact start command

From the repository root (Node 20+, pnpm 9+, Git):

```bash
pnpm install
pnpm --filter @latchops/schema build
pnpm --filter @latchops/state-engine build
pnpm --filter @latchops/recovery-engine build
pnpm dev:web
```

Open **http://localhost:3000/hacksprint** (alias: `/proof`).

## Exact 3-minute demo path

1. Open `/hacksprint`. The **BROKEN** panel already shows `merge_conflict` on `deploy.env` for the fictional checkout-service release and `MERGE_HEAD`.
2. Click **PLAN**. Point at `generatedBy: deterministic_engine` and the recommended **Complete the merge** steps. Those commands came from `@latchops/recovery-engine`, not an LLM.
3. Click **Prove recovery**. If `DAYTONA_API_KEY` is set, the server creates an ephemeral Daytona sandbox, rebuilds the same broken repo **inside the sandbox**, and executes allowlisted recovery there.
4. Click **SANDBOX**. Show the sandbox id and the command table (inspect → demo resolution of the advisory/manual edit → `git add` → `git commit --no-edit`).
5. Click **PROOF**. The stamp is **VERIFIED** only when `verifyRecovery` sees `MERGE_HEAD` gone and zero conflicted paths.
6. Click **EXPLAIN**. If Nosana is up, show the structured explanation and the discovered model id. If not, the page says **Nosana unavailable** — the verdict does not change.

## What proves Daytona is genuinely used

- The Daytona chip says **Daytona live** only after `daytona.create()` returned a sandbox id.
- The SANDBOX / sponsor panel shows that sandbox id.
- Commands ran in the sandbox working directory, not in this monorepo.
- The sandbox is deleted in `finally` and `cleaned up` is shown only after the SDK confirms destruction (`delete(..., true)`). `ephemeral: true`, `autoDeleteInterval: 0`, and a short `ttlMinutes` are additional safety nets.

If the key is missing, or `create()` fails, Daytona is **not** labeled live. The demo falls back to an isolated local temp directory so the rest of the proof still works.

## What proves Nosana is genuinely used

- The Nosana chip says **Nosana live** only after a successful call to `https://inference.nosana.com/v1`.
- The model id is discovered from `GET /models` — it is not hardcoded.
- The EXPLAIN panel attributes the write-up to that model.
- Nosana receives only redacted evidence. It cannot change the verdict or the commands.

## Emergency deterministic fallback (Nosana down)

Leave `NOSANA_API_KEY` unset, or ignore a 5xx from Nosana. Run the same **Prove recovery** path. You still get BROKEN → PLAN → SANDBOX → **VERIFIED/FAILED**. EXPLAIN shows **Nosana unavailable**. Do not pretend Nosana ran.

If Daytona is down at the event: set `HACKSPRINT_ISOLATION=local` in `.env.local` and restart `pnpm dev:web`. Say clearly that isolation is local; do not claim Daytona live.

## Vercel Preview

Vercel Node.js Functions do **not** ship a `git` binary. `/api/hacksprint/preview` therefore serves a labeled built-in fixture on Vercel (`previewSource: built_in_fixture`). It is not a live host capture. **Prove recovery** still creates a real Daytona sandbox, materializes the Git conflict there, verifies deterministically, and cleans up.

Do not set `HACKSPRINT_ISOLATION=local` on Vercel.

### Project settings

| Setting | Value |
|---|---|
| Framework Preset | Next.js |
| Root Directory | `apps/web` |
| Include files outside the Root Directory | On (needed for `packages/*`) |
| Install Command | `cd ../.. && corepack enable && pnpm install --frozen-lockfile` |
| Build Command | `cd ../.. && pnpm run build:vercel` |
| Output Directory | leave default (Next.js) |
| Node.js Version | 20.x |
| Function runtime | Node.js (`export const runtime = 'nodejs'`) |
| Prove `maxDuration` | `180` (Hobby and Pro both allow this; Daytona + Nosana + cleanup needs the headroom) |

`build:vercel` builds `@latchops/schema` → `@latchops/state-engine` → `@latchops/recovery-engine` → `@latchops/web` (`prisma generate` then `next build`). Do not upload local `dist/`, `.next/`, or Prisma client artifacts.

### Environment variables (Preview)

Set these on the Vercel project for Preview. Do not commit values.

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | Yes, for Prisma generate / the rest of the app | PostgreSQL URL. `/hacksprint` does not write to it. |
| `NEXTAUTH_SECRET` | Yes | NextAuth build/runtime |
| `NEXTAUTH_URL` | Yes | The Preview URL, e.g. `https://<deployment>.vercel.app` |
| `LATCHOPS_TOKEN_PEPPER` | Yes in production | Distinct from `NEXTAUTH_SECRET` |
| `DAYTONA_API_KEY` | Yes, to prove Daytona | Real sandbox create/exec/delete |
| `NOSANA_API_KEY` | Optional | Explanation only |
| `HACKSPRINT_DEMO_TOKEN` | Yes on Vercel | Shared judge/operator link token |
| `KV_REST_API_URL` + `KV_REST_API_TOKEN` | Recommended | Durable prove rate limit (Vercel KV or Upstash Redis REST). In-memory counters are not used. |
| `LATCHOPS_TRUST_PROXY` | Yes on Vercel | `true` so per-IP limits see `X-Forwarded-For` |
| `DAYTONA_API_URL` / `DAYTONA_TARGET` | No | Cloud defaults |

No custom domain is required.

### Sharing method

1. Deploy a Preview.
2. Give judges `https://<deployment>.vercel.app/hacksprint?access=<HACKSPRINT_DEMO_TOKEN>`.
3. The page stores the token in `sessionStorage` and sends `x-hacksprint-access` on **Prove recovery**.
4. Optional extra lock: Vercel Deployment Protection password on Preview.

Unauthenticated POST `/api/hacksprint/prove` is rejected when the token is missing. With KV/Upstash configured, each IP is limited to 4 proofs / 15 minutes.

### Deploy steps

```bash
# from the repository root, after `vercel login` and linking this repo
npx vercel
```

Or: Vercel Dashboard → Import Git repository → Root Directory `apps/web` → paste the commands above → Add environment variables → Deploy. Then open `/api/hacksprint/preview` and `/hacksprint?access=<token>`.
