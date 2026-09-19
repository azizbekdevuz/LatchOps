import { describe, expect, it } from 'vitest';
import { RecoveryPlanV1Schema, type RepoSignalsV1 } from '@latchops/schema';
import { buildNosanaEvidence, parseNosanaExplanation, scrub } from './redaction';
import type { BrokenEvidence, ExecEvidence } from './types';

const signals: RepoSignalsV1 = {
  version: 1,
  state: 'merge_conflict',
  secondaryStates: [],
  reasons: ['1 unmerged path(s) with conflict markers'],
  branch: {
    name: 'main',
    oid: 'abc',
    upstream: null,
    ahead: 0,
    behind: 0,
    isDetached: false,
    isUnborn: false,
  },
  worktree: {
    staged: 0,
    modified: 0,
    untracked: 0,
    conflicted: 1,
    conflictedPaths: ['deploy.env'],
    isDirty: true,
  },
  operations: {
    merge: true,
    rebase: false,
    rebaseType: 'none',
    cherryPick: false,
    revert: false,
    bisect: false,
  },
};

const plan = RecoveryPlanV1Schema.parse({
  version: 1,
  generatedAt: '2026-09-19T00:00:00.000Z',
  generatedBy: 'deterministic_engine',
  engineVersion: 'test',
  incidentType: 'merge_conflict',
  summary: 'Merge in progress',
  risk: 'medium',
  preconditions: [],
  steps: [],
  alternatives: [],
  warnings: [],
  manualReviewRequired: false,
  incomplete: false,
});

const broken: BrokenEvidence = {
  incidentType: 'merge_conflict',
  branch: 'main',
  oid: 'abc',
  mergeActive: true,
  conflictedPaths: ['deploy.env'],
  reasons: ['conflict'],
  rawStatus: 'u deploy.env\nAuthorization: Bearer super-secret\nC:\\Users\\Azizbek\\secret-repo',
  conflict: { path: 'deploy.env', ours: 'PORT=3000', theirs: 'PORT=8080' },
};

describe('redaction', () => {
  it('scrubs secrets, emails, and host paths', () => {
    const text = scrub('api_key=abc123 token: xyz /Users/aziz/project demo@latchops.dev');
    expect(text).not.toMatch(/abc123/);
    expect(text).not.toMatch(/\/Users/);
    expect(text).not.toMatch(/demo@/);
  });

  it('builds bounded Nosana evidence without setup dumps or secrets', () => {
    const execution: ExecEvidence[] = [
      {
        display: 'git status',
        executable: 'git',
        args: ['status'],
        exitCode: 0,
        stdout: 'NOSANA_API_KEY=should-not-leak',
        stderr: '',
        durationMs: 1,
        source: 'inspect',
      },
      {
        display: 'git init',
        executable: 'git',
        args: ['init'],
        exitCode: 0,
        stdout: '',
        stderr: '',
        durationMs: 1,
        source: 'setup',
      },
    ];

    const evidence = buildNosanaEvidence({
      plan,
      before: signals,
      after: { ...signals, state: 'clean', worktree: { ...signals.worktree, conflicted: 0, isDirty: false } },
      verification: {
        version: 1,
        status: 'succeeded',
        incidentType: 'merge_conflict',
        selectedAlternativeId: 'complete_merge',
        beforeState: 'merge_conflict',
        afterState: 'clean',
        reasons: ['ok'],
        changedSignals: [{ field: 'operations.merge', before: true, after: false }],
        remainingIssues: [],
        checkedAt: '2026-09-19T00:00:00.000Z',
      },
      broken,
      execution,
      isolation: 'local',
      selectedAlternativeId: 'complete_merge',
    });

    expect(JSON.stringify(evidence)).not.toMatch(/should-not-leak/);
    expect(JSON.stringify(evidence)).not.toMatch(/Bearer/);
    expect(evidence.executed.every((row) => row.source !== 'setup')).toBe(true);
    expect(evidence.verificationStatus).toBe('succeeded');
  });

  it('parses a valid Nosana explanation and rejects garbage', () => {
    expect(
      parseNosanaExplanation({
        whatWasBroken: 'merge conflict on deploy.env',
        whatWasAttempted: 'complete the merge',
        checksPassed: ['MERGE_HEAD gone'],
        checksFailed: [],
        whyItMatters: 'safe to continue',
      }),
    ).toMatchObject({ whatWasBroken: 'merge conflict on deploy.env' });
    expect(parseNosanaExplanation({ hello: 'world' })).toBeNull();
  });
});
