import { NextRequest, NextResponse } from 'next/server';
import { authorizeIncidentRef } from '@/lib/authz';
import { getCurrentPlan, regeneratePlan } from '@/lib/domain/plan-service';
import { withDeprecationHeaders } from '@/lib/http/deprecation';
import { DomainError } from '@/lib/domain/errors';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await params;
    const authz = await authorizeIncidentRef(sessionId);
    if (!authz.authorized) return authz.response;

    const plan = await getCurrentPlan(authz.incident.organizationId, authz.incident.id);
    return withDeprecationHeaders(
      NextResponse.json({ incidentType: plan.incidentType, risk: plan.risk, plan }),
      { organizationId: authz.incident.organizationId, incidentId: authz.incident.id },
    );
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching plan:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: sessionId } = await params;
    const authz = await authorizeIncidentRef(sessionId, { minRole: 'member' });
    if (!authz.authorized) return authz.response;

    const record = await regeneratePlan(authz.incident.organizationId, authz.incident.id, authz.userId);
    const { RecoveryPlanV1Schema } = await import('@latchops/schema');
    const plan = RecoveryPlanV1Schema.parse(record.planJson);
    return withDeprecationHeaders(
      NextResponse.json({ success: true, incidentType: record.incidentType, plan }),
      { organizationId: authz.incident.organizationId, incidentId: authz.incident.id },
    );
  } catch (error) {
    if (error instanceof DomainError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error generating plan:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
