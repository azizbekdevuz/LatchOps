import { NextRequest, NextResponse } from 'next/server';
import { authorizeIncidentRef } from '@/lib/authz';
import { DomainError } from '@/lib/domain/errors';
import { verifyIncident } from '@/lib/domain/verification-service';
import { withDeprecationHeaders } from '@/lib/http/deprecation';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await params;
    const authz = await authorizeIncidentRef(sessionId, { minRole: 'member' });
    if (!authz.authorized) return authz.response;

    const body = await request.json();
    const result = await verifyIncident({
      organizationId: authz.incident.organizationId,
      incidentId: authz.incident.id,
      rawSnapshot: body?.snapshot,
      selectedAlternativeId: body?.selectedAlternativeId ?? null,
      actorUserId: authz.userId,
    });

    return withDeprecationHeaders(NextResponse.json(result), {
      organizationId: authz.incident.organizationId,
      incidentId: authz.incident.id,
    });
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error verifying progress:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
