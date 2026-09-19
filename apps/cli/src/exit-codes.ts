import type { IncidentTypeV1, VerificationStatusV1 } from '@latchops/schema';

/**
 * Stable LatchOps CLI exit codes. These are part of the CLI contract and are
 * covered by unit tests.
 */
export const ExitCode = {
  /** Success: operation completed, repository clean, or verification succeeded. */
  SUCCESS: 0,
  /** Operational failure: not a repo, git missing, IO error, unexpected error. */
  OPERATIONAL_FAILURE: 1,
  /** An incident was detected (a non-clean state with an actionable plan). */
  INCIDENT_DETECTED: 2,
  /** Manual review is required (unknown state or insufficient evidence). */
  MANUAL_REVIEW: 3,
  /** Verification did not confirm success (failed / in progress / not started). */
  VERIFICATION_FAILED: 4,
  /** Invalid input (missing/invalid flags, unreadable/invalid plan file). */
  INVALID_INPUT: 5,
} as const;

export type ExitCodeValue = (typeof ExitCode)[keyof typeof ExitCode];

/** Map a diagnosed incident type to a diagnose/plan exit code. */
export function exitCodeForIncident(incidentType: IncidentTypeV1): ExitCodeValue {
  switch (incidentType) {
    case 'clean':
      return ExitCode.SUCCESS;
    case 'unknown':
      return ExitCode.MANUAL_REVIEW;
    default:
      return ExitCode.INCIDENT_DETECTED;
  }
}

/** Map a plan to an exit code, honouring manual-review/incomplete plans. */
export function exitCodeForPlan(plan: {
  incidentType: IncidentTypeV1;
  manualReviewRequired: boolean;
}): ExitCodeValue {
  if (plan.incidentType === 'clean') return ExitCode.SUCCESS;
  if (plan.manualReviewRequired) return ExitCode.MANUAL_REVIEW;
  return ExitCode.INCIDENT_DETECTED;
}

/** Map a verification status to an exit code. */
export function exitCodeForVerification(status: VerificationStatusV1): ExitCodeValue {
  switch (status) {
    case 'succeeded':
      return ExitCode.SUCCESS;
    case 'manual_review':
      return ExitCode.MANUAL_REVIEW;
    case 'failed':
    case 'in_progress':
    case 'not_started':
      return ExitCode.VERIFICATION_FAILED;
    default:
      return ExitCode.OPERATIONAL_FAILURE;
  }
}
