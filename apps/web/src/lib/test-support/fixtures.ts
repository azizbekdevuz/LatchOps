import type { SnapshotV1 } from '@latchops/schema';
import { getTestPrisma } from './test-db';

const NOW = '2026-07-25T00:00:00.000Z';

export function sampleSnapshot(overrides: Partial<SnapshotV1> = {}): SnapshotV1 {
  return {
    version: 1,
    timestamp: NOW,
    platform: 'linux',
    repoRoot: '/tmp/latchops-test-repo',
    gitDir: '/tmp/latchops-test-repo/.git',
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
    remotes: [{ name: 'origin', url: 'https://github.com/acme/widget.git' }],
    rootCommitOid: 'c'.repeat(40),
    ...overrides,
  };
}

export async function createTestUser(email: string) {
  return getTestPrisma().user.create({
    data: { email, name: email.split('@')[0] },
  });
}

export async function createTeamOrg(ownerUserId: string, slug: string) {
  const prisma = getTestPrisma();
  return prisma.$transaction(async (tx) => {
    const org = await tx.organization.create({
      data: {
        kind: 'team',
        name: slug,
        slug,
        memberships: { create: { userId: ownerUserId, role: 'owner' } },
      },
    });
    return org;
  });
}

export async function addMember(
  organizationId: string,
  userId: string,
  role: 'admin' | 'member' | 'viewer' = 'member',
) {
  return getTestPrisma().membership.create({
    data: { organizationId, userId, role },
  });
}
