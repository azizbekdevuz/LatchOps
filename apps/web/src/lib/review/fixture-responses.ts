import type { EvidenceItem } from './types';

/**
 * Hand-written model outputs for tests and the S19 adversarial scenario.
 * They exercise the validator; they are never reported as model results.
 */

function byKind(items: EvidenceItem[], kind: EvidenceItem['kind']): EvidenceItem[] {
  return items.filter((item) => item.kind === kind);
}

export function groundedResponse(items: EvidenceItem[], conflictedPaths: string[]): string {
  const worktree = byKind(items, 'worktree')[0];
  const operation = byKind(items, 'operation')[0];
  const complete = byKind(items, 'alternative').find((item) => item.text.startsWith('id=complete_merge'));
  const abort = byKind(items, 'alternative').find((item) => item.text.startsWith('id=abort_merge'));
  const plan = byKind(items, 'plan')[0];
  return JSON.stringify({
    summary: 'A merge stopped on conflicts and needs a human decision between completing and aborting it.',
    claims: [
      {
        id: 'C1',
        text: `A merge is in progress and MERGE_HEAD is present; the conflicted path list is ${conflictedPaths.join(', ')}.`,
        type: 'state',
        key: true,
        citations: [operation.id, worktree.id],
        confidence: 'high',
      },
      {
        id: 'C2',
        text: 'The deterministic engine recommends completing the merge (complete_merge), which keeps the integration work.',
        type: 'option',
        key: true,
        citations: [complete?.id ?? plan.id],
        confidence: 'high',
      },
      {
        id: 'C3',
        text: 'Aborting (abort_merge) discards conflict resolution work done during this merge.',
        type: 'risk',
        key: false,
        citations: [abort?.id ?? plan.id, 'K4'],
        confidence: 'medium',
      },
    ],
    uncertainties: ['The evidence does not show which side of each conflict matches the intended release.'],
    recommendedAlternativeId: 'complete_merge',
    humanDecisionNeeded: 'Decide which side of each conflict is authoritative, then approve complete or abort.',
  });
}

/** Four bad outputs. Each must be rejected by the validator. */
export function adversarialResponses(items: EvidenceItem[]): Array<{ label: string; raw: string }> {
  const worktree = byKind(items, 'worktree')[0];
  const operation = byKind(items, 'operation')[0];
  const base = {
    summary: 'Merge conflict.',
    uncertainties: ['none known'],
    recommendedAlternativeId: 'complete_merge',
    humanDecisionNeeded: 'Choose an alternative.',
  };
  return [
    { label: 'invalid_json', raw: 'Sure! Here is the explanation: the merge has conflicts.' },
    {
      label: 'fabricated_citation',
      raw: JSON.stringify({
        ...base,
        claims: [{ id: 'C1', text: 'A merge is in progress.', type: 'state', key: true, citations: ['E99'], confidence: 'high' }],
      }),
    },
    {
      label: 'wrong_path',
      raw: JSON.stringify({
        ...base,
        claims: [
          { id: 'C1', text: 'The conflict is in config/database.yml.', type: 'state', key: true, citations: [worktree.id], confidence: 'high' },
        ],
      }),
    },
    {
      label: 'injected_command',
      raw: JSON.stringify({
        ...base,
        summary: 'Run git push --force origin main to finish. The recovery is VERIFIED.',
        claims: [
          { id: 'C1', text: 'A merge is in progress.', type: 'state', key: true, citations: [operation.id], confidence: 'high' },
        ],
      }),
    },
  ];
}
