import { randomUUID } from 'node:crypto';
import { SnapshotV1Schema, type RecoveryPlanV1, type RepoSignalsV1 } from '@latchops/schema';
import { generateRecoveryPlan } from '@latchops/recovery-engine';
import { computeRepoSignals } from '@latchops/state-engine';
import { appendAudit, verifyAuditChain } from './audit';
import { APPROVAL_TTL_MS, authorizeExecution, canApprove, type DecisionLike } from './authorize';
import { canonicalJson } from './canonical';
import { reviewDb } from './db';
import { buildEvidence } from './evidence';
import { captureState, createReviewWorkspace, executeAuthorized, materializeRepo, type IsolatedRunResult } from './isolated';
import { KNOWLEDGE_BASE } from './knowledge';
import { defaultProvider, type LlmProvider } from './llm';
import { buildPrompt } from './prompt';
import { detectSecrets, redactText } from './redact';
import { getScenario } from './scenarios';
import {
  REVIEW_INCIDENT_TYPE,
  type EvidenceSnapshot,
  type ExplanationMode,
  type RedactionReport,
  type ReviewActor,
  type ValidationReport,
} from './types';
import { emptyReport, validateExplanation } from './validate';

export class ReviewError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export interface ServiceDeps {
  provider?: LlmProvider;
  now?: () => Date;
  /** Test seam. Runs after the single-use reservation and before isolated Git work. */
  beforeIsolate?: () => Promise<void>;
  /** Test seam. Runs after authorized commands return and before the result is saved. */
  beforePersist?: () => Promise<void>;
}

function requireActor(actor: ReviewActor | null, roles: ReviewActor['role'][]): ReviewActor {
  if (!actor) throw new ReviewError('A valid actor token is required', 401);
  if (!roles.includes(actor.role)) throw new ReviewError(`Role "${actor.role}" is not allowed to do this`, 403);
  return actor;
}

const MAX_RAW_OUTPUT_CHARS = 20_000;

const newId = (prefix: string) => `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 16)}`;

async function persistIncident(input: {
  actor: ReviewActor;
  source: 'scenario' | 'cli_import';
  scenarioId: string | null;
  title: string;
  signals: RepoSignalsV1;
  plan: RecoveryPlanV1;
  built: ReturnType<typeof buildEvidence>;
}): Promise<string> {
  const db = await reviewDb();
  const incidentId = newId('inc');
  const snapshotId = newId('snap');
  await db.$transaction(async (tx) => {
    await tx.reviewIncident.create({
      data: {
        id: incidentId,
        source: input.source,
        scenarioId: input.scenarioId,
        title: input.title,
        incidentType: input.signals.state,
        requestedBy: input.actor.id,
      },
    });
    await tx.evidenceSnapshotRecord.create({
      data: {
        id: snapshotId,
        incidentId,
        evidenceHash: input.built.evidenceHash,
        planHash: input.built.planHash,
        evidenceJson: canonicalJson(input.built.evidence),
        planJson: canonicalJson(input.plan),
        signalsJson: canonicalJson(input.signals),
        redactionJson: canonicalJson(input.built.redaction),
        truncated: input.built.evidence.truncated,
      },
    });
    await appendAudit(tx, {
      incidentId,
      actorId: input.actor.id,
      action: 'incident.created',
      payload: { source: input.source, scenarioId: input.scenarioId, incidentType: input.signals.state },
    });
    await appendAudit(tx, {
      incidentId,
      actorId: input.actor.id,
      action: 'evidence.captured',
      payload: {
        snapshotId,
        evidenceHash: input.built.evidenceHash,
        planHash: input.built.planHash,
        items: input.built.evidence.items.length,
        redactions: input.built.redaction.totalRedactions,
        verifiedClean: input.built.redaction.verifiedClean,
      },
    });
  });
  return incidentId;
}

function assertInScope(signals: RepoSignalsV1): void {
  if (signals.state !== REVIEW_INCIDENT_TYPE) {
    throw new ReviewError(
      `Recovery Review handles only ${REVIEW_INCIDENT_TYPE} incidents; this snapshot is ${signals.state}.`,
      422,
    );
  }
}

