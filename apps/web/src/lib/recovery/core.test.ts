import { describe, expect, it } from 'vitest';
import { RecoveryPlanV1Schema, RepoSignalsV1Schema, type SnapshotV1 } from '@latchops/schema';
import {
  analyzeSnapshot,
  DETERMINISTIC_STAGE_ORDER,
  parsePlan,
  parseSignals,
  parseSnapshot,
  PIPELINE_STAGES,
  safeParsePlan,
  safeParseSignals,
} from './core';

const NOW = '2026-07-25T00:00:00.000Z';

function baseSnapshot(overrides: Partial<SnapshotV1> = {}): SnapshotV1 {
  return {
    version: 1,
    timestamp: NOW,
    platform: 'linux',
    repoRoot: '/tmp/repo',
    gitDir: '/tmp/repo/.git',
    branch: { head: 'main', oid: 'a'.repeat(40) },
    isDetachedHead: false,
    rebaseState: { inProgress: false, type: 'none' },
    unmergedFiles: [],
    stagedFiles: [],
    modifiedFiles: [],
    untrackedFiles: [],
    recentLog: [],
    recentReflog: [],
    rawStatus: '',
    rawBranches: '',
    ...overrides,
  };
}

function mergeConflictSnapshot(): SnapshotV1 {
  return baseSnapshot({
    mergeHead: 'b'.repeat(40),
    unmergedFiles: [
      {
        path: 'src/app.ts',
        conflictBlocks: [
          { startLine: 1, endLine: 5, oursContent: 'ours', theirsContent: 'theirs', context: 'ctx' },
        ],
      },
    ],
  });
}

describe('analyzeSnapshot (deterministic pipeline core)', () => {
  it('validates, computes canonical signals, and generates a canonical RecoveryPlanV1', () => {
    const snapshot = mergeConflictSnapshot();
    const { signals, plan } = analyzeSnapshot(snapshot);

    expect(signals.state).toBe('merge_conflict');
    // Signals validate against the canonical schema.
    expect(RepoSignalsV1Schema.safeParse(signals).success).toBe(true);
    // Plan validates against the canonical schema (persisted plan invariant).
    expect(RecoveryPlanV1Schema.safeParse(plan).success).toBe(true);
    expect(plan.incidentType).toBe('merge_conflict');
    expect(plan.steps.length).toBeGreaterThan(0);
  });

  it('is pure and deterministic (same snapshot -> identical signals + plan, no I/O/LLM)', () => {
    const snapshot = mergeConflictSnapshot();
    const a = analyzeSnapshot(snapshot);
    const b = analyzeSnapshot(snapshot);
    // `generatedAt` is a wall-clock stamp; everything derived from the snapshot
    // (signals + plan content) must be byte-for-byte identical.
    expect(JSON.stringify(a.signals)).toBe(JSON.stringify(b.signals));
    const stripStamp = (p: typeof a.plan) => ({ ...p, generatedAt: '<stamp>' });
    expect(JSON.stringify(stripStamp(a.plan))).toBe(JSON.stringify(stripStamp(b.plan)));
  });

  it('classifies a clean repo without emitting destructive steps', () => {
    const { signals, plan } = analyzeSnapshot(baseSnapshot());
    expect(signals.state).toBe('clean');
    expect(RecoveryPlanV1Schema.safeParse(plan).success).toBe(true);
  });

  it('never routes a cherry-pick conflict to git merge --abort', () => {
    const snapshot = baseSnapshot({
      cherryPickInProgress: true,
      unmergedFiles: [
        {
          path: 'a.txt',
          conflictBlocks: [
            { startLine: 1, endLine: 2, oursContent: 'x', theirsContent: 'y', context: '' },
          ],
        },
      ],
    });
    const { signals, plan } = analyzeSnapshot(snapshot);
    expect(signals.operations.cherryPick).toBe(true);
    expect(signals.operations.merge).toBe(false);
    const args = [...plan.steps, ...plan.alternatives.flatMap((alt) => alt.steps)]
      .flatMap((s) => s.commands)
      .map((c) => c.args);
    expect(args.some((a) => a[0] === 'merge')).toBe(false);
  });
});

describe('Zod-validated persistence helpers', () => {
  it('parseSnapshot throws on malformed snapshot JSON (no silent cast)', () => {
    expect(() => parseSnapshot({ version: 2 })).toThrow();
    expect(() => parseSnapshot(null)).toThrow();
  });

  it('parsePlan / parseSignals throw on invalid persisted JSON', () => {
    expect(() => parsePlan({ not: 'a plan' })).toThrow();
    expect(() => parseSignals({ not: 'signals' })).toThrow();
  });

  it('safeParse* return null on invalid JSON instead of throwing', () => {
    expect(safeParsePlan({ garbage: true })).toBeNull();
    expect(safeParseSignals('nonsense')).toBeNull();
  });

  it('round-trips a generated plan through JSON + parsePlan', () => {
    const { signals, plan } = analyzeSnapshot(mergeConflictSnapshot());
    const roundTrippedPlan = parsePlan(JSON.parse(JSON.stringify(plan)));
    const roundTrippedSignals = parseSignals(JSON.parse(JSON.stringify(signals)));
    expect(roundTrippedPlan.incidentType).toBe(plan.incidentType);
    expect(roundTrippedSignals.state).toBe(signals.state);
  });
});

describe('deterministic trace stages', () => {
  it('exposes the canonical stage names (no agent/graph stages)', () => {
    expect(PIPELINE_STAGES).toEqual({
      snapshotValidated: 'snapshot_validated',
      signalsComputed: 'signals_computed',
      incidentClassified: 'incident_classified',
      planGenerated: 'plan_generated',
      verificationCompleted: 'verification_completed',
    });
    expect(DETERMINISTIC_STAGE_ORDER).toEqual([
      'snapshot_validated',
      'signals_computed',
      'incident_classified',
      'plan_generated',
      'verification_completed',
    ]);
  });
});
