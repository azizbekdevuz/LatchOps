import type { RecoveryPlanV1, RepoSignalsV1, VerificationResultV1 } from '@latchops/schema';
import { boundText } from './quote';
import type { BrokenEvidence, ExecEvidence, NosanaExplanation } from './types';

const SECRET_RE =
  /(api[_-]?key|authorization|bearer|token|secret|password|daytona|nosana)[=:]\s*\S+/gi;
const PATH_RE = /([A-Za-z]:\\|\/(?:Users|home|tmp|var|private)\/)\S+/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

const MAX_EVIDENCE_CHARS = 6_000;
const MAX_FIELD = 400;

export interface RedactedEvidence {
  incidentType: string;
  summary: string;
  risk: string;
  selectedAlternativeId: string;
  beforeState: string;
  afterState: string | null;
  verificationStatus: string | null;
  verificationReasons: string[];
  remainingIssues: string[];
  changedSignals: Array<{ field: string; before: unknown; after: unknown }>;
  conflict: { path: string; ours: string; theirs: string } | null;
  executed: Array<{ display: string; exitCode: number; source: string }>;
  isolation: string;
}

export function scrub(value: string): string {
  return value
    .replace(SECRET_RE, '[redacted]')
    .replace(PATH_RE, '[path]')
    .replace(EMAIL_RE, '[email]');
}

export function publicRepoLabel(): string {
  return '/demo/checkout-service';
}

export function redactBroken(broken: BrokenEvidence): BrokenEvidence {
  return {
    ...broken,
    rawStatus: boundText(scrub(broken.rawStatus), 1_200),
    reasons: broken.reasons.map((reason) => scrub(reason)),
    conflict: broken.conflict
      ? {
          path: broken.conflict.path,
          ours: boundText(broken.conflict.ours, MAX_FIELD),
          theirs: boundText(broken.conflict.theirs, MAX_FIELD),
          resolved: broken.conflict.resolved
            ? boundText(broken.conflict.resolved, MAX_FIELD)
            : undefined,
        }
      : null,
  };
}

export function buildNosanaEvidence(input: {
  plan: RecoveryPlanV1;
  before: RepoSignalsV1;
  after: RepoSignalsV1 | null;
  verification: VerificationResultV1 | null;
  broken: BrokenEvidence;
  execution: ExecEvidence[];
  isolation: string;
  selectedAlternativeId: string;
}): RedactedEvidence {
  const evidence: RedactedEvidence = {
    incidentType: input.before.state,
    summary: scrub(input.plan.summary),
    risk: input.plan.risk,
    selectedAlternativeId: input.selectedAlternativeId,
    beforeState: input.before.state,
    afterState: input.after?.state ?? null,
    verificationStatus: input.verification?.status ?? null,
    verificationReasons: (input.verification?.reasons ?? []).map(scrub),
    remainingIssues: (input.verification?.remainingIssues ?? []).map(scrub),
    changedSignals: (input.verification?.changedSignals ?? []).map((change) => ({
      field: change.field,
      before: change.before,
      after: change.after,
    })),
    conflict: input.broken.conflict
      ? {
          path: input.broken.conflict.path,
          ours: boundText(input.broken.conflict.ours, 200),
          theirs: boundText(input.broken.conflict.theirs, 200),
        }
      : null,
    executed: input.execution
      .filter((row) => row.source !== 'setup')
      .slice(0, 12)
      .map((row) => ({
        display: scrub(row.display),
        exitCode: row.exitCode,
        source: row.source,
      })),
    isolation: input.isolation,
  };

  const encoded = JSON.stringify(evidence);
  if (encoded.length <= MAX_EVIDENCE_CHARS) return evidence;

  return {
    ...evidence,
    executed: evidence.executed.slice(0, 6),
    verificationReasons: evidence.verificationReasons.slice(0, 4),
    remainingIssues: evidence.remainingIssues.slice(0, 4),
  };
}

export function parseNosanaExplanation(raw: unknown): NosanaExplanation | null {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as Record<string, unknown>;
  const whatWasBroken = asBoundedString(value.whatWasBroken);
  const whatWasAttempted = asBoundedString(value.whatWasAttempted);
  const whyItMatters = asBoundedString(value.whyItMatters);
  if (!whatWasBroken || !whatWasAttempted || !whyItMatters) return null;

  return {
    whatWasBroken,
    whatWasAttempted,
    whyItMatters,
    checksPassed: asStringArray(value.checksPassed),
    checksFailed: asStringArray(value.checksFailed),
  };
}

function asBoundedString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = scrub(value.trim());
  if (!trimmed) return null;
  return boundText(trimmed, 500);
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => boundText(scrub(item), 200))
    .slice(0, 8);
}
