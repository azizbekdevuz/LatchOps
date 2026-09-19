import type { SnapshotV1 } from '@latchops/schema';

const FULL_OID = /^[0-9a-f]{40}$/i;
const SHORT_OID = /^[0-9a-f]{7,40}$/i;

/** A ref that looks like a local branch name (not a hash, tag, or remote). */
function looksLikeLocalBranch(ref: string): boolean {
  if (!ref) return false;
  if (ref === 'HEAD') return false;
  if (FULL_OID.test(ref)) return false;
  if (ref.startsWith('tag:')) return false;
  // Heuristic: treat `remote/branch` forms as remote-tracking, not local.
  const knownRemotePrefixes = ['origin/', 'upstream/'];
  if (knownRemotePrefixes.some((p) => ref.startsWith(p))) return false;
  return true;
}

export interface DetachedAnalysis {
  currentOid: string;
  /** Branch the user was on immediately before detaching, if determinable. */
  previousBranch: string | null;
  /** Local branch names observed in recent log decorations. */
  candidateBranches: string[];
  /** A safe, concrete rescue branch name derived from the real HEAD oid. */
  rescueBranch: string;
  /**
   * True when a single safe destination branch can be chosen deterministically;
   * false means the plan must ask for manual review rather than guess.
   */
  hasConfidentTarget: boolean;
  target: string | null;
}

/**
 * Analyze a detached-HEAD snapshot to select concrete refs from real data.
 * Never invents `<branch-name>` placeholders for the confident path.
 */
export function analyzeDetached(snapshot: SnapshotV1): DetachedAnalysis {
  const currentOid = snapshot.branch.oid;
  const previousBranch = findPreviousBranch(snapshot, currentOid);
  const candidateBranches = collectCandidateBranches(snapshot);

  // Prefer the branch we just left; otherwise, only auto-select when exactly one
  // local branch candidate exists. Anything ambiguous requires manual review.
  let target: string | null = null;
  if (previousBranch && looksLikeLocalBranch(previousBranch)) {
    target = previousBranch;
  } else if (candidateBranches.length === 1) {
    target = candidateBranches[0];
  }

  return {
    currentOid,
    previousBranch,
    candidateBranches,
    rescueBranch: rescueBranchName(currentOid),
    hasConfidentTarget: target !== null,
    target,
  };
}

/** Deterministic, collision-resistant rescue branch name from the real oid. */
export function rescueBranchName(oid: string): string {
  const short = oid && SHORT_OID.test(oid) ? oid.slice(0, 12) : 'work';
  return `latchops/rescue-${short}`;
}

function findPreviousBranch(snapshot: SnapshotV1, currentOid: string): string | null {
  // The act of detaching produces a reflog entry:
  //   checkout: moving from <branch> to <oid>
  // Scan most-recent-first for the first checkout whose destination matches the
  // current detached oid; its source is the branch we left.
  for (const entry of snapshot.recentReflog) {
    if (entry.action !== 'checkout') continue;
    const m = entry.message.match(/moving from (.+?) to (.+)$/);
    if (!m) continue;
    const from = m[1].trim();
    const to = m[2].trim();
    if (matchesOid(to, currentOid) && looksLikeLocalBranch(from)) {
      return from;
    }
  }
  // Fallback: the most recent checkout's source, if it is a branch.
  for (const entry of snapshot.recentReflog) {
    if (entry.action !== 'checkout') continue;
    const m = entry.message.match(/moving from (.+?) to (.+)$/);
    if (m && looksLikeLocalBranch(m[1].trim())) {
      return m[1].trim();
    }
  }
  return null;
}

function collectCandidateBranches(snapshot: SnapshotV1): string[] {
  const branches = new Set<string>();
  for (const entry of snapshot.recentLog) {
    for (const ref of entry.refs) {
      const cleaned = ref.replace(/^tag:\s*/, '').trim();
      if (looksLikeLocalBranch(cleaned)) {
        branches.add(cleaned);
      }
    }
  }
  return [...branches];
}

function matchesOid(candidate: string, oid: string): boolean {
  if (!candidate || !oid) return false;
  if (!SHORT_OID.test(candidate)) return false;
  const a = candidate.toLowerCase();
  const b = oid.toLowerCase();
  return b.startsWith(a) || a.startsWith(b);
}
