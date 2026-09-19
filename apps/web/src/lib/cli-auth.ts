import { NextRequest } from 'next/server';
import { resolveClientIp } from '@/lib/client-ip';
import {
  buildAuthRateLimitKey,
  recordFailedAuth,
  resolveAuthRateLimitIdentity,
} from '@/lib/domain/cli-auth-rate-limit';
import {
  parseBearerToken,
  requireScope,
  verifyCliToken,
  type CliAuthContext,
} from '@/lib/domain/cli-credential-service';
import { DomainError } from '@/lib/domain/errors';

function trustProxyEnabled(): boolean {
  return process.env.LATCHOPS_TRUST_PROXY === 'true';
}

export async function authenticateCliRequest(
  request: NextRequest,
  requiredScope = 'ingest:write',
): Promise<CliAuthContext> {
  const ip = resolveClientIp(request.headers);
  const bearer = parseBearerToken(request.headers.get('authorization'));
  const trustProxy = trustProxyEnabled();

  if (!bearer) {
    const limitKey = buildAuthRateLimitKey(resolveAuthRateLimitIdentity({ bearer, ip, trustProxy }));
    if (recordFailedAuth(limitKey)) {
      throw new DomainError('RATE_LIMITED', 'Too many failed authentication attempts', 429);
    }
    throw new DomainError('UNAUTHORIZED', 'Bearer token required', 401);
  }

  const failureIdentity = resolveAuthRateLimitIdentity({ bearer, ip, trustProxy });
  if (failureIdentity.kind === 'malformed-token') {
    const limitKey = buildAuthRateLimitKey(failureIdentity);
    if (recordFailedAuth(limitKey)) {
      throw new DomainError('RATE_LIMITED', 'Too many failed authentication attempts', 429);
    }
    throw new DomainError('UNAUTHORIZED', 'Invalid or expired token', 401);
  }

  const ctx = await verifyCliToken(bearer);
  if (!ctx) {
    const limitKey = buildAuthRateLimitKey(failureIdentity);
    if (recordFailedAuth(limitKey)) {
      throw new DomainError('RATE_LIMITED', 'Too many failed authentication attempts', 429);
    }
    throw new DomainError('UNAUTHORIZED', 'Invalid or expired token', 401);
  }

  requireScope(ctx, requiredScope);
  return ctx;
}

export function allowAnonymousLegacyIngest(): boolean {
  if (process.env.NODE_ENV === 'production') return false;
  return process.env.LATCHOPS_ALLOW_ANONYMOUS_INGEST === 'true';
}

export const MAX_CLI_INGEST_BYTES = 5 * 1024 * 1024;
