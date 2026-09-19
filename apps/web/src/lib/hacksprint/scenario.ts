import { DEMO_SCENARIO_ID, type DemoScenarioId } from './types';

export const HACKSPRINT_SCENARIO_IDS = [DEMO_SCENARIO_ID] as const;

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
  id: DemoScenarioId;
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
 * Built-in merge-conflict demo. Contents are fixed so the live path never
 * depends on an arbitrary external repository.
 */
export const MERGE_CONFLICT_DEMO: DemoScenario = {
  id: DEMO_SCENARIO_ID,
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

export function resolveScenario(id: unknown): DemoScenario {
  if (id === undefined || id === null || id === DEMO_SCENARIO_ID) {
    return MERGE_CONFLICT_DEMO;
  }
  throw new Error(`Unsupported demo scenario: ${String(id)}`);
}

export function isAllowedScenarioId(id: unknown): id is DemoScenarioId {
  return id === undefined || id === null || id === DEMO_SCENARIO_ID;
}
