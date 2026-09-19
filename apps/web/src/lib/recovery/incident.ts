/**
 * Canonical incident payload for the incident room UI.
 * Prefers RecoveryPlanRecord + Incident; falls back to legacy Analysis JSON.
 */

import { VerificationResultV1Schema, type VerificationResultV1 } from '@latchops/schema';
import prisma from '@/lib/prisma';
import { analyzeSnapshot, parseSnapshot, safeParsePlan, safeParseSignals } from './pipeline';
import type { RecoveryPlanV1, RepoSignalsV1 } from '@latchops/schema';

export interface IncidentConflictFile {
  id: string;
  path: string;
  hunks: Array<{
    id: string;
    index: number;
    baseText: string;
    oursText: string;
    theirsText: string;
  }>;
}

export interface IncidentPayload {
  id: string;
  title: string | null;
  status: string;
  createdAt: string;
  incidentType: RepoSignalsV1['state'];
  risk: RecoveryPlanV1['risk'] | null;
  reasons: string[];
  summary: string | null;
  branch: { name: string | null; oid: string | null; isDetached: boolean };
  signals: RepoSignalsV1 | null;
  plan: RecoveryPlanV1 | null;
  conflicts: IncidentConflictFile[];
  verification: VerificationResultV1 | null;
  traces: Array<{
    id: string;
    stage: string;
    outputJson: unknown;
    durationMs: number | null;
    success: boolean;
    createdAt: string;
  }>;
  legacyGitSessionId?: string | null;
  organizationId?: string;
}

export async function loadIncidentPayload(incidentId: string): Promise<IncidentPayload | null> {
  const incident = await prisma.incident.findUnique({
    where: { id: incidentId },
    include: {
      snapshots: { orderBy: { createdAt: 'desc' }, take: 1 },
      recoveryPlans: { where: { isCurrent: true }, take: 1 },
      traces: { orderBy: { createdAt: 'asc' } },
      analyses: {
        orderBy: { createdAt: 'desc' },
        take: 1,
        include: {
          conflictFiles: { include: { hunks: { orderBy: { index: 'asc' } } } },
        },
      },
      verificationRuns: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  });
  if (!incident) return null;

  const snapshotRecord = incident.snapshots[0];
  const currentPlan = incident.recoveryPlans[0];
  const analysis = incident.analyses[0];

  let signals = currentPlan ? safeParseSignals(currentPlan.signalsJson) : analysis ? safeParseSignals(analysis.signalsJson) : null;
  let plan = currentPlan ? safeParsePlan(currentPlan.planJson) : analysis ? safeParsePlan(analysis.planJson) : null;

  if ((!signals || !plan) && snapshotRecord) {
    const snap = snapshotSafeParse(snapshotRecord.snapshotJson);
    if (snap) {
      const computed = analyzeSnapshot(snap);
      signals = signals ?? computed.signals;
      plan = plan ?? computed.plan;
    }
  }

  const conflicts: IncidentConflictFile[] = (analysis?.conflictFiles ?? []).map((f) => ({
    id: f.id,
    path: f.path,
    hunks: f.hunks.map((h) => ({
      id: h.id,
      index: h.index,
      baseText: h.baseText,
      oursText: h.oursText,
      theirsText: h.theirsText,
    })),
  }));

  return {
    id: incident.id,
    title: incident.title,
    status: incident.status,
    createdAt: incident.createdAt.toISOString(),
    incidentType: signals?.state ?? (incident.incidentType as RepoSignalsV1['state']) ?? 'unknown',
    risk: plan?.risk ?? (incident.risk as RecoveryPlanV1['risk'] | null) ?? null,
    reasons: signals?.reasons ?? [],
    summary: plan?.summary ?? incident.summary ?? analysis?.summary ?? null,
    branch: {
      name: signals?.branch.name ?? null,
      oid: signals?.branch.oid ?? null,
      isDetached: signals?.branch.isDetached ?? false,
    },
    signals,
    plan,
    conflicts,
    verification: latestVerification(incident),
    traces: incident.traces.map((t) => ({
      id: t.id,
      stage: t.stage,
      outputJson: t.outputJson,
      durationMs: t.durationMs,
      success: t.success,
      createdAt: t.createdAt.toISOString(),
    })),
    legacyGitSessionId: incident.legacyGitSessionId,
    organizationId: incident.organizationId,
  };
}

function latestVerification(incident: {
  verificationRuns: Array<{ resultJson: unknown }>;
  traces: Array<{ stage: string; outputJson: unknown; createdAt: Date }>;
}): VerificationResultV1 | null {
  for (const run of incident.verificationRuns) {
    const parsed = VerificationResultV1Schema.safeParse(run.resultJson);
    if (parsed.success) return parsed.data;
  }
  const verifyTraces = incident.traces
    .filter((t) => t.stage === 'verification_completed')
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const t of verifyTraces) {
    const parsed = VerificationResultV1Schema.safeParse(t.outputJson);
    if (parsed.success) return parsed.data;
  }
  return null;
}

function snapshotSafeParse(json: unknown) {
  try {
    return parseSnapshot(json);
  } catch {
    return null;
  }
}
