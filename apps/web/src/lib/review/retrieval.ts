import type { EvidenceItem, KnowledgeChunk } from './types';

export interface RetrievalDoc {
  id: string;
  text: string;
}

export interface RetrievalHit {
  id: string;
  score: number;
}

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'is', 'it', 'on', 'for', 'with', 'be', 'by', 'as',
  'at', 'this', 'that', 'are', 'was', 'from', 'not', 'no', 'none', 'true', 'false',
]);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9_가-힣]+/)
    .filter((token) => token.length > 1 && !STOP.has(token));
}

/** Okapi BM25 (k1=1.2, b=0.75). Deterministic, local, no embedding service. */
export function bm25(docs: RetrievalDoc[], query: string, k: number): RetrievalHit[] {
  const k1 = 1.2;
  const b = 0.75;
  const tokenized = docs.map((doc) => tokenize(doc.text));
  const avgLen = tokenized.reduce((sum, t) => sum + t.length, 0) / Math.max(1, tokenized.length);
  const df = new Map<string, number>();
  for (const tokens of tokenized) {
    for (const term of new Set(tokens)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const queryTerms = [...new Set(tokenize(query))];
  const n = docs.length;

  const hits = docs.map((doc, index) => {
    const tokens = tokenized[index];
    const tf = new Map<string, number>();
    for (const term of tokens) tf.set(term, (tf.get(term) ?? 0) + 1);
    let score = 0;
    for (const term of queryTerms) {
      const f = tf.get(term) ?? 0;
      if (!f) continue;
      const idf = Math.log(1 + (n - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * tokens.length) / avgLen)));
    }
    return { id: doc.id, score };
  });

  return hits
    .filter((hit) => hit.score > 0)
    .sort((x, y) => y.score - x.score || x.id.localeCompare(y.id, undefined, { numeric: true }))
    .slice(0, k);
}

/** Evidence kinds always included in RAG mode: the facts a reviewer cannot do without. */
export const PINNED_KINDS = new Set(['classification', 'operation', 'worktree', 'plan', 'alternative']);

export interface RagContext {
  evidence: EvidenceItem[];
  knowledge: KnowledgeChunk[];
  query: string;
}

export const RAG_EVIDENCE_K = 6;
export const RAG_KNOWLEDGE_K = 3;

export function buildRagQuery(items: EvidenceItem[]): string {
  const worktree = items.find((item) => item.kind === 'worktree')?.text ?? '';
  const conflictPaths = items
    .filter((item) => item.kind === 'conflict')
    .map((item) => item.label)
    .join(' ');
  return `merge conflict MERGE_HEAD unmerged conflict markers complete abort risk deployment configuration ${worktree} ${conflictPaths}`;
}

/**
 * Hybrid selection: pinned core facts + top-k BM25 over the remaining
 * evidence + top-k runbook chunks. Returned in original ID order.
 */
export function selectRagContext(items: EvidenceItem[], knowledge: KnowledgeChunk[]): RagContext {
  const query = buildRagQuery(items);
  const pinned = items.filter((item) => PINNED_KINDS.has(item.kind));
  const rest = items.filter((item) => !PINNED_KINDS.has(item.kind));
  const evidenceHits = bm25(
    rest.map((item) => ({ id: item.id, text: `${item.label} ${item.text}` })),
    query,
    RAG_EVIDENCE_K,
  );
  const chosen = new Set([...pinned.map((item) => item.id), ...evidenceHits.map((hit) => hit.id)]);
  const knowledgeHits = new Set(
    bm25(
      knowledge.map((chunk) => ({ id: chunk.id, text: `${chunk.title} ${chunk.text}` })),
      query,
      RAG_KNOWLEDGE_K,
    ).map((hit) => hit.id),
  );
  return {
    evidence: items.filter((item) => chosen.has(item.id)),
    knowledge: knowledge.filter((chunk) => knowledgeHits.has(chunk.id)),
    query,
  };
}
