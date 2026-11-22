import { describe, expect, it } from 'vitest';
import { MERGE_CONFLICT_DEMO, PRODUCTION_DEPLOY_CONTRACT } from './demo-scenario';

describe('checkout demo scenario', () => {
  it('keeps the production deploy contract as the resolved side', () => {
    expect(MERGE_CONFLICT_DEMO.releaseBranch).toBe('release/checkout-api');
    expect(MERGE_CONFLICT_DEMO.resolvedEnv).toBe(PRODUCTION_DEPLOY_CONTRACT);
    expect(MERGE_CONFLICT_DEMO.resolvedEnv).toBe(MERGE_CONFLICT_DEMO.mainEnv);
    expect(PRODUCTION_DEPLOY_CONTRACT).toContain('PORT=8443');
    expect(PRODUCTION_DEPLOY_CONTRACT).toContain('HEALTHCHECK_PATH=/healthz');
    expect(MERGE_CONFLICT_DEMO.releaseEnv).toContain('PORT=8080');
    expect(MERGE_CONFLICT_DEMO.readme).toContain('PORT=8443');
  });
});
