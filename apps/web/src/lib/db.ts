/**
 * Database operations using Prisma + Neon Postgres
 * Git Incident Room data layer
 */

import prisma from './prisma';
import type {
  GitSession,
  Snapshot,
  Analysis,
  ConflictFile,
  ConflictHunk,
  PlanStep,
  Trace,
  AuthenticationLog,
} from '@prisma/client';

// Re-export types
export type { GitSession, Snapshot, Analysis, ConflictFile, ConflictHunk, PlanStep, Trace, AuthenticationLog };

// ============================================
// GitSession Operations
// ============================================

export interface CreateSessionInput {
  title?: string | null;
  os?: string | null;
  repoRootHash?: string | null;
  userId?: string | null;
  status?: string;
}

export async function createSession(input: CreateSessionInput): Promise<GitSession> {
  return prisma.gitSession.create({
    data: {
      title: input.title,
      os: input.os,
      repoRootHash: input.repoRootHash,
      userId: input.userId,
      status: input.status ?? 'pending',
    },
  });
}

export async function getSession(id: string): Promise<GitSession | null> {
  return prisma.gitSession.findUnique({
    where: { id },
  });
}

export async function updateSessionStatus(id: string, status: string): Promise<GitSession> {
  return prisma.gitSession.update({
    where: { id },
    data: { status },
  });
}

export async function getSessionWithDetails(id: string) {
  return prisma.gitSession.findUnique({
    where: { id },
    include: {
      snapshots: {
        orderBy: { createdAt: 'desc' },
        take: 1,
      },
      analyses: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          conflictFiles: {
            include: {
              hunks: {
                orderBy: { index: 'asc' },
              },
            },
          },
          planSteps: {
            orderBy: { index: 'asc' },
          },
        },
      },
      traces: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

export async function getSessionFull(id: string) {
  return prisma.gitSession.findUnique({
    where: { id },
    include: {
      snapshots: {
        orderBy: { createdAt: 'desc' },
      },
      analyses: {
        orderBy: { createdAt: 'desc' },
        include: {
          conflictFiles: {
            include: {
              hunks: {
                orderBy: { index: 'asc' },
              },
            },
          },
          planSteps: {
            orderBy: { index: 'asc' },
          },
        },
      },
      traces: {
        orderBy: { createdAt: 'asc' },
      },
    },
  });
}

export async function getUserSessions(userId: string) {
  return prisma.gitSession.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    include: {
      analyses: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          issueType: true,
          summary: true,
        },
      },
      traces: {
        orderBy: { createdAt: 'asc' },
        select: {
          stage: true,
          outputJson: true,
          createdAt: true,
          success: true,
        },
      },
    },
  });
}

// ============================================
// Snapshot Operations
// ============================================

export interface CreateSnapshotInput {
  gitSessionId: string;
  snapshotJson: unknown;
  truncated?: boolean;
}

export async function createSnapshot(input: CreateSnapshotInput): Promise<Snapshot> {
  return prisma.snapshot.create({
    data: {
      gitSessionId: input.gitSessionId,
      snapshotJson: input.snapshotJson as object,
      truncated: input.truncated ?? false,
    },
  });
}

export async function getLatestSnapshot(gitSessionId: string): Promise<Snapshot | null> {
  return prisma.snapshot.findFirst({
    where: { gitSessionId },
    orderBy: { createdAt: 'desc' },
  });
}

// ============================================
// Analysis Operations
// ============================================

export interface CreateAnalysisInput {
  gitSessionId: string;
  snapshotId: string;
  issueType: string;
  summary?: string | null;
  repoGraphJson?: unknown;
}

export async function createAnalysis(input: CreateAnalysisInput): Promise<Analysis> {
  return prisma.analysis.create({
    data: {
      gitSessionId: input.gitSessionId,
      snapshotId: input.snapshotId,
      issueType: input.issueType,
      summary: input.summary,
      repoGraphJson: input.repoGraphJson as object | undefined,
    },
  });
}

export async function getLatestAnalysis(gitSessionId: string) {
  return prisma.analysis.findFirst({
    where: { gitSessionId },
    orderBy: { createdAt: 'desc' },
    include: {
      conflictFiles: {
        include: {
          hunks: {
            orderBy: { index: 'asc' },
          },
        },
      },
      planSteps: {
        orderBy: { index: 'asc' },
      },
    },
  });
}

export async function deleteAnalysisBySnapshotId(snapshotId: string): Promise<void> {
  await prisma.analysis.deleteMany({
    where: { snapshotId },
  });
}

// ============================================
// ConflictFile Operations
// ============================================

export interface CreateConflictFileInput {
  analysisId: string;
  path: string;
  highLevelSummary?: string | null;
}

export async function createConflictFile(input: CreateConflictFileInput): Promise<ConflictFile> {
  return prisma.conflictFile.create({
    data: {
      analysisId: input.analysisId,
      path: input.path,
      highLevelSummary: input.highLevelSummary,
    },
  });
}

// ============================================
// ConflictHunk Operations
// ============================================

