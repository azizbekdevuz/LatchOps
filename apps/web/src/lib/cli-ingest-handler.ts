import type { NextRequest } from 'next/server';
import { authenticateCliRequest, MAX_CLI_INGEST_BYTES } from '@/lib/cli-auth';
import { ingestCliIncident } from '@/lib/domain/cli-ingest-service';
import { DomainError } from '@/lib/domain/errors';
import { InvalidJsonBodyError, readBoundedBody, parseBoundedJson } from '@/lib/http/bounded-body';

export interface CliIngestHttpResult {
  status: number;
  body: Record<string, unknown>;
}

/**
 * Shared canonical CLI ingest handler used by v1 and authenticated legacy routes.
 * Body is read with a byte cap before auth side-effects that depend on successful parse.
 */
export async function handleCanonicalCliIngest(
  request: NextRequest,
  options?: { idempotencyKey?: string | null },
): Promise<CliIngestHttpResult> {
  try {
    const { raw } = await readBoundedBody(request, MAX_CLI_INGEST_BYTES);
    const auth = await authenticateCliRequest(request);

    const idempotencyKey =
      options?.idempotencyKey?.trim() ?? request.headers.get('idempotency-key')?.trim();
    if (!idempotencyKey) {
      return {
        status: 400,
        body: {
          error: { code: 'MISSING_IDEMPOTENCY_KEY', message: 'Idempotency-Key header is required' },
        },
      };
    }

    let body: { snapshot?: unknown };
    try {
      body = parseBoundedJson<{ snapshot?: unknown }>(raw);
    } catch (error) {
      if (error instanceof InvalidJsonBodyError) {
        return { status: 400, body: { error: { code: error.code, message: error.message } } };
      }
      throw error;
    }

    const result = await ingestCliIncident({
      auth,
      rawSnapshot: body?.snapshot,
      idempotencyKey,
      requestBodyForHash: body,
    });

    const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || 'http://localhost:3000';

    return {
      status: result.replayed ? 200 : 201,
      body: {
        incidentId: result.incidentId,
        repositoryId: result.repositoryId,
        organizationId: result.organizationId,
        lifecycleStatus: result.lifecycleStatus,
        url: `${baseUrl}/incident/${result.incidentId}`,
        analysis: {
          incidentType: result.incidentType,
          summary: result.summary,
          risk: result.risk,
        },
        idempotency: { key: idempotencyKey, replayed: result.replayed },
        legacySessionId: result.legacySessionId ?? undefined,
      },
    };
  } catch (error) {
    const mapped = domainErrorToHttp(error);
    if (mapped) return mapped;
    throw error;
  }
}

export function domainErrorToHttp(error: unknown): CliIngestHttpResult | null {
  if (error instanceof DomainError) {
    return {
      status: error.status,
      body: { error: { code: error.code, message: error.message } },
    };
  }
  return null;
}
