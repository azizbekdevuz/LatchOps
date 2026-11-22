import { describe, expect, it } from 'vitest';
import { generateRecoveryPlan } from '@latchops/recovery-engine';
import { computeRepoSignals } from '@latchops/state-engine';
import type { RecoveryPlanV1 } from '@latchops/schema';
import { builtInBrokenSnapshot } from '@/lib/isolation/demo-scenario';
import { APPROVAL_TTL_MS, authorizeExecution, canApprove, isDeniedCommand, type AuthorizationInput, type DecisionLike } from './authorize';
import { planFingerprint } from './evidence';
import type { ReviewActor } from './types';

const snapshot = builtInBrokenSnapshot();
const signals = computeRepoSignals(snapshot);
const plan = generateRecoveryPlan({ snapshot, signals });
const planHash = planFingerprint(plan);
const now = new Date('2026-11-19T12:00:00Z');

const requester: ReviewActor = { id: 'minji', name: 'Minji', role: 'requester' };
const approver: ReviewActor = { id: 'jun', name: 'Jun', role: 'approver' };
const viewer: ReviewActor = { id: 'seo', name: 'Seo', role: 'viewer' };

function approval(over: Partial<DecisionLike> = {}): DecisionLike {
  return {
    id: 'dec1',
    decision: 'approve',
    selectedAlternativeId: 'complete_merge',
    actorId: 'jun',
    actorRole: 'approver',
    evidenceHash: 'h1',
    planHash,
    createdAt: new Date(now.getTime() - 60_000),
    expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS),
    ...over,
  };
}

function input(over: Partial<AuthorizationInput> = {}): AuthorizationInput {
  return {
    actor: requester,
    incident: { incidentType: 'merge_conflict', requestedBy: 'minji', source: 'scenario', executed: false },
    approvedSnapshot: { evidenceHash: 'h1', planHash },
    plan,
    currentEvidenceHash: 'h1',
    coverage: { rawUnmerged: 1, captured: 1 },
    decisions: [approval()],
    requestedAlternativeId: 'complete_merge',
    now,
    ...over,
  };
}

describe('authorizeExecution', () => {
  it('allows an approved, fresh, matching request and returns only plan commands', () => {
    const result = authorizeExecution(input());
    expect(result.allowed).toBe(true);
    const displays = result.commands.map((c) => c.display);
    expect(displays).toContain('git commit --no-edit');
    expect(displays.every((d) => d.startsWith('git '))).toBe(true);
    expect(displays.some((d) => /push|reset|clean/.test(d))).toBe(false);
  });

  const denials: Array<[string, Partial<AuthorizationInput>]> = [
    ['no actor', { actor: null }],
    ['viewer', { actor: viewer }],
    ['no decision', { decisions: [] }],
    ['rejection', { decisions: [approval({ decision: 'reject', selectedAlternativeId: null })] }],
    ['later rejection supersedes approval', {
      decisions: [approval(), approval({ id: 'dec2', decision: 'reject', selectedAlternativeId: null, createdAt: new Date(now.getTime() - 1000) })],
    }],
    ['expired', { decisions: [approval({ expiresAt: new Date(now.getTime() - 1) })] }],
    ['self approval', { decisions: [approval({ actorId: 'minji' })] }],
    ['approved by non-approver', { decisions: [approval({ actorRole: 'requester' })] }],
    ['stale evidence', { currentEvidenceHash: 'h2' }],
    ['uncapturable state', { currentEvidenceHash: null }],
    ['different alternative', { requestedAlternativeId: 'abort_merge' }],
    ['already executed', { incident: { incidentType: 'merge_conflict', requestedBy: 'minji', source: 'scenario', executed: true } }],
    ['out of scope type', { incident: { incidentType: 'detached_head', requestedBy: 'minji', source: 'scenario', executed: false } }],
    ['capture coverage gap', { coverage: { rawUnmerged: 21, captured: 20 } }],
    ['omitted conflict blocks', { coverage: { rawUnmerged: 1, captured: 1, omittedConflictBlocks: 2 } }],
    ['imported snapshot', { incident: { incidentType: 'merge_conflict', requestedBy: 'minji', source: 'cli_import', executed: false } }],
  ];

  it.each(denials)('denies: %s', (_name, over) => {
    const result = authorizeExecution(input(over));
    expect(result.allowed).toBe(false);
    expect(result.commands).toEqual([]);
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it('denies a tampered plan that adds git push --force', () => {
    const tampered: RecoveryPlanV1 = JSON.parse(JSON.stringify(plan));
    const alt = tampered.alternatives.find((a) => a.id === 'complete_merge')!;
    alt.steps[alt.steps.length - 1].commands.push({
      executable: 'git',
      args: ['push', '--force', 'origin', 'main'],
      cwdStrategy: 'repo_root',
      display: 'git push --force origin main',
      containsPlaceholder: false,
      readOnly: false,
    });
    const result = authorizeExecution(input({ plan: tampered }));
    expect(result.allowed).toBe(false);
    expect(result.reasons.join(' ')).toMatch(/tampered/);
    expect(result.reasons.join(' ')).toMatch(/push is never allowed/);
  });
});

describe('isDeniedCommand', () => {
  const cmd = (args: string[]) => ({ executable: 'git', args, cwdStrategy: 'repo_root' as const, display: `git ${args.join(' ')}`, containsPlaceholder: false, readOnly: false });
  it.each([
    [['push']],
    [['push', '--force']],
    [['reset', '--hard', 'HEAD']],
    [['clean', '-fdx']],
    [['merge', 'release/x']],
    [['checkout', '--', '.']],
    [['remote', 'add', 'x', 'y']],
    [['config', 'core.hooksPath', '/tmp']],
  ])('denies git %j', (args) => {
    expect(isDeniedCommand(cmd(args))).not.toBeNull();
  });
  it('denies non-git executables', () => {
    expect(isDeniedCommand({ ...cmd(['-rf', '/']), executable: 'rm' })).not.toBeNull();
  });
  it.each([[['add', '--', 'deploy.env']], [['commit', '--no-edit']], [['merge', '--abort']], [['status', '--short']]])(
    'permits git %j',
    (args) => {
      expect(isDeniedCommand(cmd(args))).toBeNull();
    },
  );
});

describe('canApprove', () => {
  it('requires approver role and a different person than the requester', () => {
    expect(canApprove(approver, 'minji')).toBeNull();
    expect(canApprove(requester, 'minji')).not.toBeNull();
    expect(canApprove(viewer, 'minji')).not.toBeNull();
    expect(canApprove({ ...approver, id: 'minji' }, 'minji')).toMatch(/four-eyes/);
    expect(canApprove(null, 'minji')).toBe('unauthenticated');
  });
});
