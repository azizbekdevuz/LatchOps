import { auth } from './auth';
import {
  decideOrganizationAccess,
  messageForOrgDecision,
  statusForOrgDecision,
} from './authz-org-core';
import { DomainError } from './domain/errors';
import { getMembership } from './domain/organization-service';
import prisma from './prisma';
import type { MembershipRole } from '@latchops/schema';

export class AuthzError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function currentUserId(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id) throw new AuthzError(401, 'Authentication required');
  return session.user.id;
}

export async function requireOrganizationMember(
  organizationId: string,
  options: { minRole?: MembershipRole } = {},
) {
  const userId = await currentUserId();
  const [organization, membership] = await Promise.all([
    prisma.organization.findUnique({ where: { id: organizationId } }),
    getMembership(organizationId, userId),
  ]);

  const decision = decideOrganizationAccess({
    authenticatedUserId: userId,
    organization,
    membership,
    minRole: options.minRole,
  });
  if (decision.kind !== 'ok') {
    throw new AuthzError(statusForOrgDecision(decision), messageForOrgDecision(decision));
  }
  return { userId, role: decision.role, organization: organization! };
}

export async function requireOrganizationRole(organizationId: string, roles: MembershipRole[]) {
  const ctx = await requireOrganizationMember(organizationId);
  if (!roles.includes(ctx.role)) {
    throw new AuthzError(403, 'Insufficient permissions');
  }
  return ctx;
}

export async function requireIncidentAccess(
  incidentId: string,
  options: { minRole?: MembershipRole } = {},
) {
  const incident = await prisma.incident.findUnique({ where: { id: incidentId } });
  if (!incident) throw new AuthzError(404, 'Incident not found');
  const ctx = await requireOrganizationMember(incident.organizationId, options);
  return { ...ctx, incident };
}

export async function assertOrgWritableAuthz(organizationId: string) {
  const ctx = await requireOrganizationMember(organizationId);
  const decision = decideOrganizationAccess({
    authenticatedUserId: ctx.userId,
    organization: ctx.organization,
    membership: { role: ctx.role },
    requireWritable: true,
  });
  if (decision.kind !== 'ok') {
    throw new AuthzError(statusForOrgDecision(decision), messageForOrgDecision(decision));
  }
  return ctx;
}

export function toDomainError(error: unknown): DomainError | null {
  if (error instanceof AuthzError) {
    return new DomainError('AUTHZ', error.message, error.status);
  }
  return null;
}
