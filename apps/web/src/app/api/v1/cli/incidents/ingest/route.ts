import { NextRequest, NextResponse } from 'next/server';
import { domainErrorToHttp, handleCanonicalCliIngest } from '@/lib/cli-ingest-handler';

/**
 * POST /api/v1/cli/incidents/ingest
 * Organization-scoped CLI ingest with bearer token + idempotency.
 */
export async function POST(request: NextRequest) {
  try {
    const result = await handleCanonicalCliIngest(request);
    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    const mapped = domainErrorToHttp(error);
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status });
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: { code: 'BAD_REQUEST', message } }, { status: 400 });
  }
}
