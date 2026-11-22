import { SnapshotV1Schema, type SnapshotV1 } from '@latchops/schema';

/** Label used by the frozen fixture. It is not a path on this machine. */
export const DEMO_REPO_ROOT = '/demo/checkout-service';

export const PRODUCTION_DEPLOY_CONTRACT = [
  'ENVIRONMENT=production',
  'SERVICE_NAME=checkout-api',
  'PORT=8443',
  'REPLICAS=3',
  'HEALTHCHECK_PATH=/healthz',
  'ROLLOUT_STRATEGY=rolling',
  'MAX_SURGE=1',
  'MAX_UNAVAILABLE=0',
  '',
].join('\n');

export interface DemoScenario {
  id: 'merge_conflict_demo';
  title: string;
  description: string;
  conflictPath: string;
  releaseBranch: string;
  readme: string;
  baseEnv: string;
  mainEnv: string;
  releaseEnv: string;
  resolvedEnv: string;
  selectedAlternativeId: 'complete_merge';
  initMessage: string;
  releaseMessage: string;
  mainMessage: string;
}

/**
 * Fixed merge-conflict incident. Contents never come from an arbitrary repository.
 * Recovery Review scenario S01 rebuilds this same conflict with real Git.
 */
export const MERGE_CONFLICT_DEMO: DemoScenario = {
  id: 'merge_conflict_demo',
  title: 'Checkout service — release blocked by deployment configuration conflict.',
  description:
    'A fictional engineering team is merging release/checkout-api into main before deploying its checkout API. Both branches independently changed deploy.env. Git stopped with MERGE_HEAD and one unmerged path.',
  conflictPath: 'deploy.env',
  releaseBranch: 'release/checkout-api',
  readme: [
    '# checkout-service',
    '',
    'Fictional checkout API used for a LatchOps recovery demo. Not a production system and not an ingested customer repository.',
    '',
    'The service accepts checkout sessions and talks to a mocked payment adapter. Production deploys from `main` only after the release branch is merged.',
    '',
    '## Production deploy contract',
    '',
    '`deploy.env` on `main` must keep these values before a production rollout:',
    '',
    '- ENVIRONMENT=production',
    '- SERVICE_NAME=checkout-api',
    '- PORT=8443',
    '- REPLICAS=3',
    '- HEALTHCHECK_PATH=/healthz',
    '- ROLLOUT_STRATEGY=rolling',
    '- MAX_SURGE=1',
    '- MAX_UNAVAILABLE=0',
    '',
    'A release branch that retunes the same keys for a pre-prod soak must be reconciled to this contract. The demo resolution is controlled orchestration, not an AI-generated fix.',
    '',
  ].join('\n'),
  baseEnv: [
    'ENVIRONMENT=staging',
    'SERVICE_NAME=checkout-api',
    'PORT=8080',
    'REPLICAS=1',
    'HEALTHCHECK_PATH=/health',
    'ROLLOUT_STRATEGY=recreate',
    'MAX_SURGE=0',
    'MAX_UNAVAILABLE=1',
    '',
  ].join('\n'),
  mainEnv: PRODUCTION_DEPLOY_CONTRACT,
  releaseEnv: [
    'ENVIRONMENT=staging',
    'SERVICE_NAME=checkout-api',
    'PORT=8080',
    'REPLICAS=2',
    'HEALTHCHECK_PATH=/ready',
    'ROLLOUT_STRATEGY=rolling',
    'MAX_SURGE=1',
    'MAX_UNAVAILABLE=0',
    '',
  ].join('\n'),
  resolvedEnv: PRODUCTION_DEPLOY_CONTRACT,
  selectedAlternativeId: 'complete_merge',
  initMessage: 'init: checkout-api service skeleton',
  releaseMessage: 'release: retune checkout-api deploy for pre-prod soak',
  mainMessage: 'main: lock production checkout-api deploy contract',
};

const MAIN_OID = '1111111111111111111111111111111111111111';
const MERGE_HEAD = '2222222222222222222222222222222222222222';

/**
 * Frozen SnapshotV1 for unit tests. Engines still classify and plan it.
 * It is not a live capture.
 */
export function builtInBrokenSnapshot(): SnapshotV1 {
  const scenario = MERGE_CONFLICT_DEMO;
  return SnapshotV1Schema.parse({
    version: 1,
    timestamp: '2026-09-19T00:00:00.000Z',
    platform: 'linux',
    repoRoot: DEMO_REPO_ROOT,
    gitDir: `${DEMO_REPO_ROOT}/.git`,
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
    recentLog: [{ hash: MAIN_OID.slice(0, 7), refs: ['HEAD', 'main'], message: scenario.mainMessage }],
    recentReflog: [],
    mergeHead: MERGE_HEAD,
    mergeMessage: `Merge branch '${scenario.releaseBranch}'`,
    rawStatus: `# branch.oid ${MAIN_OID}\n# branch.head main\nu ${scenario.conflictPath}`,
    rawBranches: `* main\n  ${scenario.releaseBranch}`,
  });
}