export async function createScenarioReview(actorIn: ReviewActor | null, scenarioId: string): Promise<string> {
  const actor = requireActor(actorIn, ['requester', 'approver']);
  const scenario = getScenario(scenarioId);
  if (!scenario) throw new ReviewError(`Unknown scenario ${scenarioId}`, 404);
  const ws = createReviewWorkspace();
  try {
    await materializeRepo(ws, scenario.repo);
    const { snapshot, signals, plan } = await captureState(ws);
    assertInScope(signals);
    const built = buildEvidence({ snapshot, signals, plan });
    return await persistIncident({
      actor,
      source: 'scenario',
      scenarioId: scenario.id,
      title: `${scenario.id} · ${scenario.title}`,
      signals,
      plan,
      built,
    });
  } finally {
    await ws.dispose();
  }
}

/** Accepts `latchops snapshot --json` output. Read-only: no repository access. */
export async function importCliSnapshot(actorIn: ReviewActor | null, raw: unknown, title?: string): Promise<string> {
  const actor = requireActor(actorIn, ['requester', 'approver']);
  const parsed = SnapshotV1Schema.safeParse(raw);
  if (!parsed.success) throw new ReviewError('Not a valid LatchOps SnapshotV1 (run `latchops snapshot --json`)', 400);
  const snapshot = parsed.data;
  const signals = computeRepoSignals(snapshot);
  assertInScope(signals);
  const plan = generateRecoveryPlan({ snapshot, signals });
  const built = buildEvidence({ snapshot, signals, plan });
  return persistIncident({
    actor,
    source: 'cli_import',
    scenarioId: null,
    title: (title?.trim() || `CLI import · ${signals.branch.name ?? 'detached'}`).slice(0, 120),
    signals,
    plan,
    built,
  });
}

async function latestSnapshot(incidentId: string) {
  const db = await reviewDb();
  const snapshot = await db.evidenceSnapshotRecord.findFirst({ where: { incidentId }, orderBy: { createdAt: 'desc' } });
  if (!snapshot) throw new ReviewError('Incident not found', 404);
  return snapshot;
}

export async function grantConsent(actorIn: ReviewActor | null, incidentId: string, provider: string): Promise<void> {
  const actor = requireActor(actorIn, ['requester', 'approver']);
  const snapshot = await latestSnapshot(incidentId);
  const db = await reviewDb();
  await db.$transaction(async (tx) => {
    await tx.consentRecord.create({
      data: {
        id: newId('consent'),
        incidentId,
        snapshotId: snapshot.id,
        evidenceHash: snapshot.evidenceHash,
        actorId: actor.id,
        provider,
        scope: 'redacted_evidence_only',
      },
    });
    await appendAudit(tx, {
      incidentId,
      actorId: actor.id,
      action: 'consent.granted',
      payload: { provider, evidenceHash: snapshot.evidenceHash, scope: 'redacted_evidence_only' },
    });
  });
}

