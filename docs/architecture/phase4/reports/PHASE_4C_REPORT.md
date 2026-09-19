# Phase 4C Report — CLI Authentication and Repository Identity (Pending Lifecycle Pass)

> **Subphase:** 4C (Implementation + validation + pending lifecycle correction)
> **Date:** 2026-07-26
> **Status:** Pending lifecycle pass complete — awaiting approval before Phase 4D

---

## 1. Summary

This pass corrects three pending-submission lifecycle issues before Phase 4C approval:

1. **Stale submissions are retained** — age marks entries `stale` but never auto-deletes uncertain payloads.
2. **Storage bounds refuse instead of evict** — when limits are reached, new pending submissions are refused; existing entries are never auto-removed.
3. **Stable repository matching** — pending identity uses `apiOrigin + repositoryFingerprint` (canonical remote + root commit), not `repoRoot` alone.

**Phase 4D has been started separately; this report remains the 4C record.**

---

## 2. Exact-payload retry (unchanged core)

Pending send persists exact serialized request bytes before `fetch`. On uncertain failure the CLI reloads and resends the identical body with the same idempotency key. Bearer tokens are never written to disk.

---

## 3. Stale-state behaviour

| Rule | Behaviour |
|---|---|
| Age threshold | 7 days (`STALE_PENDING_MS`) |
| On read | Entries older than threshold are marked `stale: true` with `staleSince` |
| Deletion | **Never** auto-deleted by age alone |
| Normal `latchops send` | Loads and retries exact pending payload (including stale entries) |
| Stale warning | CLI warns that submission is stale and suggests `--discard-pending` for a new incident |
| Conflict | Creating a **different** payload for the same fingerprint throws `PendingSubmissionExistsError` |
| Removal | Only explicit `--discard-pending`, HTTP 2xx success, or definite non-retryable 4xx |

**Rationale:** Age alone is not proof the server did not commit the incident. Deleting stale pending state risks duplicate incidents.

**Test:** 8-day-old pending submission retains and reuses original payload and key (`pending-send.test.ts`).

---

## 4. No-automatic-eviction rule

Previous behaviour pruned the oldest payload files when count exceeded 10. **Removed.**

### Storage-bound refusal

| Limit | Value |
|---|---|
| Max pending submissions | 10 (`MAX_PENDING_SUBMISSIONS`) |
| Max total payload bytes | 50 MB (`MAX_PENDING_TOTAL_BYTES`) |

When either bound would be exceeded on **new** pending creation:

- Throw `PendingStorageFullError`
- Print safe identifiers only: `displayName`, `apiOrigin`, idempotency key prefix, fingerprint prefix, `createdAt`, stale flag
- **Do not** print snapshot contents
- **Do not** delete any existing entry

**Test:** 11th submission is refused; all 10 existing fingerprints remain on disk (`pending-send.test.ts`).

---

## 5. Stable repository matching

### Primary identity

```text
apiOrigin + repositoryFingerprint
```

`repositoryFingerprint` is computed via shared `@latchops/schema` logic (same as server):

| Case | Fingerprint material |
|---|---|
| Remote present | `remote:<normalized-url>\nroot:<rootCommitOid>` |
| No remote, has commits | `local:<rootCommitOid>\nroot:<rootCommitOid>` |
| Unborn / no root | `local:unborn\nroot:none` |

`repoRoot` is stored for display and legacy v2 fallback lookup only — **not** used as the primary key.

### Minimal pre-capture discovery

`collectRepositoryIdentity()` in `@latchops/state-engine` reads only:

- repository root (via `discoverRepository`)
- remotes (`git remote -v`)
- root commit OID (`git rev-list --max-parents=0 HEAD`)

This runs **before** deciding whether to skip `captureSnapshot()`.

### Edge cases

| Case | Handling |
|---|---|
| Repository path move | Same fingerprint → pending found and exact payload reused |
| No remote | Local root-commit fingerprint |
| Unborn repository | `local:unborn` fingerprint (collisions possible; user must `--discard-pending` to replace) |
| Fingerprint collision | Two distinct repos with identical remote+root are extremely rare; same rules as server dedup |
| Legacy v2 store | Migrated on read; `repoRoot` fallback lookup for older entries |

### Tests (`pending-send.test.ts`)

- Same repository moved to different path → reuses pending
- Same API origin + fingerprint → reuses payload
- Different fingerprints → isolated identities
- Different API origins → isolated identities
- No-remote local fingerprint → works
- Explicit discard after move → new submission identity

---

## 6. Corrected rate-limit keys (prior pass, unchanged)

| Identity | Key |
|---|---|
| Trusted proxy + valid token | `trusted-ip:<ip>:<tokenId>` |
| Untrusted + valid token | `unknown:<tokenId>` |
| Malformed token | `malformed-token:global` |
| Missing bearer | `missing-bearer:global` |

Per-process until Phase 11 (Redis-backed distributed limiting).

---

## 7. Validation commands

| Command | Result |
|---|---|
| `pnpm run lint` | ✅ |
| `pnpm -r typecheck` | ✅ |
| `pnpm -r test` (unit) | ✅ **225 passed** (78 web, 45 state-engine, 73 recovery, 29 cli) |
| `pnpm --filter @latchops/web run test:integration` | ⚠️ Not re-run — Docker/Postgres unavailable on validation host (`localhost:5433` unreachable). Prior pass: 55 passed; no ingest-path logic changed in this pass beyond shared fingerprint extraction. |
| `pnpm run build:cli` | ✅ |
| `pnpm build:web` | ✅ |

**Total unit tests:** **225**  
**Integration tests (prior verified):** **55** → **280** combined when DB available

### New / updated tests (this pass)

| Area | File | Count |
|---|---|---:|
| Pending lifecycle (stale, storage refusal, fingerprint) | `apps/cli/src/send/pending-send.test.ts` | 13 |
| Cross-process retry proof | `apps/cli/src/send/pending-send.cross-process.test.ts` | 4 |
| Shared fingerprint | `apps/web/src/lib/domain/fingerprint.test.ts` | 22 (unchanged, now backed by `@latchops/schema`) |

---

## 8. Key files (pending lifecycle pass)

```
packages/schema/src/fingerprint.ts
packages/state-engine/src/collectors/repository-identity.ts
apps/cli/src/send/pending-send.ts
apps/cli/src/send/pending-send.test.ts
apps/cli/src/commands/send.ts
apps/web/src/lib/domain/fingerprint.ts          # re-exports @latchops/schema
```

---

## 9. Remaining limitations

| Item | Target |
|---|---|
| OS keychain `latchops auth` commands | Future enhancement |
| Redis-backed distributed rate limiting | Phase 11 |
| Per-process rate limiter | Phase 11 |
| `PHASE4_DUAL_WRITE` on CLI ingest path | Phase 4D |
| Unborn-repo fingerprint collisions | Documented; use `--discard-pending` |
| Pending payload may contain sensitive repo data | User-managed `~/.latchops/` |
| Integration tests require Docker Postgres on port 5433 | Local CI setup |

---

## 10. Approval gate

Phase 4D has **not** been started.

```text
Phase 4C approved. Continue with Phase 4D.
```
