/**
 * Pure authorization decision logic for the interim ownership guard.
 *
 * This is deliberately dependency-free (no next-auth, no Prisma, no
 * NextResponse) so it can be unit-tested in isolation and reused by the async
 * wrapper in `authz.ts`.
 *
 * INTERIM GUARD (Phase 1, Amendment A): enforces that a git session may only be
 * read/acted upon by the authenticated user who owns it. Anonymous sessions
 * (`userId === null`) are therefore not accessible through the protected
 * per-session/incident routes. Phase 4 replaces this with organization-scoped
 * authorization; do not build the organization model here.
 */

export type SessionAccessDecision =
  | { kind: 'ok' }
  /** No authenticated user — respond 401. */
  | { kind: 'unauthenticated' }
  /**
   * Either the session does not exist, or it exists but is not owned by the
   * authenticated user. Both collapse to 404 so we never disclose the
   * existence of another user's session.
   */
  | { kind: 'not_found' };

export function decideSessionAccess(
  authenticatedUserId: string | null | undefined,
  session: { userId: string | null } | null | undefined,
): SessionAccessDecision {
  if (!authenticatedUserId) {
    return { kind: 'unauthenticated' };
  }
  if (!session) {
    return { kind: 'not_found' };
  }
  if (session.userId !== authenticatedUserId) {
    return { kind: 'not_found' };
  }
  return { kind: 'ok' };
}

/** HTTP status for a decision. */
export function statusForDecision(decision: SessionAccessDecision): number {
  switch (decision.kind) {
    case 'ok':
      return 200;
    case 'unauthenticated':
      return 401;
    case 'not_found':
      return 404;
  }
}

/** Error message body for a non-ok decision. */
export function messageForDecision(decision: Exclude<SessionAccessDecision, { kind: 'ok' }>): string {
  return decision.kind === 'unauthenticated' ? 'Authentication required' : 'Session not found';
}
