import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import * as ingestModule from '@/lib/domain/cli-ingest-service';
import { MAX_CLI_INGEST_BYTES } from './cli-auth';
import { disconnectTestPrisma, requireTestDatabaseUrl, resetTestDatabase } from './test-support/test-db';

const describeDb = process.env.TEST_DATABASE_URL ? describe : describe.skip;

function postRequest(body: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost/api/v1/cli/incidents/ingest', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer lops_live_aaaaaaaaaaaaaaaa.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      'idempotency-key': 'test-key',
      ...headers,
    },
    body,
    duplex: 'half',
  } as unknown as ConstructorParameters<typeof NextRequest>[1]);
}

describeDb('cli ingest handler body limits', () => {
  beforeAll(() => {
    requireTestDatabaseUrl();
  });

  beforeEach(async () => {
    await resetTestDatabase();
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await disconnectTestPrisma();
  });

  it('returns 413 without calling ingestCliIncident when body exceeds cap', async () => {
    const spy = vi.spyOn(ingestModule, 'ingestCliIncident');
    const { handleCanonicalCliIngest } = await import('./cli-ingest-handler');
    const oversized = 'x'.repeat(MAX_CLI_INGEST_BYTES + 1);
    const result = await handleCanonicalCliIngest(postRequest(oversized));
    expect(result.status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns 413 for oversized Content-Length without ingest', async () => {
    const spy = vi.spyOn(ingestModule, 'ingestCliIncident');
    const { handleCanonicalCliIngest } = await import('./cli-ingest-handler');
    const result = await handleCanonicalCliIngest(
      postRequest('{}', { 'content-length': String(MAX_CLI_INGEST_BYTES + 1) }),
    );
    expect(result.status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
  });
});
