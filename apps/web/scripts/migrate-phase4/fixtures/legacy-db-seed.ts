import type { PrismaClient } from '@prisma/client';
import { analyzeSnapshot } from '../../../src/lib/recovery/core';
import { sampleSnapshot } from '../../../src/lib/test-support/fixtures';

export async function seedLegacyPhase3Fixture(prisma: PrismaClient) {
  const owner = await prisma.user.create({
    data: { email: 'owner-4d@test.local', name: 'Owner' },
  });
  const other = await prisma.user.create({
    data: { email: 'other-4d@test.local', name: 'Other' },
  });

  const snapA = sampleSnapshot({ repoRoot: '/tmp/repo-a', remotes: [{ name: 'origin', url: 'https://github.com/acme/a.git' }] });
  const snapB = sampleSnapshot({ repoRoot: '/tmp/repo-b', remotes: [{ name: 'origin', url: 'https://github.com/acme/b.git' }] });
  const snapC = sampleSnapshot({ repoRoot: '/tmp/repo-c', remotes: [{ name: 'origin', url: 'https://github.com/acme/c.git' }] });
  const analyzedA = analyzeSnapshot(snapA);
  const analyzedB = analyzeSnapshot(snapB);

  const sessionReady = await createOwnedSession(prisma, {
    userId: owner.id,
    title: 'ready session',
    status: 'ready',
    snapshot: snapA,
    signals: analyzedA.signals,
    plan: analyzedA.plan,
    withVerification: true,
  });

  const sessionPending = await createOwnedSession(prisma, {
    userId: owner.id,
    title: 'pending session',
    status: 'pending',
    snapshot: snapB,
    signals: analyzedB.signals,
    plan: analyzedB.plan,
  });

  const sessionCorrupt = await prisma.gitSession.create({
    data: {
      userId: owner.id,
      title: 'corrupt session',
      status: 'error',
      repoRootHash: 'deadbeef',
    },
  });
  const corruptSnapshot = await prisma.snapshot.create({
    data: {
      gitSessionId: sessionCorrupt.id,
      snapshotJson: { not: 'a-snapshot' },
    },
  });
  await prisma.analysis.create({
    data: {
      gitSessionId: sessionCorrupt.id,
      snapshotId: corruptSnapshot.id,
      issueType: 'unknown',
      signalsJson: { invalid: true },
      planJson: { invalid: true },
    },
  });

  const anonymous = await prisma.gitSession.create({
    data: {
      userId: null,
      title: 'anonymous',
      status: 'ready',
    },
  });
  await prisma.snapshot.create({
    data: {
      gitSessionId: anonymous.id,
      snapshotJson: snapC as object,
    },
  });

  return {
    owner,
    other,
    sessionReady,
    sessionPending,
    sessionCorrupt,
    anonymous,
    snapC,
  };
}

async function createOwnedSession(
  prisma: PrismaClient,
  params: {
    userId: string;
    title: string;
    status: string;
    snapshot: ReturnType<typeof sampleSnapshot>;
    signals: ReturnType<typeof analyzeSnapshot>['signals'];
    plan: ReturnType<typeof analyzeSnapshot>['plan'];
    withVerification?: boolean;
  },
) {
  const session = await prisma.gitSession.create({
    data: {
      userId: params.userId,
      title: params.title,
      status: params.status,
      repoRootHash: 'hash-' + params.title,
    },
  });
  const snapshot = await prisma.snapshot.create({
    data: {
      gitSessionId: session.id,
      snapshotJson: params.snapshot as object,
    },
  });
  await prisma.analysis.create({
    data: {
      gitSessionId: session.id,
      snapshotId: snapshot.id,
      issueType: params.signals.state,
      summary: params.plan.summary,
      signalsJson: params.signals as object,
      planJson: params.plan as object,
      risk: params.plan.risk,
      engineVersion: params.plan.engineVersion,
    },
  });
  await prisma.trace.create({
    data: {
      gitSessionId: session.id,
      snapshotId: snapshot.id,
      stage: 'plan_generated',
      outputJson: params.plan as object,
      success: true,
    },
  });
  if (params.withVerification) {
    await prisma.trace.create({
      data: {
        gitSessionId: session.id,
        snapshotId: snapshot.id,
        stage: 'verification_completed',
        outputJson: {
          version: 1,
          status: 'succeeded',
          incidentType: params.signals.state,
          selectedAlternativeId: null,
          beforeState: params.signals.state,
          afterState: 'clean',
          reasons: ['migrated'],
          changedSignals: [],
          remainingIssues: [],
          checkedAt: '2026-07-25T00:00:00.000Z',
        },
        success: true,
      },
    });
  }
  return session;
}
