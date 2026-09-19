/**
 * Seed representative Phase 3 data into a baseline-only database.
 * Usage: DATABASE_URL=... node scripts/seed-phase3-fixture.mjs
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const snapshotJson = {
  version: 1,
  timestamp: '2026-07-25T00:00:00.000Z',
  platform: 'linux',
  repoRoot: '/tmp/phase3-repo',
  gitDir: '/tmp/phase3-repo/.git',
  branch: { head: 'main', oid: 'a'.repeat(40) },
  isDetachedHead: false,
  rebaseState: { inProgress: false, type: 'none' },
  unmergedFiles: [],
  stagedFiles: [],
  modifiedFiles: [],
  untrackedFiles: [],
  recentLog: [],
  recentReflog: [],
  rawStatus: '',
  rawBranches: '',
};

async function main() {
  const owner = await prisma.user.create({
    data: { email: 'owner@phase3.test', name: 'Owner' },
  });
  const anon = await prisma.user.create({
    data: { email: 'anon@phase3.test', name: 'Anon' },
  });

  await prisma.account.create({
    data: {
      userId: owner.id,
      type: 'oauth',
      provider: 'github',
      providerAccountId: 'gh-owner',
    },
  });

  const ownedSession = await prisma.gitSession.create({
    data: {
      title: 'Owned merge conflict',
      os: 'linux',
      repoRootHash: 'hash-owned',
      userId: owner.id,
      status: 'ready',
    },
  });
  const anonSession = await prisma.gitSession.create({
    data: {
      title: 'Anonymous dirty worktree',
      os: 'darwin',
      repoRootHash: 'hash-anon',
      userId: null,
      status: 'ready',
    },
  });

  const ownedSnap = await prisma.snapshot.create({
    data: { gitSessionId: ownedSession.id, snapshotJson },
  });
  const anonSnap = await prisma.snapshot.create({
    data: { gitSessionId: anonSession.id, snapshotJson },
  });

  const ownedAnalysis = await prisma.analysis.create({
    data: {
      gitSessionId: ownedSession.id,
      snapshotId: ownedSnap.id,
      issueType: 'merge_conflict',
      summary: 'Merge conflict in src/app.ts',
      signalsJson: { state: 'merge_conflict', reasons: ['unmerged files'] },
      planJson: { incidentType: 'merge_conflict', summary: 'Resolve conflicts', risk: 'medium', steps: [] },
      risk: 'medium',
      engineVersion: 'recovery-engine@1',
    },
  });
  const anonAnalysis = await prisma.analysis.create({
    data: {
      gitSessionId: anonSession.id,
      snapshotId: anonSnap.id,
      issueType: 'dirty_worktree',
      summary: 'Uncommitted changes',
      signalsJson: { state: 'dirty_worktree', reasons: ['modified files'] },
      planJson: { incidentType: 'dirty_worktree', summary: 'Stash or commit', risk: 'low', steps: [] },
      risk: 'low',
      engineVersion: 'recovery-engine@1',
    },
  });

  const conflictFile = await prisma.conflictFile.create({
    data: { analysisId: ownedAnalysis.id, path: 'src/app.ts' },
  });
  await prisma.conflictHunk.create({
    data: {
      conflictFileId: conflictFile.id,
      index: 0,
      startLine: 1,
      endLine: 5,
      baseText: 'ctx',
      oursText: 'ours',
      theirsText: 'theirs',
    },
  });

  await prisma.planStep.create({
    data: {
      analysisId: ownedAnalysis.id,
      index: 0,
      title: 'Inspect conflicts',
      commandsJson: [],
      verifyJson: {},
      undoJson: {},
    },
  });

  await prisma.trace.create({
    data: {
      gitSessionId: ownedSession.id,
      stage: 'plan_generated',
      snapshotId: ownedSnap.id,
      outputJson: { ok: true },
    },
  });
  await prisma.trace.create({
    data: {
      gitSessionId: anonSession.id,
      stage: 'plan_generated',
      snapshotId: anonSnap.id,
      outputJson: { ok: true },
    },
  });

  await prisma.event.create({
    data: { type: 'session.created', userId: owner.id, gitSessionId: ownedSession.id },
  });
  await prisma.event.create({
    data: { type: 'session.created', gitSessionId: anonSession.id },
  });

  const counts = {
    User: await prisma.user.count(),
    GitSession: await prisma.gitSession.count(),
    Snapshot: await prisma.snapshot.count(),
    Analysis: await prisma.analysis.count(),
    PlanStep: await prisma.planStep.count(),
    ConflictFile: await prisma.conflictFile.count(),
    ConflictHunk: await prisma.conflictHunk.count(),
    Trace: await prisma.trace.count(),
    Event: await prisma.event.count(),
  };

  console.log(JSON.stringify({ seeded: true, counts, ownerId: owner.id, anonId: anon.id }, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
