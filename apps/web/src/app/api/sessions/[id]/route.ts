import { NextRequest, NextResponse } from 'next/server';
import { authorizeIncidentRef } from '@/lib/authz';
import { withDeprecationHeaders } from '@/lib/http/deprecation';
import { loadIncidentPayload } from '@/lib/recovery/incident';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await params;
    const authz = await authorizeIncidentRef(sessionId);
    if (!authz.authorized) return authz.response;

    const payload = await loadIncidentPayload(authz.incident.id);
    if (!payload) {
      return NextResponse.json({ error: 'Incident not found' }, { status: 404 });
    }

    return withDeprecationHeaders(NextResponse.json(payload), {
      organizationId: authz.incident.organizationId,
      incidentId: authz.incident.id,
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
