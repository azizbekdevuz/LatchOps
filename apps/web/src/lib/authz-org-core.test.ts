import { describe, expect, it } from 'vitest';
import { decideOrganizationAccess, statusForOrgDecision } from './authz-org-core';

describe('authz-org-core', () => {
  it('returns unauthenticated without user', () => {
    expect(decideOrganizationAccess({ authenticatedUserId: null, membership: null, organization: null }).kind).toBe(
      'unauthenticated',
    );
  });

  it('returns not_found for cross-tenant membership miss', () => {
    expect(
      decideOrganizationAccess({
        authenticatedUserId: 'u1',
        membership: null,
        organization: { status: 'active' },
      }).kind,
    ).toBe('not_found');
  });

  it('returns forbidden for viewer write action', () => {
    const decision = decideOrganizationAccess({
      authenticatedUserId: 'u1',
      membership: { role: 'viewer' },
      organization: { status: 'active' },
      minRole: 'member',
    });
    expect(decision.kind).toBe('forbidden');
    if (decision.kind !== 'ok') {
      expect(statusForOrgDecision(decision)).toBe(403);
    }
  });

  it('blocks writes to archived org', () => {
    const decision = decideOrganizationAccess({
      authenticatedUserId: 'u1',
      membership: { role: 'owner' },
      organization: { status: 'archived' },
      requireWritable: true,
    });
    expect(decision.kind).toBe('org_archived');
  });

  it('allows owner access', () => {
    const decision = decideOrganizationAccess({
      authenticatedUserId: 'u1',
      membership: { role: 'owner' },
      organization: { status: 'active' },
      minRole: 'admin',
    });
    expect(decision).toEqual({ kind: 'ok', role: 'owner' });
  });
});
