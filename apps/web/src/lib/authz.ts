import { NextResponse } from 'next/server';
import { auth } from './auth';
import { requireIncidentAccess, AuthzError } from './authz-org';
import { resolveIncidentRecord } from './domain/incident-service';
import type { MembershipRole } from '@latchops/schema';

/**
 * Organization-scoped access for compatibility routes.
 * Authenticates first, then resolves Incident.id or legacyGitSessionId.
 */
export async function authorizeIncidentRef(
  ref: string,
  options: { minRole?: MembershipRole } = {},
) {
  const session = await auth();
  if (!session?.user?.id) {
    return {
      authorized: false as const,
      response: NextResponse.json({ error: 'Authentication required' }, { status: 401 }),
    };
  }

  try {
    const incident = await resolveIncidentRecord(ref);
    if (!incident) {
      return {
        authorized: false as const,
        response: NextResponse.json({ error: 'Incident not found' }, { status: 404 }),
      };
    }
    const ctx = await requireIncidentAccess(incident.id, options);
    return { authorized: true as const, ...ctx, incident };
  } catch (error) {
    if (error instanceof AuthzError) {
      return {
        authorized: false as const,
        response: NextResponse.json({ error: error.message }, { status: error.status }),
      };
    }
    throw error;
  }
}