export async function revokeConsent(actorIn: ReviewActor | null, incidentId: string): Promise<void> {
  const actor = requireActor(actorIn, ['requester', 'approver']);
  const db = await reviewDb();
  await db.$transaction(async (tx) => {
    const { count } = await tx.consentRecord.updateMany({
      where: { incidentId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await appendAudit(tx, { incidentId, actorId: actor.id, action: 'consent.revoked', payload: { count } });
  });
}

export interface ExplanationOutcome {
  id: string;
  status: 'accepted' | 'rejected' | 'error';
  report: ValidationReport;
}

export async function generateExplanation(
  actorIn: ReviewActor | null,
  incidentId: string,
  mode: ExplanationMode,
  deps: ServiceDeps = {},
): Promise<ExplanationOutcome> {
  const actor = requireActor(actorIn, ['requester', 'approver']);
  const provider = deps.provider ?? defaultProvider();
  const snapshot = await latestSnapshot(incidentId);
  const db = await reviewDb();

  const consent = await db.consentRecord.findFirst({
    where: { incidentId, evidenceHash: snapshot.evidenceHash, provider: provider.id, revokedAt: null },
  });
  if (!consent) {
    await db.$transaction((tx) =>
      appendAudit(tx, {
        incidentId,
        actorId: actor.id,
        action: 'explanation.blocked',
        payload: { reason: 'no active consent for this evidence and provider', provider: provider.id },
      }),
    );
    throw new ReviewError(`No active consent to send redacted evidence to "${provider.id}"`, 409);
  }

  const evidence = JSON.parse(snapshot.evidenceJson) as EvidenceSnapshot;
  const plan = JSON.parse(snapshot.planJson) as RecoveryPlanV1;
  const signals = JSON.parse(snapshot.signalsJson) as RepoSignalsV1;
  const prompt = buildPrompt(evidence.items, mode);

  const residual = detectSecrets(prompt.user);
  if (residual.length > 0) {
    await db.$transaction((tx) =>
      appendAudit(tx, { incidentId, actorId: actor.id, action: 'explanation.blocked', payload: { reason: 'secret detected in prompt', types: residual } }),
    );
    throw new ReviewError('Prompt still contains secret-like values; refusing to call the model', 422);
  }

  let status: ExplanationOutcome['status'] = 'error';
  let report: ValidationReport;
  let outputJson: string | null = null;
  let rawOutput: string | null = null;
  let promptTokens: number | null = null;
  let outputTokens: number | null = null;
  let latencyMs: number | null = null;
  let errorMessage: string | null = null;
  try {
    const result = await provider.complete(prompt);
    promptTokens = result.promptTokens;
    outputTokens = result.outputTokens;
    latencyMs = result.latencyMs;
    rawOutput = redactText(result.raw.slice(0, MAX_RAW_OUTPUT_CHARS)).text;
    const validated = validateExplanation(result.raw, { prompt, items: evidence.items, knowledge: KNOWLEDGE_BASE, plan, signals });
    report = validated.report;
    status = report.status;
    outputJson = validated.output ? canonicalJson(validated.output) : null;
  } catch (error) {
    errorMessage = error instanceof Error ? error.message.slice(0, 300) : 'model call failed';
    report = emptyReport(`model call failed: ${errorMessage}`);
  }

  const id = newId('expl');
  await db.$transaction(async (tx) => {
    await tx.explanationRecord.create({
      data: {
        id,
        incidentId,
        snapshotId: snapshot.id,
        evidenceHash: snapshot.evidenceHash,
        mode,
        provider: provider.id,
        model: provider.model,
        status,
        outputJson,
        rawOutput,
        validationJson: canonicalJson(report),
        retrievedIds: JSON.stringify(prompt.contextIds),
        promptTokens,
        outputTokens,
        latencyMs,
        errorMessage,
      },
    });
    if (status === 'accepted') {
      await tx.reviewIncident.updateMany({ where: { id: incidentId, status: 'evidence_ready' }, data: { status: 'explained' } });
    }
    await appendAudit(tx, {
      incidentId,
      actorId: actor.id,
      action: `explanation.${status}`,
      payload: {
        explanationId: id,
        mode,
        provider: provider.id,
        model: provider.model,
        contextIds: prompt.contextIds,
        unsupportedKeyClaims: report.unsupportedKeyClaims,
        rejectionReasons: report.rejectionReasons,
      },
    });
  });
  return { id, status, report };
}

export async function recordDecision(
  actorIn: ReviewActor | null,
  incidentId: string,
  input: { decision: unknown; alternativeId?: unknown; reason?: unknown; explanationId?: unknown },
  deps: ServiceDeps = {},
): Promise<string> {
  const db = await reviewDb();
  const incident = await db.reviewIncident.findUnique({ where: { id: incidentId } });
  if (!incident) throw new ReviewError('Incident not found', 404);
  const refusal = canApprove(actorIn, incident.requestedBy);
  if (refusal || !actorIn) {
    await db.$transaction((tx) =>
      appendAudit(tx, { incidentId, actorId: actorIn?.id ?? 'anonymous', action: 'decision.refused', payload: { reason: refusal } }),
    );
    throw new ReviewError(refusal ?? 'unauthenticated', actorIn ? 403 : 401);
  }
  const actor = actorIn;
  if (input.decision !== 'approve' && input.decision !== 'reject') throw new ReviewError('decision must be approve or reject', 400);
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < 5) throw new ReviewError('A written reason (at least 5 characters) is required', 400);

  const snapshot = await latestSnapshot(incidentId);
  const plan = JSON.parse(snapshot.planJson) as RecoveryPlanV1;
  const alternativeId = typeof input.alternativeId === 'string' ? input.alternativeId : null;
  if (input.decision === 'approve' && !plan.alternatives.some((alt) => alt.id === alternativeId)) {
    throw new ReviewError('Approval must name one of the deterministic plan alternatives', 400);
  }
  const explanationId = typeof input.explanationId === 'string' ? input.explanationId : null;

  const now = deps.now?.() ?? new Date();
  const id = newId('dec');
  await db.$transaction(async (tx) => {
    await tx.decisionRecord.create({
      data: {
        id,
        incidentId,
        snapshotId: snapshot.id,
        evidenceHash: snapshot.evidenceHash,
        planHash: snapshot.planHash,
        decision: input.decision as string,
        selectedAlternativeId: input.decision === 'approve' ? alternativeId : null,
        actorId: actor.id,
        actorRole: actor.role,
        reason: reason.slice(0, 1000),
        explanationId,
        createdAt: now,
        expiresAt: new Date(now.getTime() + APPROVAL_TTL_MS),
      },
    });
    await tx.reviewIncident.update({
      where: { id: incidentId },
      data: { status: input.decision === 'approve' ? 'approved' : 'rejected' },
    });
    await appendAudit(tx, {
      incidentId,
      actorId: actor.id,
      action: `decision.${input.decision as string}`,
      payload: { decisionId: id, alternativeId, evidenceHash: snapshot.evidenceHash, planHash: snapshot.planHash, explanationId, reason },
    });
  });
  return id;
}

const RESERVED_STATUS = 'executing';

/**
 * Compare-and-set the incident to `executing` before any isolated Git work.
 * A second caller loses this update and must not run commands.
 */
async function reserveExecution(incidentId: string): Promise<{ ok: true; previousStatus: string } | { ok: false; reason: string }> {
  const db = await reviewDb();
  return db.$transaction(async (tx) => {
    const incident = await tx.reviewIncident.findUnique({ where: { id: incidentId } });
    if (!incident) return { ok: false, reason: 'Incident not found' };
    if (incident.status === 'executed') return { ok: false, reason: 'this approval was already used for an execution' };
    if (incident.status === RESERVED_STATUS) return { ok: false, reason: 'an execution is already in progress' };
    const prior = await tx.executionRecord.findFirst({ where: { incidentId, authorized: true } });
    if (prior) return { ok: false, reason: 'this approval was already used for an execution' };
    const { count } = await tx.reviewIncident.updateMany({
      where: { id: incidentId, status: incident.status },
      data: { status: RESERVED_STATUS },
    });
    if (count !== 1) return { ok: false, reason: 'an execution is already in progress' };
    return { ok: true, previousStatus: incident.status };
  });
}

async function releaseExecution(incidentId: string, previousStatus: string): Promise<void> {
  const db = await reviewDb();
  await db.reviewIncident.updateMany({
    where: { id: incidentId, status: RESERVED_STATUS },
    data: { status: previousStatus },
  });
}

export async function executeReview(
  actorIn: ReviewActor | null,
  incidentId: string,
  deps: ServiceDeps = {},
) {
  const db = await reviewDb();
  const incident = await db.reviewIncident.findUnique({ where: { id: incidentId } });
  if (!incident) throw new ReviewError('Incident not found', 404);
  const reservation = await reserveExecution(incidentId);
  if (!reservation.ok) {
    await db.$transaction((tx) =>
      appendAudit(tx, {
        incidentId,
        actorId: actorIn?.id ?? 'anonymous',
        action: 'execution.denied',
        payload: { reason: reservation.reason },
      }),
    );
    return { id: null, authorized: false, verdict: 'BLOCKED' as const, reasons: [reservation.reason], result: null };
  }

  const snapshot = await latestSnapshot(incidentId);
  const plan = JSON.parse(snapshot.planJson) as RecoveryPlanV1;
  const decisions = (await db.decisionRecord.findMany({ where: { incidentId } })).map(
    (d): DecisionLike => ({ ...d, decision: d.decision as DecisionLike['decision'] }),
  );
  const priorExecution = await db.executionRecord.findFirst({ where: { incidentId, authorized: true } });
  const latest = [...decisions].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const alternativeId = latest?.selectedAlternativeId ?? 'complete_merge';
  const scenario = incident.scenarioId ? getScenario(incident.scenarioId) : null;
  const now = deps.now?.() ?? new Date();
  const ws = scenario ? createReviewWorkspace() : null;
  let consumed = false;
  let commandsStarted = false;

  try {
    if (deps.beforeIsolate) await deps.beforeIsolate();
    let currentEvidenceHash: string | null = null;
    let before: RepoSignalsV1 | null = null;
    if (ws && scenario) {
      await materializeRepo(ws, scenario.repo, { drift: true });
      const state = await captureState(ws);
      before = state.signals;
      currentEvidenceHash = buildEvidence(state).evidenceHash;
    }

    const auth = authorizeExecution({
      actor: actorIn,
      incident: {
        incidentType: incident.incidentType,
        requestedBy: incident.requestedBy,
        source: incident.source,
        executed: Boolean(priorExecution),
      },
      approvedSnapshot: { evidenceHash: snapshot.evidenceHash, planHash: snapshot.planHash },
      plan,
      currentEvidenceHash,
      coverage: (JSON.parse(snapshot.evidenceJson) as EvidenceSnapshot).coverage ?? { rawUnmerged: 0, captured: 0 },
      decisions,
      requestedAlternativeId: alternativeId,
      now,
    });

    let result: IsolatedRunResult | null = null;
    if (auth.allowed && ws && scenario && before) {
      commandsStarted = true;
      result = await executeAuthorized({ ws, plan, alternativeId, auth, before, resolution: scenario.repo.resolution });
    }
    if (deps.beforePersist) await deps.beforePersist();
    const verdict = result?.verdict ?? 'BLOCKED';
    const id = newId('exec');
    await db.$transaction(async (tx) => {
      await tx.executionRecord.create({
        data: {
          id,
          incidentId,
          decisionId: auth.decisionId,
          actorId: actorIn?.id ?? 'anonymous',
          authorized: auth.allowed,
          authJson: canonicalJson({ ...auth, currentEvidenceHash }),
          verdict,
          resultJson: result ? canonicalJson(result) : null,
        },
      });
      await tx.reviewIncident.updateMany({
        where: { id: incidentId, status: RESERVED_STATUS },
        data: { status: auth.allowed ? 'executed' : reservation.previousStatus },
      });
      await appendAudit(tx, {
        incidentId,
        actorId: actorIn?.id ?? 'anonymous',
        action: auth.allowed ? 'execution.completed' : 'execution.denied',
        payload: { executionId: id, verdict, reasons: auth.allowed ? result?.reasons : auth.reasons, alternativeId },
      });
    });
    consumed = true;
    return { id, authorized: auth.allowed, verdict, reasons: auth.allowed ? (result?.reasons ?? []) : auth.reasons, result };
  } catch (error) {
    // Commands in the throwaway repo cannot be undone. Keep the reservation so the approval cannot run again.
    if (!consumed && !commandsStarted) await releaseExecution(incidentId, reservation.previousStatus);
    await db.$transaction((tx) =>
      appendAudit(tx, {
        incidentId,
        actorId: actorIn?.id ?? 'anonymous',
        action: 'execution.failed',
        payload: { message: error instanceof Error ? error.message.slice(0, 300) : 'execution failed' },
      }),
    );
    throw error;
  } finally {
    await ws?.dispose();
  }
}

export async function listReviews() {
  const db = await reviewDb();
  return db.reviewIncident.findMany({ orderBy: { createdAt: 'desc' }, take: 50 });
}

export async function getReview(incidentId: string) {
  const db = await reviewDb();
  const incident = await db.reviewIncident.findUnique({
    where: { id: incidentId },
    include: {
      snapshots: { orderBy: { createdAt: 'desc' } },
      consents: { orderBy: { grantedAt: 'desc' } },
      explanations: { orderBy: { createdAt: 'desc' } },
      decisions: { orderBy: { createdAt: 'desc' } },
      executions: { orderBy: { createdAt: 'desc' } },
      audit: { orderBy: { seq: 'asc' } },
    },
  });
  if (!incident) throw new ReviewError('Incident not found', 404);
  const snapshot = incident.snapshots[0];
  const chain = await verifyAuditChain(db, incidentId);
  return {
    incident: {
      id: incident.id,
      title: incident.title,
      source: incident.source,
      scenarioId: incident.scenarioId,
      incidentType: incident.incidentType,
      requestedBy: incident.requestedBy,
      status: incident.status,
      createdAt: incident.createdAt.toISOString(),
    },
    snapshot: {
      id: snapshot.id,
      evidenceHash: snapshot.evidenceHash,
      planHash: snapshot.planHash,
      evidence: JSON.parse(snapshot.evidenceJson) as EvidenceSnapshot,
      plan: JSON.parse(snapshot.planJson) as RecoveryPlanV1,
      signals: JSON.parse(snapshot.signalsJson) as RepoSignalsV1,
      redaction: JSON.parse(snapshot.redactionJson) as RedactionReport,
    },
    consents: incident.consents.map((c) => ({
      id: c.id,
      provider: c.provider,
      actorId: c.actorId,
      evidenceHash: c.evidenceHash,
      grantedAt: c.grantedAt.toISOString(),
      revokedAt: c.revokedAt?.toISOString() ?? null,
    })),
    explanations: incident.explanations.map((e) => ({
      id: e.id,
      mode: e.mode,
      provider: e.provider,
      model: e.model,
      status: e.status,
      output: e.outputJson ? JSON.parse(e.outputJson) : null,
      rawOutput: e.rawOutput,
      validation: JSON.parse(e.validationJson) as ValidationReport,
      contextIds: JSON.parse(e.retrievedIds) as string[],
      promptTokens: e.promptTokens,
      outputTokens: e.outputTokens,
      latencyMs: e.latencyMs,
      errorMessage: e.errorMessage,
      createdAt: e.createdAt.toISOString(),
    })),
    decisions: incident.decisions.map((d) => ({
      id: d.id,
      decision: d.decision,
      selectedAlternativeId: d.selectedAlternativeId,
      actorId: d.actorId,
      actorRole: d.actorRole,
      reason: d.reason,
      explanationId: d.explanationId,
      evidenceHash: d.evidenceHash,
      createdAt: d.createdAt.toISOString(),
      expiresAt: d.expiresAt.toISOString(),
    })),
    executions: incident.executions.map((x) => ({
      id: x.id,
      actorId: x.actorId,
      authorized: x.authorized,
      verdict: x.verdict,
      auth: JSON.parse(x.authJson),
      result: x.resultJson ? JSON.parse(x.resultJson) : null,
      createdAt: x.createdAt.toISOString(),
    })),
    audit: incident.audit.map((a) => ({
      seq: a.seq,
      at: a.at.toISOString(),
      actorId: a.actorId,
      action: a.action,
      payload: JSON.parse(a.payload),
      hash: a.hash,
      prevHash: a.prevHash,
    })),
    chain,
  };
}

export type ReviewDetail = Awaited<ReturnType<typeof getReview>>;
