import { z } from 'zod';

/** The single incident type in scope for Recovery Review. */
export const REVIEW_INCIDENT_TYPE = 'merge_conflict' as const;

export const EvidenceKindSchema = z.enum([
  'classification',
  'operation',
  'branch',
  'worktree',
  'conflict',
  'commit',
  'reflog',
  'plan',
  'alternative',
]);
export type EvidenceKind = z.infer<typeof EvidenceKindSchema>;

export const EvidenceItemSchema = z.object({
  id: z.string().regex(/^E\d+$/),
  kind: EvidenceKindSchema,
  label: z.string(),
  /** Redacted text shown to reviewers and sent to the model. */
  text: z.string(),
  /** Where in the deterministic snapshot/signals/plan this came from. */
  source: z.string(),
  /** Free text written by repository users (commit subjects, file contents). */
  untrusted: z.boolean(),
});
export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export interface RedactionFinding {
  itemId: string;
  type: string;
  count: number;
}

export interface RedactionReport {
  findings: RedactionFinding[];
  totalRedactions: number;
  /** True only after a second scan of the redacted output found nothing. */
  verifiedClean: boolean;
}

export interface EvidenceSnapshot {
  version: 1;
  incidentType: string;
  items: EvidenceItem[];
  truncated: boolean;
  truncationNotes: string[];
  /** Unmerged entries in raw `git status` vs paths stored, plus blocks dropped by the per-file cap. */
  coverage: { rawUnmerged: number; captured: number; omittedConflictBlocks: number };
}

export const KnowledgeChunkSchema = z.object({
  id: z.string().regex(/^K\d+$/),
  title: z.string(),
  text: z.string(),
  reference: z.string(),
});
export type KnowledgeChunk = z.infer<typeof KnowledgeChunkSchema>;

export type ExplanationMode = 'direct' | 'rag';

export const ClaimTypeSchema = z.enum(['state', 'cause', 'risk', 'option']);

export const ExplanationClaimSchema = z.object({
  id: z.string().max(8),
  text: z.string().min(1).max(400),
  type: ClaimTypeSchema,
  key: z.boolean(),
  citations: z.array(z.string().max(8)).max(6),
  confidence: z.enum(['high', 'medium', 'low']),
});
export type ExplanationClaim = z.infer<typeof ExplanationClaimSchema>;

/** Contract the model must return. Anything else is rejected. */
export const ExplanationOutputSchema = z.object({
  summary: z.string().min(1).max(600),
  claims: z.array(ExplanationClaimSchema).min(1).max(10),
  uncertainties: z.array(z.string().min(1).max(300)).min(1).max(6),
  recommendedAlternativeId: z.string().max(40).nullable(),
  humanDecisionNeeded: z.string().min(1).max(400),
});
export type ExplanationOutput = z.infer<typeof ExplanationOutputSchema>;

export type ClaimSupport = 'supported' | 'unsupported';

export interface ClaimCheck {
  claimId: string;
  key: boolean;
  support: ClaimSupport;
  reasons: string[];
  missingEntities: string[];
  invalidCitations: string[];
}

export interface ValidationReport {
  status: 'accepted' | 'rejected';
  schemaValid: boolean;
  schemaErrors: string[];
  forbidden: string[];
  claimChecks: ClaimCheck[];
  keyClaims: number;
  unsupportedKeyClaims: number;
  totalClaims: number;
  unsupportedClaims: number;
  warnings: string[];
  rejectionReasons: string[];
  /** String-encoded scalars ("true", "null") converted before schema check; content is never rewritten. */
  normalizations?: string[];
}

export type ActorRole = 'viewer' | 'requester' | 'approver';

export interface ReviewActor {
  id: string;
  name: string;
  role: ActorRole;
}

export type ExecutionVerdict = 'VERIFIED' | 'FAILED' | 'BLOCKED';
