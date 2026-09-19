import { describe, expect, it } from 'vitest';
import {
  ExitCode,
  exitCodeForIncident,
  exitCodeForPlan,
  exitCodeForVerification,
} from './exit-codes.js';

describe('exitCodeForIncident', () => {
  it('clean -> success', () => {
    expect(exitCodeForIncident('clean')).toBe(ExitCode.SUCCESS);
  });
  it('unknown -> manual review', () => {
    expect(exitCodeForIncident('unknown')).toBe(ExitCode.MANUAL_REVIEW);
  });
  it('other incidents -> incident detected', () => {
    for (const s of ['dirty_worktree', 'merge_conflict', 'detached_head', 'rebase_in_progress'] as const) {
      expect(exitCodeForIncident(s)).toBe(ExitCode.INCIDENT_DETECTED);
    }
  });
});

describe('exitCodeForPlan', () => {
  it('clean -> success', () => {
    expect(exitCodeForPlan({ incidentType: 'clean', manualReviewRequired: false })).toBe(
      ExitCode.SUCCESS,
    );
  });
  it('manual review required -> manual review', () => {
    expect(exitCodeForPlan({ incidentType: 'detached_head', manualReviewRequired: true })).toBe(
      ExitCode.MANUAL_REVIEW,
    );
  });
  it('actionable incident -> incident detected', () => {
    expect(exitCodeForPlan({ incidentType: 'merge_conflict', manualReviewRequired: false })).toBe(
      ExitCode.INCIDENT_DETECTED,
    );
  });
});

describe('exitCodeForVerification', () => {
  it('succeeded -> success', () => {
    expect(exitCodeForVerification('succeeded')).toBe(ExitCode.SUCCESS);
  });
  it('manual_review -> manual review', () => {
    expect(exitCodeForVerification('manual_review')).toBe(ExitCode.MANUAL_REVIEW);
  });
  it('failed/in_progress/not_started -> verification failed', () => {
    for (const s of ['failed', 'in_progress', 'not_started'] as const) {
      expect(exitCodeForVerification(s)).toBe(ExitCode.VERIFICATION_FAILED);
    }
  });
});
