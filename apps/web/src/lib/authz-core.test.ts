import { describe, expect, it } from 'vitest';
import {
  decideSessionAccess,
  messageForDecision,
  statusForDecision,
  type SessionAccessDecision,
} from './authz-core';

describe('decideSessionAccess (interim ownership guard)', () => {
  it('rejects an unauthenticated request with 401', () => {
    const decision = decideSessionAccess(null, { userId: 'user-1' });
    expect(decision.kind).toBe('unauthenticated');
    expect(statusForDecision(decision)).toBe(401);
  });

  it('rejects when there is no authenticated user id (undefined)', () => {
    expect(decideSessionAccess(undefined, { userId: 'user-1' }).kind).toBe('unauthenticated');
  });

  it('returns 404 for a nonexistent session (not 403, to avoid leaking existence)', () => {
    const decision = decideSessionAccess('user-1', null);
    expect(decision.kind).toBe('not_found');
    expect(statusForDecision(decision)).toBe(404);
  });

  it('returns 404 when the session belongs to a different user', () => {
    const decision = decideSessionAccess('user-1', { userId: 'user-2' });
    expect(decision.kind).toBe('not_found');
    expect(statusForDecision(decision)).toBe(404);
  });

  it('returns 404 for an anonymous (unowned) session even when authenticated', () => {
    // Anonymous sessions (userId === null) are inaccessible via protected routes
    // under the interim guard.
    const decision = decideSessionAccess('user-1', { userId: null });
    expect(decision.kind).toBe('not_found');
  });

  it('authorizes the owning user', () => {
    const decision = decideSessionAccess('user-1', { userId: 'user-1' });
    expect(decision.kind).toBe('ok');
    expect(statusForDecision(decision)).toBe(200);
  });

  it('maps non-ok decisions to stable error messages', () => {
    const unauth: SessionAccessDecision = { kind: 'unauthenticated' };
    const missing: SessionAccessDecision = { kind: 'not_found' };
    expect(messageForDecision(unauth)).toBe('Authentication required');
    expect(messageForDecision(missing)).toBe('Session not found');
  });
});
