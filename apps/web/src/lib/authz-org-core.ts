import { hasMinRole, type MembershipRole } from '@latchops/schema';

export type OrgAccessDecision =
  | { kind: 'ok'; role: MembershipRole }
  | { kind: 'unauthenticated' }
  | { kind: 'not_found' }
  | { kind: 'forbidden' }
  | { kind: 'org_archived' };

export function decideOrganizationAccess(params: {
  authenticatedUserId: string | null | undefined;
  membership: { role: MembershipRole } | null | undefined;
  organization: { status: 'active' | 'archived' } | null | undefined;
  minRole?: MembershipRole;
  requireWritable?: boolean;
}): OrgAccessDecision {
  if (!params.authenticatedUserId) return { kind: 'unauthenticated' };
  if (!params.organization || !params.membership) return { kind: 'not_found' };
  if (params.requireWritable && params.organization.status === 'archived') {
    return { kind: 'org_archived' };
  }
  if (params.minRole && !hasMinRole(params.membership.role, params.minRole)) {
    return { kind: 'forbidden' };
  }
  return { kind: 'ok', role: params.membership.role };
}

export function statusForOrgDecision(decision: Exclude<OrgAccessDecision, { kind: 'ok' }>): number {
  switch (decision.kind) {
    case 'unauthenticated':
      return 401;
    case 'not_found':
      return 404;
    case 'forbidden':
    case 'org_archived':
      return 403;
  }
}

export function messageForOrgDecision(decision: Exclude<OrgAccessDecision, { kind: 'ok' }>): string {
  switch (decision.kind) {
    case 'unauthenticated':
      return 'Authentication required';
    case 'not_found':
      return 'Organization not found';
    case 'forbidden':
      return 'Insufficient permissions';
    case 'org_archived':
      return 'Organization is archived';
  }
}
