import { timingSafeEqual } from 'node:crypto';
import type { ActorRole, ReviewActor } from './types';

interface ActorEntry extends ReviewActor {
  token: string;
}

/**
 * Local-only identities. Override with REVIEW_ACTORS (JSON array of
 * {id,name,role,token}). The defaults are demo identities and are labelled as
 * such in the UI; they are not a production authentication system.
 */
const DEMO_ACTORS: ActorEntry[] = [
  { id: 'minji', name: 'Minji (requester, demo)', role: 'requester', token: 'demo-requester-token' },
  { id: 'jun', name: 'Jun (approver, demo)', role: 'approver', token: 'demo-approver-token' },
  { id: 'seo', name: 'Seo (viewer, demo)', role: 'viewer', token: 'demo-viewer-token' },
];

const ROLES: ActorRole[] = ['viewer', 'requester', 'approver'];

export function loadActors(): ActorEntry[] {
  const raw = process.env.REVIEW_ACTORS?.trim();
  if (!raw) return DEMO_ACTORS;
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) throw new Error('REVIEW_ACTORS must be a JSON array');
  return parsed.map((entry) => {
    const e = entry as Partial<ActorEntry>;
    if (!e.id || !e.name || !e.token || !e.role || !ROLES.includes(e.role)) {
      throw new Error('Each REVIEW_ACTORS entry needs id, name, token and a valid role');
    }
    return { id: e.id, name: e.name, role: e.role, token: e.token };
  });
}

export function usingDemoActors(): boolean {
  return !process.env.REVIEW_ACTORS?.trim();
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function actorFromToken(token: string | null | undefined): ReviewActor | null {
  if (!token) return null;
  const match = loadActors().find((actor) => safeEqual(actor.token, token));
  return match ? { id: match.id, name: match.name, role: match.role } : null;
}

/** Public list for the actor switcher. Tokens are included only for demo actors. */
export function publicActors(): Array<ReviewActor & { demoToken?: string }> {
  const demo = usingDemoActors();
  return loadActors().map((actor) => ({
    id: actor.id,
    name: actor.name,
    role: actor.role,
    ...(demo ? { demoToken: actor.token } : {}),
  }));
}
