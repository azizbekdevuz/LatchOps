import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/lib/auth';
import { allowAnonymousLegacyIngest } from '@/lib/cli-auth';
import { domainErrorToHttp, handleCanonicalCliIngest } from '@/lib/cli-ingest-handler';
import { readBoundedBody, parseBoundedJson, InvalidJsonBodyError } from '@/lib/http/bounded-body';
import { MAX_CLI_INGEST_BYTES } from '@/lib/cli-auth';
import { ingestSnapshot } from '@/lib/recovery/pipeline';

/**
 * POST /api/snapshots/ingest
 *
 * Legacy entry point. Production rejects anonymous ingest (fail-closed even if
 * LATCHOPS_ALLOW_ANONYMOUS_INGEST=true). Authenticated requests delegate to the
 * shared canonical CLI ingest handler.
 */
export async function POST(request: NextRequest) {
  try {
    const bearer = request.headers.get('authorization');
    if (bearer) {
      const result = await handleCanonicalCliIngest(request);
      const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || 'http://localhost:3000';
      return NextResponse.json(
        {
          sessionId: (result.body.legacySessionId as string | undefined) ?? result.body.incidentId,
          incidentId: result.body.incidentId,
          url: result.body.url ?? `${baseUrl}/incident/${result.body.incidentId}`,
          analysis: result.body.analysis,
          idempotency: result.body.idempotency,
        },
        { status: result.status },
      );
    }

    if (!allowAnonymousLegacyIngest()) {
      return NextResponse.json(
        {
          error:
            'Anonymous ingest is disabled. Set LATCHOPS_API_TOKEN and use latchops send, or enable LATCHOPS_ALLOW_ANONYMOUS_INGEST in local dev.',
        },
        { status: process.env.NODE_ENV === 'production' ? 410 : 401 },
      );
    }

    const { raw } = await readBoundedBody(request, MAX_CLI_INGEST_BYTES);
    let body: { snapshot?: unknown };
    try {
      body = parseBoundedJson<{ snapshot?: unknown }>(raw);
    } catch (error) {
      if (error instanceof InvalidJsonBodyError) {
        return NextResponse.json({ error: error.message }, { status: 400 });
      }
      throw error;
    }

    const session = await auth();
    const userId = session?.user?.id ?? null;
    const result = await ingestSnapshot({ rawSnapshot: body?.snapshot, userId });
    const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || 'http://localhost:3000';

    return NextResponse.json({
      sessionId: result.sessionId,
      url: `${baseUrl}/incident/${result.sessionId}`,
      analysis: {
        incidentType: result.incidentType,
        summary: result.summary,
        risk: result.risk,
      },
    });
  } catch (error) {
    const mapped = domainErrorToHttp(error);
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status });
    const message = error instanceof Error ? error.message : 'Unknown error';
    const status =
      error && typeof error === 'object' && 'status' in error
        ? (error as { status: number }).status
        : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