export interface CreateConflictHunkInput {
  conflictFileId: string;
  index: number;
  startLine?: number | null;
  endLine?: number | null;
  baseText: string;
  oursText: string;
  theirsText: string;
  explanation?: string | null;
  suggestedChoice?: string | null;
  suggestedContent?: string | null;
}

export async function createConflictHunk(input: CreateConflictHunkInput): Promise<ConflictHunk> {
  return prisma.conflictHunk.create({
    data: {
      conflictFileId: input.conflictFileId,
      index: input.index,
      startLine: input.startLine,
      endLine: input.endLine,
      baseText: input.baseText,
      oursText: input.oursText,
      theirsText: input.theirsText,
      explanation: input.explanation,
      suggestedChoice: input.suggestedChoice,
      suggestedContent: input.suggestedContent,
    },
  });
}

export async function updateHunkChoice(
  hunkId: string,
  userChoice: string,
  userContent?: string | null
): Promise<ConflictHunk> {
  return prisma.conflictHunk.update({
    where: { id: hunkId },
    data: {
      userChoice,
      userContent,
    },
  });
}

// ============================================
// PlanStep Operations
// ============================================

export interface CreatePlanStepInput {
  analysisId: string;
  index: number;
  title: string;
  rationale?: string | null;
  commandsJson: unknown;
  verifyJson: unknown;
  undoJson: unknown;
  dangerLevel?: string;
}

export async function createPlanStep(input: CreatePlanStepInput): Promise<PlanStep> {
  return prisma.planStep.create({
    data: {
      analysisId: input.analysisId,
      index: input.index,
      title: input.title,
      rationale: input.rationale,
      commandsJson: input.commandsJson as object,
      verifyJson: input.verifyJson as object,
      undoJson: input.undoJson as object,
      dangerLevel: input.dangerLevel ?? 'safe',
    },
  });
}

export async function updatePlanStepStatus(
  stepId: string,
  status: string,
  userConfirmed?: boolean
): Promise<PlanStep> {
  return prisma.planStep.update({
    where: { id: stepId },
    data: {
      status,
      completedAt: status === 'completed' ? new Date() : undefined,
      userConfirmed,
    },
  });
}

// ============================================
// Trace Operations (Recovery Pipeline)
// ============================================

export interface CreateTraceInput {
  gitSessionId: string;
  stage: string;
  snapshotId?: string | null;
  inputJson?: unknown;
  outputJson?: unknown;
  durationMs?: number | null;
  success?: boolean;
  errorMessage?: string | null;
}

export async function createTrace(input: CreateTraceInput): Promise<Trace> {
  return prisma.trace.create({
    data: {
      gitSessionId: input.gitSessionId,
      stage: input.stage,
      snapshotId: input.snapshotId,
      inputJson: input.inputJson as object | undefined,
      outputJson: input.outputJson as object | undefined,
      durationMs: input.durationMs,
      success: input.success ?? true,
      errorMessage: input.errorMessage,
    },
  });
}

export async function getTraces(gitSessionId: string): Promise<Trace[]> {
  return prisma.trace.findMany({
    where: { gitSessionId },
    orderBy: { createdAt: 'asc' },
  });
}

export async function saveTrace(
  gitSessionId: string,
  stage: string,
  snapshotId: string | null,
  input: unknown,
  output: unknown,
  startTime?: number,
  success: boolean = true,
  errorMessage?: string
): Promise<Trace> {
  const durationMs = startTime ? Date.now() - startTime : undefined;
  return createTrace({
    gitSessionId,
    stage,
    snapshotId,
    inputJson: input,
    outputJson: output,
    durationMs,
    success,
    errorMessage,
  });
}

// ============================================
// Event Operations (Analytics/Audit)
// ============================================

export interface CreateEventInput {
  type: string;
  userId?: string | null;
  gitSessionId?: string | null;
  metadata?: unknown;
}

export async function createEvent(input: CreateEventInput) {
  return prisma.event.create({
    data: {
      type: input.type,
      userId: input.userId,
      gitSessionId: input.gitSessionId,
      metadata: input.metadata as object | undefined,
    },
  });
}

// ============================================
// Authentication Log Operations
// ============================================

export interface CreateAuthLogInput {
  userId?: string | null;
  action: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  success: boolean;
  failureReason?: string | null;
}

export async function createAuthLog(input: CreateAuthLogInput): Promise<AuthenticationLog> {
  return prisma.authenticationLog.create({
    data: {
      userId: input.userId,
      action: input.action,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      success: input.success,
      failureReason: input.failureReason,
    },
  });
}

export async function getUserAuthLogs(userId: string, limit: number = 50): Promise<AuthenticationLog[]> {
  return prisma.authenticationLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

/**
 * Extract client IP address from request headers
 * Handles proxied requests (X-Forwarded-For, X-Real-IP)
 */
export function extractClientIp(headers: Headers): string | null {
  // Check X-Forwarded-For (may have multiple IPs)
  const forwardedFor = headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  // Check X-Real-IP
  const realIp = headers.get('x-real-ip');
  if (realIp) {
    return realIp;
  }
  return null;
}

// ============================================
// Utility Functions
// ============================================

export async function checkConnection(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
