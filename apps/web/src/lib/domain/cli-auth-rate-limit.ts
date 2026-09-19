import { TOKEN_RE } from './cli-credential-service';

export type AuthRateLimitIdentity =
  | { kind: 'trusted-ip'; ip: string; tokenId: string }
  | { kind: 'unknown-token'; tokenId: string }
  | { kind: 'malformed-token' }
  | { kind: 'missing-bearer' };

export function extractTokenIdFromBearer(bearer: string | null): string | null {
  if (!bearer) return null;
  const match = TOKEN_RE.exec(bearer);
  return match?.[1] ?? null;
}

export function buildAuthRateLimitKey(identity: AuthRateLimitIdentity): string {
  switch (identity.kind) {
    case 'trusted-ip':
      return `trusted-ip:${identity.ip}:${identity.tokenId}`;
    case 'unknown-token':
      return `unknown:${identity.tokenId}`;
    case 'malformed-token':
      return 'malformed-token:global';
    case 'missing-bearer':
      return 'missing-bearer:global';
  }
}

export function resolveAuthRateLimitIdentity(params: {
  bearer: string | null;
  ip: string;
  trustProxy: boolean;
}): AuthRateLimitIdentity {
  if (!params.bearer) return { kind: 'missing-bearer' };
  const tokenId = extractTokenIdFromBearer(params.bearer);
  if (!tokenId) return { kind: 'malformed-token' };
  if (params.trustProxy && params.ip !== 'unknown') {
    return { kind: 'trusted-ip', ip: params.ip, tokenId };
  }
  return { kind: 'unknown-token', tokenId };
}

const WINDOW_MS = 60_000;
const MAX_FAILURES = 10;

const failures = new Map<string, { count: number; windowStart: number }>();

export function recordFailedAuth(limitKey: string): boolean {
  const now = Date.now();
  const entry = failures.get(limitKey);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    failures.set(limitKey, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_FAILURES;
}

export function resetFailedAuth(limitKey: string): void {
  failures.delete(limitKey);
}

export function clearRateLimitState(): void {
  failures.clear();
}

export function getFailedAuthCount(limitKey: string): number {
  return failures.get(limitKey)?.count ?? 0;
}
