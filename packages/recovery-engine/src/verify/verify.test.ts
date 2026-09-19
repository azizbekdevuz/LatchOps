import { describe, expect, it } from 'vitest';
import type { RepoSignalsV1 } from '@latchops/schema';
import { generateRecoveryPlan } from '../plan/index.js';
import { verifyRecovery } from './index.js';
import { makeSignals, makeSnapshot } from '../test-support/fixtures.js';

const NOW = { now: new Date('2026-01-01T00:00:00.000Z') };
const OID = 'abc1234def5678901234567890123456789012ab';

function planFor(signals: RepoSignalsV1, snapshot = makeSnapshot()) {
  return generateRecoveryPlan({ snapshot, signals }, NOW);
}

describe('verifyRecovery — clean', () => {
  const before = makeSignals();
  const plan = planFor(before);

  it('succeeds when the repo stays clean', () => {
    const r = verifyRecovery({ incidentType: 'clean', before, after: makeSignals(), plan, now: NOW.now });
    expect(r.status).toBe('succeeded');
  });

  it('fails when the repo is no longer clean', () => {
    const after = makeSignals({
      state: 'dirty_worktree',
      worktree: { staged: 1, modified: 0, untracked: 0, conflicted: 0, conflictedPaths: [], isDirty: true },
    });
    const r = verifyRecovery({ incidentType: 'clean', before, after, plan, now: NOW.now });
    expect(r.status).toBe('failed');
  });
});

describe('verifyRecovery — merge conflict', () => {
  const before = makeSignals({
    state: 'merge_conflict',
    operations: { merge: true, rebase: false, rebaseType: 'none', cherryPick: false, revert: false, bisect: false },
    worktree: { staged: 0, modified: 0, untracked: 0, conflicted: 2, conflictedPaths: ['a', 'b'], isDirty: true },
  });
  const plan = planFor(before, makeSnapshot({ mergeHead: 'deadbeef' }));

  it('not_started when nothing changed', () => {
    const r = verifyRecovery({ incidentType: 'merge_conflict', before, after: before, plan, now: NOW.now });
    expect(r.status).toBe('not_started');
  });

  it('in_progress when conflicts partially resolved but merge still active', () => {
    const after = makeSignals({
      state: 'merge_conflict',
      operations: { merge: true, rebase: false, rebaseType: 'none', cherryPick: false, revert: false, bisect: false },
      worktree: { staged: 1, modified: 0, untracked: 0, conflicted: 1, conflictedPaths: ['b'], isDirty: true },
    });
    const r = verifyRecovery({ incidentType: 'merge_conflict', before, after, plan, now: NOW.now });
    expect(r.status).toBe('in_progress');
  });

  it('succeeded when MERGE_HEAD removed and no unmerged paths remain', () => {
    const after = makeSignals();
    const r = verifyRecovery({
      incidentType: 'merge_conflict',
      before,
      after,
      plan,
      selectedAlternativeId: 'abort_merge',
      now: NOW.now,
    });
    expect(r.status).toBe('succeeded');
    expect(r.changedSignals.some((c) => c.field === 'operations.merge')).toBe(true);
  });
});

describe('verifyRecovery — detached HEAD', () => {
  const before = makeSignals({
    state: 'detached_head',
    branch: { name: null, oid: OID, upstream: null, ahead: 0, behind: 0, isDetached: true, isUnborn: false },
  });
  const plan = planFor(before, makeSnapshot({ branch: { head: '(detached)', oid: OID } }));

  it('succeeds when HEAD is reattached, surfacing reachability as a follow-up', () => {
    const after = makeSignals({
      branch: { name: 'feature', oid: OID, upstream: null, ahead: 0, behind: 0, isDetached: false, isUnborn: false },
    });
    const r = verifyRecovery({ incidentType: 'detached_head', before, after, plan, now: NOW.now });
    expect(r.status).toBe('succeeded');
    expect(r.remainingIssues.join(' ')).toMatch(/reachable/i);
  });

  it('not_started when still detached and nothing changed', () => {
    const r = verifyRecovery({ incidentType: 'detached_head', before, after: before, plan, now: NOW.now });
    expect(r.status).toBe('not_started');
  });
});

describe('verifyRecovery — rebase', () => {
  const before = makeSignals({
    state: 'rebase_in_progress',
    operations: { merge: false, rebase: true, rebaseType: 'merge', cherryPick: false, revert: false, bisect: false },
  });
  const plan = planFor(before, makeSnapshot({ rebaseState: { inProgress: true, type: 'merge' } }));

  it('succeeds when rebase metadata is gone', () => {
    const after = makeSignals();
    const r = verifyRecovery({ incidentType: 'rebase_in_progress', before, after, plan, now: NOW.now });
    expect(r.status).toBe('succeeded');
  });

  it('in_progress while rebase is still active but signals changed', () => {
    const after = makeSignals({
      state: 'rebase_in_progress',
      operations: { merge: false, rebase: true, rebaseType: 'merge', cherryPick: false, revert: false, bisect: false },
      worktree: { staged: 1, modified: 0, untracked: 0, conflicted: 0, conflictedPaths: [], isDirty: true },
    });
    const r = verifyRecovery({ incidentType: 'rebase_in_progress', before, after, plan, now: NOW.now });
    expect(r.status).toBe('in_progress');
  });
});

describe('verifyRecovery — dirty worktree', () => {
  const before = makeSignals({
    state: 'dirty_worktree',
    worktree: { staged: 0, modified: 2, untracked: 1, conflicted: 0, conflictedPaths: [], isDirty: true },
  });
  const plan = planFor(before);

  it('succeeds when the working tree becomes clean (stash/commit)', () => {
    const r = verifyRecovery({
      incidentType: 'dirty_worktree',
      before,
      after: makeSignals(),
      plan,
      selectedAlternativeId: 'stash',
      now: NOW.now,
    });
    expect(r.status).toBe('succeeded');
  });

  it('manual_review for patch/review alternatives (evidence is off-signal)', () => {
    const after = makeSignals({
      state: 'dirty_worktree',
      worktree: { staged: 0, modified: 1, untracked: 0, conflicted: 0, conflictedPaths: [], isDirty: true },
    });
    const r = verifyRecovery({
      incidentType: 'dirty_worktree',
      before,
      after,
      plan,
      selectedAlternativeId: 'patch',
      now: NOW.now,
    });
    expect(r.status).toBe('manual_review');
  });
});

describe('verifyRecovery — unknown', () => {
  const before = makeSignals({ state: 'unknown', reasons: ['weird'] });
  const plan = planFor(before);
  it('always requires manual review', () => {
    const r = verifyRecovery({ incidentType: 'unknown', before, after: makeSignals(), plan, now: NOW.now });
    expect(r.status).toBe('manual_review');
  });
});
