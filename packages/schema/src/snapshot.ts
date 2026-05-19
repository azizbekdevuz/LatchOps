import { z } from 'zod';

// Conflict block extracted from a file
export const ConflictBlockSchema = z.object({
  startLine: z.number(),
  endLine: z.number(),
  oursContent: z.string(),
  theirsContent: z.string(),
  context: z.string(), // surrounding lines for context
});

export type ConflictBlock = z.infer<typeof ConflictBlockSchema>;

// Unmerged file with conflict details
export const UnmergedFileSchema = z.object({
  path: z.string(),
  stageOurs: z.string().optional(), // mode info
  stageTheirs: z.string().optional(),
  stageBase: z.string().optional(),
  conflictBlocks: z.array(ConflictBlockSchema).max(3), // up to 3 blocks
});

export type UnmergedFile = z.infer<typeof UnmergedFileSchema>;

// Branch info from porcelain v2
export const BranchInfoSchema = z.object({
  head: z.string(), // branch name or "(detached)"
  oid: z.string(), // current commit hash
  upstream: z.string().optional(),
  aheadBehind: z.object({
    ahead: z.number(),
    behind: z.number(),
  }).optional(),
});

export type BranchInfo = z.infer<typeof BranchInfoSchema>;

// Reflog entry
export const ReflogEntrySchema = z.object({
  hash: z.string(),
  selector: z.string(), // e.g., HEAD@{0}
  action: z.string(),
  message: z.string(),
});

export type ReflogEntry = z.infer<typeof ReflogEntrySchema>;

// Log entry
export const LogEntrySchema = z.object({
  hash: z.string(),
  refs: z.array(z.string()), // decorations
  message: z.string(),
});

export type LogEntry = z.infer<typeof LogEntrySchema>;

// Rebase state info
export const RebaseStateSchema = z.object({
  inProgress: z.boolean(),
  type: z.enum(['merge', 'apply', 'none']),
  headName: z.string().optional(), // original branch
  onto: z.string().optional(),
  currentStep: z.number().optional(),
  totalSteps: z.number().optional(),
});

export type RebaseState = z.infer<typeof RebaseStateSchema>;

// Diff stat for a file
export const DiffStatSchema = z.object({
  path: z.string(),
  additions: z.number(),
  deletions: z.number(),
  binary: z.boolean().optional(),
});

export type DiffStat = z.infer<typeof DiffStatSchema>;

// Main snapshot schema
export const SnapshotV1Schema = z.object({
  version: z.literal(1),
  timestamp: z.string().datetime(),
  platform: z.enum(['win32', 'darwin', 'linux']),
  repoRoot: z.string(),
  gitDir: z.string(),

  // Branch state
  branch: BranchInfoSchema,
  isDetachedHead: z.boolean(),

  // Rebase state
  rebaseState: RebaseStateSchema,

  // Working tree status
  unmergedFiles: z.array(UnmergedFileSchema).max(5), // increased for better conflict exploration
  stagedFiles: z.array(z.string()),
  modifiedFiles: z.array(z.string()),
  untrackedFiles: z.array(z.string()),

  // History
  recentLog: z.array(LogEntrySchema).max(30),
  recentReflog: z.array(ReflogEntrySchema).max(30),

  // NEW: Commit graph for history visualization
  commitGraph: z.string().optional(), // git log --graph --oneline output

  // NEW: Diff stats for file-level summary
  diffStats: z.array(DiffStatSchema).optional(),

  // NEW: Merge metadata
  mergeHead: z.string().optional(), // MERGE_HEAD commit if in merge
  mergeMessage: z.string().optional(), // Default merge commit message

  // Raw outputs for debugging
  rawStatus: z.string(),
  rawBranches: z.string(),
});

export type SnapshotV1 = z.infer<typeof SnapshotV1Schema>;
