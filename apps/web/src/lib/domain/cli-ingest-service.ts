import type { SnapshotV1 } from '@latchops/schema';
import type { Prisma } from '@prisma/client';
import prisma from '../prisma';
import { analyzeSnapshot, generateTitle, parseSnapshot } from '../recovery/core';
import { recordAuthoritative } from './audit-service';
import type { CliAuthContext } from './cli-credential-service';
import {
  assertIdempotencyOrThrow,
  createIdempotencyRecordInTx,
  hashRequestBody,
} from './idempotency-service';
import { assertOrgWritable } from './organization-service';
import { upsertRepositoryInTx } from './repository-service';
import { getIncident } from './incident-service';

export interface CliIngestInput {
  auth: CliAuthContext;
  rawSnapshot: unknown;
  idempotencyKey: string;
  requestBodyForHash: unknown;
}

export interface CliIngestResult {
  incidentId: string;
  repositoryId: string;
  organizationId: string;
  lifecycleStatus: string;
  incidentType: string;
  summary: string;
  risk: string;
  replayed: boolean;
  legacySessionId?: string | null;
}

async function persistPlanInTx(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    incidentId: string;
    sourceSnapshotId: string;
    signals: ReturnType<typeof analyzeSnapshot>['signals'];
    plan: ReturnType<typeof analyzeSnapshot>['plan'];
    incomplete?: boolean;
  },
) {
  await tx.recoveryPlanRecord.updateMany({
    where: { incidentId: params.incidentId, organizationId: params.organizationId, isCurrent: true },
    data: { isCurrent: false },
  });
  await tx.recoveryPlanRecord.create({
    data: {
      incidentId: params.incidentId,
      organizationId: params.organizationId,
      sourceSnapshotId: params.sourceSnapshotId,
      version: 1,
      isCurrent: true,
      signalsJson: params.signals as Prisma.InputJsonValue,
      planJson: params.plan as Prisma.InputJsonValue,
      incidentType: params.signals.state,
      summary: params.plan.summary,
      risk: params.plan.risk,
      engineVersion: params.plan.engineVersion,
      incomplete: params.incomplete ?? false,
    },
  });
}

async function ingestNewIncident(
  tx: Prisma.TransactionClient,
  params: {
    organizationId: string;
    snapshot: SnapshotV1;
    credentialId: string;
  },
) {
  const repository = await upsertRepositoryInTx(tx, params.organizationId, params.snapshot);
  const { signals, plan } = analyzeSnapshot(params.snapshot);
  const incomplete = plan.incomplete;

  const incident = await tx.incident.create({
    data: {
      organizationId: params.organizationId,
      repositoryId: repository.id,
      title: generateTitle(params.snapshot),
      status: incomplete ? 'detected' : 'plan_ready',
      source: 'cli',
      incidentType: signals.state,
      risk: plan.risk,
      summary: plan.summary,
      engineVersion: plan.engineVersion,
    },
  });

  const snapshotRecord = await tx.snapshot.create({
    data: {
      incidentId: incident.id,
      snapshotJson: params.snapshot,
      kind: 'capture',
      sequence: 1,
    },
  });

  await persistPlanInTx(tx, {
    organizationId: params.organizationId,
    incidentId: incident.id,
    sourceSnapshotId: snapshotRecord.id,
    signals,
    plan,
    incomplete,
  });

  await recordAuthoritative(tx, {
    organizationId: params.organizationId,
    incidentId: incident.id,
    actorType: 'cli',
    action: 'incident.ingested',
    payload: { source: 'cli', credentialId: params.credentialId },
  });

  return { incident, repository, signals, plan };
}

export async function ingestCliIncident(input: CliIngestInput): Promise<CliIngestResult> {
  const { auth, idempotencyKey } = input;
  await assertOrgWritable(auth.organizationId);

  const requestHash = hashRequestBody(input.requestBodyForHash);
  const idem = await assertIdempotencyOrThrow({
    organizationId: auth.organizationId,
    key: idempotencyKey,
    requestHash,
  });

  if (idem.replay) {
    const existing = await getIncident(auth.organizationId, idem.incidentId);
    if (!existing) {
      throw new Error('Idempotency record points to missing incident');
    }
    return {
      incidentId: existing.id,
      repositoryId: existing.repositoryId,
      organizationId: auth.organizationId,
      lifecycleStatus: existing.status,
      incidentType: existing.incidentType,
      summary: existing.summary ?? '',
      risk: existing.risk ?? 'none',
      replayed: true,
      legacySessionId: existing.legacyGitSessionId,
    };
  }

  const snapshot = parseSnapshot(input.rawSnapshot);

  const created = await prisma.$transaction(async (tx) => {
    const result = await ingestNewIncident(tx, {
      organizationId: auth.organizationId,
      snapshot,
      credentialId: auth.credentialId,
    });

    await createIdempotencyRecordInTx(tx, {
      organizationId: auth.organizationId,
      key: idempotencyKey,
      requestHash,
      incidentId: result.incident.id,
    });

    return result;
  });

  return {
    incidentId: created.incident.id,
    repositoryId: created.repository.id,
    organizationId: auth.organizationId,
    lifecycleStatus: created.incident.status,
    incidentType: created.signals.state,
    summary: created.plan.summary,
    risk: created.plan.risk,
    replayed: false,
    legacySessionId: created.incident.legacyGitSessionId,
  };
}
