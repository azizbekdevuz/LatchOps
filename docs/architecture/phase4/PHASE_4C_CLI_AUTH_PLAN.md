# Phase 4C — CLI Authentication and Repository Identity Plan

> **Prerequisite:** Phase 4B approved.
> **Scope:** Organization-scoped CLI credentials, authenticated ingest, repository fingerprint in production path, anonymous local mode flag.

---

## 1. Objective

Replace permanent anonymous SaaS ingest with organization-scoped CLI bearer tokens and canonical `POST /api/cli/incidents/ingest`.

---

## 2. CliCredential Implementation

### 2.1 Model

See `PHASE_4A_DESIGN.md` §4.10. **Deferred to Phase 4C schema migration** (Option B — see Phase 4B report §CliCredential). Implemented and activated in 4C; not present in the Phase 4B expand migration.

Key fields:
- `tokenId String @unique` — dedicated lookup key (≥96 bits entropy)
- `tokenHash String` — HMAC-SHA256 hex of the **complete** token string
- `createdById String?` — `onDelete: SetNull` (credential survives for audit)

### 2.2 Token generation

```typescript
// apps/web/src/lib/domain/cli-credential-service.ts

const PREFIX = 'lops_live_';
const TOKEN_ID_BYTES = 12;   // 96 bits
const SECRET_BYTES = 32;     // 256 bits

function generateToken(): { plaintext: string; tokenId: string; hash: string } {
  const tokenId = randomBytes(TOKEN_ID_BYTES).toString('base64url'); // exactly 16 chars
  const secret = randomBytes(SECRET_BYTES).toString('base64url');    // exactly 43 chars
  const plaintext = `${PREFIX}${tokenId}.${secret}`;
  const hash = hmacToken(plaintext);
  return { plaintext, tokenId, hash };
}

function getTokenPepper(): string {
  const pepper = process.env.LATCHOPS_TOKEN_PEPPER;
  if (process.env.NODE_ENV === 'production' && !pepper) {
    throw new Error('LATCHOPS_TOKEN_PEPPER is required in production');
  }
  return pepper ?? process.env.NEXTAUTH_SECRET!; // dev fallback only
}

function hmacToken(plaintext: string): string {
  return createHmac('sha256', getTokenPepper()).update(plaintext).digest('hex');
}
```

**Example token (shown once):**

```text
lops_live_k7mNpQxR2vLwY9zA.xK9mP2nQ7vR4wL8jH3fG6dS1aZ5cV0bN8yT2uI5oP7qW3eR6tY9uI0oP
```

### 2.3 Verification

```typescript
const TOKEN_RE = /^lops_live_([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/;
const DUMMY_HASH = '...'; // fixed HMAC sentinel; same length as real tokenHash

async function verifyCliToken(bearer: string): Promise<CliAuthContext | null> {
  const match = TOKEN_RE.exec(bearer);
  if (!match) return null;
  const tokenId = match[1];

  const cred = await prisma.cliCredential.findUnique({ where: { tokenId } });
  const active = cred && !cred.revokedAt && (!cred.expiresAt || cred.expiresAt > new Date());

  const presented = hmacToken(bearer);
  const stored = active ? cred!.tokenHash : DUMMY_HASH;
  if (!timingSafeEqual(Buffer.from(presented), Buffer.from(stored))) {
    return null;
  }
  if (!active) return null;

  return { organizationId: cred!.organizationId, credentialId: cred!.id, scopes: cred!.scopes };
}
```

**Parsing rules:** Reject tokens where `tokenId` ≠ 16 chars or `secret` ≠ 43 chars. Direct lookup by `tokenId`. Constant-time hash comparison including dummy compare on unknown `tokenId`.

### 2.4 Management API

| Route | Action |
|---|---|
| `POST /api/v1/organizations/[orgId]/cli-credentials` | Create (returns plaintext once) |
| `GET /api/v1/organizations/[orgId]/cli-credentials` | List (`tokenId` only for identification, no hash) |
| `DELETE /api/v1/organizations/[orgId]/cli-credentials/[id]` | Revoke |

**Create response (201):**

```typescript
{
  id: string;
  name: string;
  token: string;        // plaintext — shown ONCE
  tokenId: string;      // for future identification in list
  scopes: string[];
  expiresAt: string | null;
  createdAt: string;
}
```

**List response (no plaintext, no hash):**

```typescript
{
  credentials: Array<{
    id: string;
    name: string;
    tokenId: string;    // NOT the secret portion
    scopes: string[];
    lastUsedAt: string | null;
    expiresAt: string | null;
    revokedAt: string | null;
    createdAt: string;
  }>;
}
```

**Auth:** admin+ only. Archived org → 403.

**Transactional create/revoke:** Credential insert/revoke + authoritative `AuditEvent` in the same transaction. Audit failure rolls back the mutation.

