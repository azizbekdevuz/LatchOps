import { describe, expect, it } from 'vitest';
import { analyzeDetached, rescueBranchName } from './reflog.js';
import { makeSnapshot } from './test-support/fixtures.js';

const OID = 'abc1234def5678901234567890123456789012ab';

describe('analyzeDetached', () => {
  it('selects the branch we left, grounded in real reflog', () => {
    const snapshot = makeSnapshot({
      branch: { head: '(detached)', oid: OID },
      isDetachedHead: true,
      recentReflog: [
        {
          hash: OID,
          selector: 'HEAD@{0}',
          action: 'checkout',
          message: `moving from feature-x to ${OID}`,
        },
      ],
    });
    const a = analyzeDetached(snapshot);
    expect(a.previousBranch).toBe('feature-x');
    expect(a.hasConfidentTarget).toBe(true);
    expect(a.target).toBe('feature-x');
    expect(a.currentOid).toBe(OID);
  });

  it('produces a concrete rescue branch name from the real oid (no placeholder)', () => {
    const snapshot = makeSnapshot({ branch: { head: '(detached)', oid: OID } });
    const a = analyzeDetached(snapshot);
    expect(a.rescueBranch).toBe(rescueBranchName(OID));
    expect(a.rescueBranch).toContain(OID.slice(0, 12));
    expect(a.rescueBranch).not.toContain('<');
  });

  it('refuses to guess when there is no reflog or single candidate', () => {
    const snapshot = makeSnapshot({
      branch: { head: '(detached)', oid: OID },
      isDetachedHead: true,
      recentReflog: [],
      recentLog: [],
    });
    const a = analyzeDetached(snapshot);
    expect(a.hasConfidentTarget).toBe(false);
    expect(a.target).toBeNull();
  });

  it('uses a single log-decoration candidate when reflog is silent', () => {
    const snapshot = makeSnapshot({
      branch: { head: '(detached)', oid: OID },
      isDetachedHead: true,
      recentReflog: [],
      recentLog: [{ hash: OID, refs: ['develop'], message: 'work' }],
    });
    const a = analyzeDetached(snapshot);
    expect(a.candidateBranches).toContain('develop');
    expect(a.target).toBe('develop');
  });

  it('does not treat remote-tracking refs as local branch candidates', () => {
    const snapshot = makeSnapshot({
      branch: { head: '(detached)', oid: OID },
      recentReflog: [],
      recentLog: [{ hash: OID, refs: ['origin/main'], message: 'work' }],
    });
    const a = analyzeDetached(snapshot);
    expect(a.candidateBranches).not.toContain('origin/main');
    expect(a.hasConfidentTarget).toBe(false);
  });
});
