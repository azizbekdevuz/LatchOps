import { describe, expect, it } from 'vitest';
import { generateRecoveryPlan } from '@latchops/recovery-engine';
import { computeRepoSignals } from '@latchops/state-engine';
import { builtInBrokenSnapshot } from '@/lib/isolation/demo-scenario';
import { buildEvidence } from './evidence';
import { KNOWLEDGE_BASE } from './knowledge';
import { buildPrompt } from './prompt';
import { bm25, PINNED_KINDS, selectRagContext } from './retrieval';

const snapshot = builtInBrokenSnapshot();
const signals = computeRepoSignals(snapshot);
const plan = generateRecoveryPlan({ snapshot, signals });
const { evidence } = buildEvidence({ snapshot, signals, plan });

describe('bm25', () => {
  it('ranks the matching document first and is deterministic', () => {
    const docs = [
      { id: 'a', text: 'abort the merge and discard work' },
      { id: 'b', text: 'conflict markers remain in deploy.env' },
      { id: 'c', text: 'reflog lists previous HEAD positions' },
    ];
    const first = bm25(docs, 'conflict markers deploy.env', 2);
    expect(first[0].id).toBe('b');
    expect(bm25(docs, 'conflict markers deploy.env', 2)).toEqual(first);
  });
});

describe('selectRagContext', () => {
  it('always includes pinned core evidence and a bounded runbook subset', () => {
    const ctx = selectRagContext(evidence.items, KNOWLEDGE_BASE);
    for (const item of evidence.items.filter((i) => PINNED_KINDS.has(i.kind))) {
      expect(ctx.evidence.map((e) => e.id)).toContain(item.id);
    }
    expect(ctx.knowledge.length).toBeLessThanOrEqual(3);
    expect(ctx.knowledge.length).toBeGreaterThan(0);
  });

  it('produces a smaller prompt than direct injection', () => {
    expect(buildPrompt(evidence.items, 'rag').user.length).toBeLessThan(buildPrompt(evidence.items, 'direct').user.length);
  });
});

describe('buildEvidence', () => {
  it('hash is stable across captures of the same state', () => {
    const again = buildEvidence({ snapshot: { ...snapshot, timestamp: '2027-01-01T00:00:00.000Z' }, signals, plan: { ...plan, generatedAt: '2027-01-01T00:00:00.000Z' } });
    expect(again.evidenceHash).toBe(buildEvidence({ snapshot, signals, plan }).evidenceHash);
    expect(again.planHash).toBe(buildEvidence({ snapshot, signals, plan }).planHash);
  });

  it('marks repository-authored text as untrusted', () => {
    expect(evidence.items.filter((i) => i.kind === 'conflict').every((i) => i.untrusted)).toBe(true);
    expect(evidence.items.filter((i) => i.kind === 'plan').every((i) => !i.untrusted)).toBe(true);
  });
});