### 2.5 Security requirements

- Never log bearer token or `Authorization` header.
- `LATCHOPS_TOKEN_PEPPER` required in production; startup fails closed if absent.
- `lastUsedAt` updated debounced (max once per 60s per credential) via telemetry tier.
- Rate limit failed verifications: 10/min per IP (in-memory Map, Phase 11 replaces with Redis).
- Constant-time comparison on hash.
- Scopes enforced: `ingest:write` required for ingest.

---

## 3. CLI Storage

### 3.1 Primary: environment variable

```bash
export LATCHOPS_API_TOKEN=lops_live_k7mNpQxR2vLwY9zA.xK9mP2nQ7vR4wL8jH3fG6dS1aZ5cV0bN...
latchops send
```

CLI reads `process.env.LATCHOPS_API_TOKEN` in `send.ts`.

### 3.2 Optional: `latchops auth` commands

Implement **only if** secure cross-platform storage is available:

| Command | Behavior |
|---|---|
| `latchops auth login` | Prompt for token; store in OS keychain/credential manager |
| `latchops auth status` | Show org name (from token introspection endpoint) without revealing token |
| `latchops auth logout` | Delete stored credential |

**Windows:** `keytar` or `@napi-rs/keyring` (evaluate in 4C; defer if dependency risk).

**Fallback:** env var only. Do not store plaintext in `~/.latchops/config.json`.

### 3.3 Token resolution order

```
1. --token flag (explicit, not persisted)
2. LATCHOPS_API_TOKEN env var
3. OS credential store (if auth login used)
```

---

## 4. Canonical Ingest Route

### 4.1 `POST /api/v1/cli/incidents/ingest`

**Auth:** `Authorization: Bearer <token>` (required in production).

**Headers:**

```
Authorization: Bearer lops_live_k7mNpQxR2vLwY9zA.xK9mP2nQ7vR4wL8jH3fG6dS1aZ5cV0bN...
Idempotency-Key: <uuid>          # required
Content-Type: application/json
X-LatchOps-CLI-Version: 1.0.0
```

**Request:**

```typescript
{
  snapshot: SnapshotV1;
  clientRequestId?: string;
  metadata?: { hostname?: string; ci?: { provider?: string; runId?: string } };
}
```

**Response `201` / `200` (replay):**

```typescript
{
  incidentId: string;
  repositoryId: string;
  organizationId: string;
  lifecycleStatus: IncidentStatus;
  url: string;
  analysis: { incidentType: string; summary: string; risk: string };
  idempotency: { key: string; replayed: boolean };
  legacySessionId?: string;  // during migration only
}
```

### 4.2 Ingest flow

```
1. verifyCliToken → organizationId (NEVER from body)
2. assertOrgWritable(organizationId)
3. Validate Idempotency-Key header present
4. parseSnapshot(body.snapshot)
5. Check idempotency record (orgId + key + requestHash)
6. repositoryService.upsertRepository(orgId, snapshot)
7. incidentService.ingest({ orgId, repositoryId, snapshot, source: 'cli' })
   — single transaction including authoritative audit + idempotency record
8. Return response (include legacySessionId if dual-write active)
```

### 4.3 Idempotency

See `PHASE_4A_DESIGN.md` §4.11. `IdempotencyRecord.incidentId` has a real FK to `Incident`. Same key + same body hash → replay existing incident (HTTP 200). Same key + different body → 409.

### 4.4 Request size limit

Max body: **5 MB**. Reject with `413 PAYLOAD_TOO_LARGE`.

---

## 5. Anonymous Local Mode

### 5.1 Configuration

```bash
# apps/web/.env.local (development only)
LATCHOPS_ALLOW_ANONYMOUS_INGEST=true
LATCHOPS_TOKEN_PEPPER=dev-only-pepper-change-me   # optional in dev
```

Default: `LATCHOPS_ALLOW_ANONYMOUS_INGEST=false`. Enforced in production (`NODE_ENV=production` ignores anonymous flag; pepper required).

### 5.2 Behavior

| Mode | `/api/snapshots/ingest` | `/api/v1/cli/incidents/ingest` |
|---|---|---|
| Production (default) | **410 Gone** or delegate requiring token | Bearer required |
| Local dev + flag | Legacy anonymous allowed | Bearer required (use test token) |
| Local dev, no flag | 401 | 401 |

**Rationale:** CLI ingest always uses token path even in dev (forces correct integration). Legacy web anonymous only for dashboard testing.

---

## 6. Legacy Route Changes

### 6.1 `POST /api/snapshots/ingest`

Phase 4C options (pick one in implementation):

**Option A (recommended):** Return `410 Gone` with migration message in production.

**Option B:** Delegate to v1 ingest if valid bearer present; else 401.

Update `apps/cli/src/commands/send.ts`:

