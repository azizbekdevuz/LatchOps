import { z } from 'zod';

// Issue types we detect
export const IssueTypeSchema = z.enum([
  'merge_conflict',
  'detached_head',
  'rebase_in_progress',
  'clean',
  'unknown',
]);

export type IssueType = z.infer<typeof IssueTypeSchema>;

// Danger levels for plan steps
export const DangerLevelSchema = z.enum(['safe', 'caution', 'dangerous']);

export type DangerLevel = z.infer<typeof DangerLevelSchema>;

// Choice for conflict resolution
export const HunkChoiceSchema = z.enum(['ours', 'theirs', 'manual', 'combine']);

export type HunkChoice = z.infer<typeof HunkChoiceSchema>;

// ==========================================
// Repo Graph for Visualization
// ==========================================

export const GraphNodeSchema = z.object({
  id: z.string(),
  type: z.enum(['commit', 'branch', 'tag', 'head', 'remote']),
  label: z.string(),
  sha: z.string().optional(),
  isCurrent: z.boolean().optional(),
  isDetached: z.boolean().optional(),
});

export type GraphNode = z.infer<typeof GraphNodeSchema>;

export const GraphEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  type: z.enum(['parent', 'branch', 'merge']).optional(),
});

export type GraphEdge = z.infer<typeof GraphEdgeSchema>;

export const RepoGraphSchema = z.object({
  nodes: z.array(GraphNodeSchema),
  edges: z.array(GraphEdgeSchema),
  headRef: z.string().optional(),
  mergeHeadRef: z.string().optional(),
});

export type RepoGraph = z.infer<typeof RepoGraphSchema>;

// ==========================================
// Conflict Hunks
// ==========================================

export const ConflictHunkSchema = z.object({
  index: z.number(),
  startLine: z.number().optional(),
  endLine: z.number().optional(),
  baseText: z.string(),
  oursText: z.string(),
  theirsText: z.string(),
  explanation: z.string().optional(),
  suggestedChoice: HunkChoiceSchema.optional(),
  suggestedContent: z.string().optional(),
});

export type ConflictHunk = z.infer<typeof ConflictHunkSchema>;

export const ConflictFileSchema = z.object({
  path: z.string(),
  highLevelSummary: z.string().optional(),
  hunks: z.array(ConflictHunkSchema),
});

export type ConflictFile = z.infer<typeof ConflictFileSchema>;

// ==========================================
// Plan Steps
// ==========================================

export const PlanStepSchema = z.object({
  index: z.number(),
  title: z.string(),
  rationale: z.string().optional(),
  commands: z.array(z.string()),
  verify: z.array(z.string()),
  undo: z.array(z.string()),
  dangerLevel: DangerLevelSchema,
});

export type PlanStep = z.infer<typeof PlanStepSchema>;

// ==========================================
// Full Analysis Result
// ==========================================

export const AnalysisResultSchema = z.object({
  issueType: IssueTypeSchema,
  summary: z.string(),
  repoGraph: RepoGraphSchema.optional(),
  conflicts: z.array(ConflictFileSchema).optional(),
  plan: z.array(PlanStepSchema),
});

export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;

// ==========================================
// Agent API Request/Response
// ==========================================

export const AnalyzeRequestSchema = z.object({
  snapshot: z.any(), // SnapshotV1
  options: z.object({
    includeGraph: z.boolean().optional(),
    maxConflictFiles: z.number().optional(),
    maxHunksPerFile: z.number().optional(),
  }).optional(),
});

export type AnalyzeRequest = z.infer<typeof AnalyzeRequestSchema>;

export const AnalyzeResponseSchema = z.object({
  success: z.boolean(),
  analysis: AnalysisResultSchema.optional(),
  error: z.string().optional(),
  durationMs: z.number().optional(),
});

export type AnalyzeResponse = z.infer<typeof AnalyzeResponseSchema>;
