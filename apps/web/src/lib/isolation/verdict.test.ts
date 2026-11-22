import { describe, expect, it } from 'vitest';
import type { VerificationResultV1 } from '@latchops/schema';
import { decideVerdict } from './verdict';

function verification(status: VerificationResultV1['status']): VerificationResultV1 {
  return {
    version: 1,
    status,
    incidentType: 'merge_conflict',
    selectedAlternativeId: 'complete_merge',
    beforeState: 'merge_conflict',
    afterState: status === 'succeeded' ? 'clean' : 'merge_conflict',
    reasons: status === 'succeeded' ? ['MERGE_HEAD removed and no unmerged paths remain.'] : ['Merge still active.'],
    changedSignals: [],
    remainingIssues: status === 'succeeded' ? [] : ['1 conflicted path(s) remain.'],
    checkedAt: '2026-09-19T00:00:00.000Z',
  };
}

describe('decideVerdict', () => {
  it('VERIFIED only when deterministic verification succeeded', () => {
    const decision = decideVerdict({
      verification: verification('succeeded'),
      executionFailed: false,
    });
    expect(decision.verdict).toBe('VERIFIED');
    expect(decision.reasons[0]).toMatch(/MERGE_HEAD/);
  });

  it('FAILED when execution did not complete', () => {
    const decision = decideVerdict({
      verification: verification('succeeded'),
      executionFailed: true,
      executionError: 'git commit --no-edit exited 1',
    });
    expect(decision.verdict).toBe('FAILED');
    expect(decision.reasons[0]).toContain('commit');
  });

  it('FAILED for in_progress / not_started / missing verification', () => {
    expect(decideVerdict({ verification: verification('in_progress'), executionFailed: false }).verdict).toBe(
      'FAILED',
    );
    expect(decideVerdict({ verification: verification('not_started'), executionFailed: false }).verdict).toBe(
      'FAILED',
    );
    expect(decideVerdict({ verification: null, executionFailed: false }).verdict).toBe('FAILED');
  });
});
