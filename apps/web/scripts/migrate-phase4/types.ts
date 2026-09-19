import type { IncidentStatus, Prisma, PrismaClient } from '@prisma/client';

export const CHECKPOINT_ID = 'phase4_backfill_v1';
export const BATCH_SIZE = 200;
export const ADVISORY_LOCK_KEY = 'latchops_phase4_backfill';

export type BackfillErrorCode =
  | 'SIGNALS_INVALID'
  | 'PLAN_INVALID'
  | 'SNAPSHOT_INVALID'
  | 'TRACE_INVALID'
  | 'MISSING_FK'
  | 'ORPHAN_ANALYSIS';

export type JsonQuality = 'canonical' | 'recomputed' | 'unrecoverable';

export interface BackfillCliOptions {
  dryRun: boolean;
  apply: boolean;
  reconcile: boolean;
  reconcileOnly: boolean;
  resume: boolean;
  failFast: boolean;
  forceRepair: boolean;
  applySwitchConstraints: boolean;
  verbose: boolean;
  limit?: number;
  gitSessionId?: string;
}

export interface BackfillStats {
  ownedSessions: number;
  incidentsCreated: number;
  incidentsReused: number;
  snapshotsLinked: number;
  plansCreated: number;
  auditEventsCreated: number;
  verificationRunsCreated: number;
  recomputedJson: number;
  unrecoverable: number;
  skippedAnonymous: number;
  errors: number;
}

export function emptyStats(): BackfillStats {
  return {
    ownedSessions: 0,
    incidentsCreated: 0,
    incidentsReused: 0,
    snapshotsLinked: 0,
    plansCreated: 0,
    auditEventsCreated: 0,
    verificationRunsCreated: 0,
    recomputedJson: 0,
    unrecoverable: 0,
    skippedAnonymous: 0,
    errors: 0,
  };
}

export interface ReconcileCounts {
  ownedSessionsWithoutIncident: number;
  snapshotsMissingIncidentId: number;
  analysesMissingIncidentId: number;
  tracesMissingIncidentId: number;
  orphanSnapshots: number;
  planSnapshotOrgMismatch: number;
  incidentRepoOrgMismatch: number;
}

export function mapSessionStatus(status: string): IncidentStatus {
  if (status === 'ready') return 'plan_ready';
  return 'detected';
}

export type DbClient = Prisma.TransactionClient | PrismaClient;