- Send `Authorization: Bearer $LATCHOPS_API_TOKEN`
- Send `Idempotency-Key: cli-${uuid}`
- Target `/api/v1/cli/incidents/ingest`
- Handle `200` replayed responses
- Clear error on `401` with setup instructions

---

## 7. Repository Identity (Production Path)

### 7.1 State engine capture

Add collectors (Phase 4B prerequisite):

- `git remote -v` → `remotes[]`
- `git rev-list --max-parents=0 HEAD` → `rootCommitOid`

### 7.2 Fingerprint in ingest

`repositoryService.upsertRepository(orgId, snapshot)`:

1. `computeFingerprint(snapshot)` — pure function with test vectors
2. `upsert` on `(organizationId, fingerprint)`
3. Update `lastSeenAt`, `displayName`, `primaryRemote`

### 7.3 List payload redaction

Repository list responses **omit** absolute paths. Include: `id`, `fingerprint`, `displayName`, `primaryRemote`, `missingRemote`, `lastSeenAt`, `incidentCount`.

---

## 8. Required Tests

| Test | File |
|---|---|
| Valid token ingest | `cli-ingest.test.ts` |
| Invalid/malformed token | `cli-credential-service.test.ts` |
| Malformed token (wrong lengths) | `cli-credential-service.test.ts` |
| Unknown tokenId dummy HMAC timing | `cli-credential-service.test.ts` |
| Valid tokenId, wrong secret | `cli-credential-service.test.ts` |
| Expired token | `cli-credential-service.test.ts` |
| Revoked token | `cli-credential-service.test.ts` |
| Hash-only persistence (no plaintext in DB) | `cli-credential-service.test.ts` |
| tokenId stored with unique constraint | `cli-credential-service.test.ts` |
| Token shown only once on create | `cli-credential-service.test.ts` |
| Token never in logs | manual + log assertion test |
| Production startup without pepper | `cli-credential-service.test.ts` → fails closed |
| Wrong org cannot be chosen via body | `cli-ingest.test.ts` |
| Anonymous denied by default | `cli-ingest.test.ts` |
| `LATCHOPS_ALLOW_ANONYMOUS_INGEST=true` works locally | `cli-ingest.test.ts` |
| Idempotency replay | `idempotency.test.ts` |
| Idempotency conflict (same key, different body) | `idempotency.test.ts` |
| Oversized request rejection | `cli-ingest.test.ts` |
| Remote URL normalization | `fingerprint.test.ts` |
| Credential stripping in URL | `fingerprint.test.ts` |
| No-remote repository | `fingerprint.test.ts` |
| Rate limit on failed auth | `cli-credential-service.test.ts` |
| Create/revoke audit transactional | `cli-credential-service.test.ts` |
| createdBy SetNull on user delete | `cli-credential-service.test.ts` |

---

## 9. CLI Changes

### 9.1 `send.ts`

```typescript
const token = process.env.LATCHOPS_API_TOKEN;
if (!token) {
  console.error('LATCHOPS_API_TOKEN is required. Create a token in the dashboard or run: latchops auth login');
  process.exit(2);
}

const idempotencyKey = `cli-${randomUUID()}`;
const response = await fetch(`${apiUrl}/api/v1/cli/incidents/ingest`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'Idempotency-Key': idempotencyKey,
    'X-LatchOps-CLI-Version': '1.0.0',
  },
  body: JSON.stringify({ snapshot }),
});
```

### 9.2 `doctor.ts`

Add check: `LATCHOPS_API_TOKEN` present and format valid (`/^lops_live_[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]{43}$/`).

### 9.3 Exit codes

| Code | Meaning |
|---|---|
| 0 | Success |
| 1 | Runtime error |
| 2 | Missing/invalid token |
| 3 | Not a git repo |
| 4 | Issues found (diagnose) |
| 5 | Verification incomplete |

---

## 10. Documentation Updates (4C)

- `apps/cli/README.md` — token setup, env var, auth commands, token format
- `apps/web/.env.example` — `LATCHOPS_ALLOW_ANONYMOUS_INGEST`, `LATCHOPS_TOKEN_PEPPER` (required in prod)
- `DEPLOYMENT_GUIDE.md` — token creation, pepper requirement, no anonymous prod ingest
- Root `README.md` — CLI auth prerequisite

---

## 11. Validation (Phase 4C exit criteria)

Full validation suite plus live CLI smoke:

```bash
# With valid token
latchops send

# With invalid token (expect exit 2 or API 401)
LATCHOPS_API_TOKEN=invalid latchops send

# Anonymous default rejection
curl -X POST http://localhost:3000/api/snapshots/ingest -d '{}'  # expect 401/410
```

---

## 12. Approval Gate

```text
Phase 4C approved. Continue with Phase 4D.
```
