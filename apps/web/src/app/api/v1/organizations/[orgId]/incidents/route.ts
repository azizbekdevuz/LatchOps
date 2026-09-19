import { NextResponse } from 'next/server';
import { AuthzError, requireOrganizationMember } from '@/lib/authz-org';
import { isDomainError } from '@/lib/domain/errors';
import { listIncidents } from '@/lib/domain/incident-service';

function errorResponse(error: unknown) {
  if (error instanceof AuthzError || isDomainError(error)) {
    const status = error instanceof AuthzError ? error.status : error.status;
    const code = error instanceof AuthzError ? 'AUTHZ' : error.code;
    return NextResponse.json({ error: { code, message: error.message } }, { status });
  }
  console.error(error);
  return NextResponse.json({ error: { code: 'INTERNAL', message: 'Internal server error' } }, { status: 500 });
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ orgId: string }> },
) {
  try {
    const { orgId } = await context.params;
    await requireOrganizationMember(orgId, { minRole: 'member' });
    const incidents = await listIncidents(orgId);
    return NextResponse.json({
      incidents: incidents.map((i) => ({
        id: i.id,
        title: i.title,
        status: i.status,
        incidentType: i.incidentType,
        risk: i.risk,
        summary: i.summary,
        repository: {
          id: i.repository.id,
          displayName: i.repository.displayName,
          primaryRemote: i.repository.primaryRemote,
        },
        createdAt: i.createdAt.toISOString(),
      })),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
