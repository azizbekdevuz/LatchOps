import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { assertDemoAccess, assertProveRateLimit, DemoAccessError, readPresentedAccess } from '@/lib/hacksprint/access';
import { runProof } from '@/lib/hacksprint/proof';
import { DEMO_SCENARIO_ID } from '@/lib/hacksprint/types';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 180;

const BodySchema = z
  .object({
    scenarioId: z.literal(DEMO_SCENARIO_ID).optional(),
  })
  .strict();

export async function POST(request: NextRequest) {
  try {
    assertDemoAccess(readPresentedAccess(request));
    await assertProveRateLimit(request);
  } catch (error) {
    if (error instanceof DemoAccessError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }

  let json: unknown = {};
  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('application/json')) {
    try {
      json = await request.json();
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    }
  }

  const parsed = BodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Only the built-in merge_conflict_demo scenario is allowed' },
      { status: 400 },
    );
  }

  try {
    const result = await runProof({ scenarioId: parsed.data.scenarioId });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Proof failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
