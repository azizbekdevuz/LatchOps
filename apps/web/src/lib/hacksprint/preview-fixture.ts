import { SnapshotV1Schema, type SnapshotV1 } from '@latchops/schema';
import { MERGE_CONFLICT_DEMO } from './scenario';
import { publicRepoLabel } from './redaction';

const MAIN_OID = '1111111111111111111111111111111111111111';
const MERGE_HEAD = '2222222222222222222222222222222222222222';

/**
 * Frozen SnapshotV1 for hosts that cannot spawn git (Vercel Node functions).
 * Engines still classify and plan it; it is not a live capture.
 */
export function builtInBrokenSnapshot(): SnapshotV1 {
  const scenario = MERGE_CONFLICT_DEMO;
  const repoRoot = publicRepoLabel();
  return SnapshotV1Schema.parse({
    version: 1,
    timestamp: '2026-09-19T00:00:00.000Z',
    platform: 'linux',
    repoRoot,
    gitDir: `${repoRoot}/.git`,
    branch: { head: 'main', oid: MAIN_OID },
    isDetachedHead: false,
    rebaseState: { inProgress: false, type: 'none' },
    unmergedFiles: [
      {
        path: scenario.conflictPath,
        conflictBlocks: [
          {
            startLine: 1,
            endLine: 16,
            oursContent: scenario.mainEnv.trim(),
            theirsContent: scenario.releaseEnv.trim(),
            context: scenario.conflictPath,
          },
        ],
      },
    ],
    stagedFiles: [],
    modifiedFiles: [],
    untrackedFiles: [],
    recentLog: [
      { hash: MAIN_OID.slice(0, 7), refs: ['HEAD', 'main'], message: scenario.mainMessage },
    ],
    recentReflog: [],
    mergeHead: MERGE_HEAD,
    mergeMessage: `Merge branch '${scenario.releaseBranch}'`,
    rawStatus: `# branch.oid ${MAIN_OID}\n# branch.head main\nu ${scenario.conflictPath}`,
    rawBranches: `* main\n  ${scenario.releaseBranch}`,
  });
}

export const FIXTURE_PREVIEW_NOTE =
  'Built-in demo fixture — not a live host Git capture. Prove recovery still runs a real isolated Git merge when Daytona is live.';
export const LIVE_PREVIEW_NOTE =
  'Live host Git capture of the built-in demo repository (not a customer repo).';
