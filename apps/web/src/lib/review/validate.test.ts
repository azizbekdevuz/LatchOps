import { describe, expect, it } from 'vitest';
import { generateRecoveryPlan } from '@latchops/recovery-engine';
import { computeRepoSignals } from '@latchops/state-engine';
import { builtInBrokenSnapshot } from '@/lib/hacksprint/preview-fixture';
import { buildEvidence } from './evidence';
import { adversarialResponses, groundedResponse } from './fixture-responses';
import { KNOWLEDGE_BASE } from './knowledge';
import { buildPrompt } from './prompt';
import { extractEntities, validateExplanation } from './validate';

const snapshot = builtInBrokenSnapshot();
const signals = computeRepoSignals(snapshot);
const plan = generateRecoveryPlan({ snapshot, signals });
const built = buildEvidence({ snapshot, signals, plan });
const items = built.evidence.items;

function ctx(mode: 'direct' | 'rag' = 'direct') {
  const prompt = buildPrompt(items, mode);
  return { prompt, items, knowledge: KNOWLEDGE_BASE, plan, signals };
}

function claimOutput(claims: unknown[], extra: Record<string, unknown> = {}) {
  return JSON.stringify({
    summary: 'Merge stopped on a conflict.',
    claims,
    uncertainties: ['Which side is intended is not in the evidence.'],
    recommendedAlternativeId: 'complete_merge',
    humanDecisionNeeded: 'Pick complete or abort.',
    ...extra,
  });
}

const worktreeId = items.find((i) => i.kind === 'worktree')!.id;
const conflictId = items.find((i) => i.kind === 'conflict')!.id;

describe('validateExplanation', () => {
  it('accepts a grounded, cited explanation', () => {
    const { report } = validateExplanation(groundedResponse(items, signals.worktree.conflictedPaths), ctx());
    expect(report.status).toBe('accepted');
    expect(report.unsupportedKeyClaims).toBe(0);
  });

  it('accepts the same explanation in RAG mode (pinned facts are present)', () => {
    const { report } = validateExplanation(groundedResponse(items, signals.worktree.conflictedPaths), ctx('rag'));
    expect(report.status).toBe('accepted');
  });

  it.each(adversarialResponses(items).map((r) => [r.label, r.raw]))('rejects %s', (_label, raw) => {
    const { report } = validateExplanation(raw, ctx());
    expect(report.status).toBe('rejected');
  });

  it('rejects a key claim whose value is not in the cited item', () => {
    const raw = claimOutput([
      { id: 'C1', text: 'Production uses PORT=9999.', type: 'state', key: true, citations: [conflictId], confidence: 'high' },
    ]);
    const { report } = validateExplanation(raw, ctx());
    expect(report.status).toBe('rejected');
    expect(report.claimChecks[0].missingEntities).toContain('port=9999');
  });

  it('accepts a value that the cited conflict block contains', () => {
    const raw = claimOutput([
      { id: 'C1', text: 'Main sets PORT=8443 while the release uses PORT=8080.', type: 'state', key: true, citations: [conflictId], confidence: 'high' },
    ]);
    expect(validateExplanation(raw, ctx()).report.status).toBe('accepted');
  });

  it('rejects a wrong conflicted-path count', () => {
    const raw = claimOutput([
      { id: 'C1', text: 'There are 3 conflicted files.', type: 'state', key: true, citations: [worktreeId], confidence: 'high' },
    ]);
    expect(validateExplanation(raw, ctx()).report.status).toBe('rejected');
  });

  it('rejects a key claim that cites only runbook chunks', () => {
    const raw = claimOutput([
      { id: 'C1', text: 'A merge is in progress.', type: 'state', key: true, citations: ['K1'], confidence: 'high' },
    ]);
    expect(validateExplanation(raw, ctx()).report.status).toBe('rejected');
  });

  it('rejects an unknown recommended alternative', () => {
    const raw = claimOutput(
      [{ id: 'C1', text: 'A merge is in progress.', type: 'state', key: true, citations: [worktreeId], confidence: 'high' }],
      { recommendedAlternativeId: 'force_push' },
    );
    expect(validateExplanation(raw, ctx()).report.status).toBe('rejected');
  });

  it('rejects outcome assertions but allows negated ones', () => {
    const bad = claimOutput([
      { id: 'C1', text: 'The merge is safe to push now.', type: 'risk', key: true, citations: [worktreeId], confidence: 'high' },
    ]);
    expect(validateExplanation(bad, ctx()).report.status).toBe('rejected');
    const ok = claimOutput([
      { id: 'C1', text: 'A merge is in progress and the recovery has not been verified.', type: 'state', key: true, citations: [worktreeId], confidence: 'high' },
    ]);
    expect(validateExplanation(ok, ctx()).report.status).toBe('accepted');
  });

  it('allows quoting a command that is in the deterministic plan', () => {
    const raw = claimOutput([
      { id: 'C1', text: 'Completing the merge stages the file with git add -- deploy.env.', type: 'option', key: true, citations: [items.find((i) => i.text.startsWith('id=complete_merge'))!.id], confidence: 'high' },
    ]);
    expect(validateExplanation(raw, ctx()).report.status).toBe('accepted');
  });

  it('rejects a claim citing an item that RAG did not provide', () => {
    const rag = ctx('rag');
    const missing = items.find((i) => !rag.prompt.contextIds.includes(i.id));
    expect(missing).toBeDefined();
    const raw = claimOutput([
      { id: 'C1', text: 'A merge is in progress.', type: 'state', key: true, citations: [missing!.id], confidence: 'high' },
    ]);
    expect(validateExplanation(raw, rag).report.status).toBe('rejected');
  });

  it('rejects output missing uncertainties', () => {
    const raw = JSON.stringify({ ...JSON.parse(groundedResponse(items, ['deploy.env'])), uncertainties: [] });
    expect(validateExplanation(raw, ctx()).report.status).toBe('rejected');
  });

  it('normalizes string-encoded scalars and reports each conversion', () => {
    const grounded = JSON.parse(groundedResponse(items, ['deploy.env']));
    grounded.recommendedAlternativeId = 'null';
    grounded.claims[0].key = 'true';
    const { report, output } = validateExplanation(JSON.stringify(grounded), ctx());
    expect(output?.recommendedAlternativeId).toBeNull();
    expect(output?.claims[0].key).toBe(true);
    expect(report.normalizations).toHaveLength(2);
  });

  it('does not coerce other strings into a plan alternative', () => {
    const raw = JSON.stringify({ ...JSON.parse(groundedResponse(items, ['deploy.env'])), recommendedAlternativeId: 'force_push' });
    const { report } = validateExplanation(raw, ctx());
    expect(report.status).toBe('rejected');
    expect(report.normalizations).toEqual([]);
  });
});

describe('extractEntities', () => {
  it('finds paths, assignments and config keys but ignores word pairs', () => {
    const entities = extractEntities('ours/theirs differ in deploy.env: PORT = 8443 and HEALTHCHECK_PATH, see release/checkout-api');
    expect(entities).toEqual(expect.arrayContaining(['deploy.env', 'port=8443', 'HEALTHCHECK_PATH', 'release/checkout-api']));
    expect(entities).not.toContain('ours/theirs');
  });
});
