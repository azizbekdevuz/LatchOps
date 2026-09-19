import { NextRequest, NextResponse } from 'next/server';
import { authorizeIncidentRef } from '@/lib/authz';
import { withDeprecationHeaders } from '@/lib/http/deprecation';
import { loadIncidentPayload } from '@/lib/recovery/incident';
import { deterministicExplanation } from '@/lib/recovery/explain';
import { analyzeSnapshot, parseSnapshot } from '@/lib/recovery/pipeline';
import prisma from '@/lib/prisma';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await params;
    const authz = await authorizeIncidentRef(sessionId);
    if (!authz.authorized) return authz.response;

    const payload = await loadIncidentPayload(authz.incident.id);
    let signals = payload?.signals ?? null;
    let plan = payload?.plan ?? null;

    if (!signals || !plan) {
      const snapshotRecord = await prisma.snapshot.findFirst({
        where: { incidentId: authz.incident.id },
        orderBy: { createdAt: 'desc' },
      });
      if (!snapshotRecord) {
        return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
      }
      const computed = analyzeSnapshot(parseSnapshot(snapshotRecord.snapshotJson));
      signals = computed.signals;
      plan = computed.plan;
    }

    return withDeprecationHeaders(
      NextResponse.json({
        explanation: deterministicExplanation(signals, plan),
        note: 'Deterministic summary. A natural-language explanation layer is not configured (planned for Phase 8).',
      }),
      { organizationId: authz.incident.organizationId, incidentId: authz.incident.id },
    );
  } catch (error) {
    console.error('Error explaining:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
