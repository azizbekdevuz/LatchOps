import type { VerificationResultV1 } from '@latchops/schema';
import type { RecoveryVerdict } from './types';

export interface VerdictInput {
  verification: VerificationResultV1 | null;
  executionFailed: boolean;
  executionError?: string;
}

export interface VerdictDecision {
  verdict: RecoveryVerdict;
  reasons: string[];
}

/**
 * The deterministic verifier decides VERIFIED or FAILED.
 * A model explanation is never an input.
 */
export function decideVerdict(input: VerdictInput): VerdictDecision {
  if (input.executionFailed) {
    return {
      verdict: 'FAILED',
      reasons: [
        input.executionError?.trim() || 'Isolated recovery did not complete cleanly.',
      ],
    };
  }

  if (!input.verification) {
    return {
      verdict: 'FAILED',
      reasons: ['No deterministic verification result was produced.'],
    };
  }

  if (input.verification.status === 'succeeded') {
    return {
      verdict: 'VERIFIED',
      reasons: input.verification.reasons,
    };
  }

  return {
    verdict: 'FAILED',
    reasons: [
      `Deterministic verification status is ${input.verification.status}.`,
      ...input.verification.reasons,
      ...input.verification.remainingIssues,
    ],
  };
}
