import type { RecoveryPlanV1 } from '@latchops/schema';
import { canonicalJson } from './canonical';
import { reviewDb } from './db';
import { adversarialResponses, groundedResponse } from './fixture-responses';
import { fixtureProvider, type LlmProvider } from './llm';
import { buildPrompt } from './prompt';
import type { ReviewScenario } from './scenarios';
import {
  createScenarioReview,
  executeReview,
  generateExplanation,
  getReview,
  grantConsent,
  recordDecision,
  ReviewError,
  type ExplanationOutcome,
} from './service';
import { APPROVAL_TTL_MS } from './authorize';
import type { ExecutionVerdict, ReviewActor } from './types';

export const RUNNER_ACTORS: Record<'requester' | 'approver' | 'viewer', ReviewActor> = {
  requester: { id: 'minji', name: 'Minji', role: 'requester' },
  approver: { id: 'jun', name: 'Jun', role: 'approver' },
  viewer: { id: 'seo', name: 'Seo', role: 'viewer' },
};

export interface ScenarioOutcome {
  scenarioId: string;
  incidentId: string;
  expectedVerdict: ExecutionVerdict;
  verdict: ExecutionVerdict;
  verdictAgrees: boolean;
  authorized: boolean;
  /** Commands actually executed although the scenario should have been blocked. */
  unauthorizedExecution: boolean;
  authReasons: string[];
  decisionRefused: string | null;
  explanation: ExplanationOutcome | null;
  explanationBlocked: string | null;
  adversarialRejected: number | null;
  adversarialTotal: number | null;
  plantedSecretsInEvidence: number;
  plantedSecretsInPrompts: number;
  evidenceTruncated: boolean;
  redactions: number;
  auditChainValid: boolean;
  auditEvents: number;
  evidenceItems: number;
  directPromptChars: number;
  ragPromptChars: number;
}

export interface RunOptions {
  /** Provider for the normal explanation step; null skips it. */
  provider?: LlmProvider | null;
  mode?: 'direct' | 'rag';
  now?: () => Date;
}

export async function runScenario(scenario: ReviewScenario, opts: RunOptions = {}): Promise<ScenarioOutcome> {
  const { requester, approver, viewer } = RUNNER_ACTORS;
  const now = opts.now ?? (() => new Date());
  const incidentId = await createScenarioReview(requester, scenario.id);
  let review = await getReview(incidentId);
  const items = review.snapshot.evidence.items;
  const conflictedPaths = review.snapshot.signals.worktree.conflictedPaths;

  const planted = scenario.expected.plantedSecrets ?? [];
  const evidenceJson = canonicalJson(review.snapshot.evidence);
  const prompts = [buildPrompt(items, 'direct').user, buildPrompt(items, 'rag').user];
  const plantedSecretsInEvidence = planted.filter((s) => evidenceJson.includes(s)).length;
  const plantedSecretsInPrompts = planted.filter((s) => prompts.some((p) => p.includes(s))).length;

  let explanation: ExplanationOutcome | null = null;
  let explanationBlocked: string | null = null;
  let adversarialRejected: number | null = null;
  let adversarialTotal: number | null = null;

  if (scenario.control === 'no_consent') {
    try {
      await generateExplanation(requester, incidentId, opts.mode ?? 'direct', {
        provider: opts.provider ?? fixtureProvider(() => groundedResponse(items, conflictedPaths)),
      });
    } catch (error) {
      explanationBlocked = error instanceof ReviewError ? error.message : String(error);
    }
  } else if (scenario.control === 'bad_llm') {
    const bad = adversarialResponses(items);
    adversarialTotal = bad.length;
    adversarialRejected = 0;
    for (const response of bad) {
      const provider = fixtureProvider(() => response.raw, `fixture:${response.label}`);
      await grantConsent(requester, incidentId, provider.id);
      const outcome = await generateExplanation(requester, incidentId, 'direct', { provider });
      if (outcome.status !== 'accepted') adversarialRejected++;
    }
  } else if (opts.provider) {
    await grantConsent(requester, incidentId, opts.provider.id);
    explanation = await generateExplanation(requester, incidentId, opts.mode ?? 'direct', { provider: opts.provider });
  }

  let decisionRefused: string | null = null;
  const decide = async (actor: ReviewActor, decision: 'approve' | 'reject') => {
    try {
      await recordDecision(
        actor,
        incidentId,
        {
          decision,
          alternativeId: scenario.selectedAlternativeId,
          reason: decision === 'approve' ? `Approved ${scenario.selectedAlternativeId} after reviewing evidence` : 'Release is not ready; rejecting recovery',
          explanationId: explanation?.status === 'accepted' ? explanation.id : undefined,
        },
        { now },
      );
    } catch (error) {
      decisionRefused = error instanceof ReviewError ? error.message : String(error);
    }
  };

  let executor: ReviewActor = requester;
  switch (scenario.control) {
    case 'reject':
      await decide(approver, 'reject');
      break;
    case 'viewer':
      await decide(viewer, 'approve');
      executor = viewer;
      break;
    case 'self_approval':
      await decide({ ...approver, id: requester.id }, 'approve');
      break;
    default:
      await decide(approver, 'approve');
  }

  if (scenario.control === 'tamper') {
    const db = await reviewDb();
    const snap = review.snapshot;
    const plan: RecoveryPlanV1 = JSON.parse(JSON.stringify(snap.plan));
    const alt = plan.alternatives.find((a) => a.id === scenario.selectedAlternativeId)!;
    alt.steps[alt.steps.length - 1].commands.push({
      executable: 'git',
      args: ['push', '--force', 'origin', 'main'],
      cwdStrategy: 'repo_root',
      display: 'git push --force origin main',
      containsPlaceholder: false,
      readOnly: false,
    });
    await db.evidenceSnapshotRecord.update({ where: { id: snap.id }, data: { planJson: canonicalJson(plan) } });
  }

  const execNow = scenario.control === 'expired' ? () => new Date(now().getTime() + APPROVAL_TTL_MS + 60_000) : now;
  const execution = await executeReview(executor, incidentId, { now: execNow });

  review = await getReview(incidentId);
  const verdict = execution.verdict as ExecutionVerdict;
  const performed = execution.authorized && execution.result !== null && execution.result.execution.length > 0;
  return {
    scenarioId: scenario.id,
    incidentId,
    expectedVerdict: scenario.expected.verdict,
    verdict,
    verdictAgrees: verdict === scenario.expected.verdict,
    authorized: execution.authorized,
    unauthorizedExecution: performed && scenario.expected.verdict === 'BLOCKED',
    authReasons: execution.reasons,
    decisionRefused,
    explanation,
    explanationBlocked,
    adversarialRejected,
    adversarialTotal,
    plantedSecretsInEvidence,
    plantedSecretsInPrompts,
    evidenceTruncated: review.snapshot.evidence.truncated,
    redactions: review.snapshot.redaction.totalRedactions,
    auditChainValid: review.chain.valid,
    auditEvents: review.chain.events,
    evidenceItems: items.length,
    directPromptChars: prompts[0].length,
    ragPromptChars: prompts[1].length,
  };
}
