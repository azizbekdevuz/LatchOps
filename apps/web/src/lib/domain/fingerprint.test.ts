import { describe, expect, it } from 'vitest';
import { computeFingerprint, normalizeRemoteUrl } from './fingerprint';

describe('fingerprint', () => {
  const vectors: Array<{ input: string; expected: string }> = [
    { input: 'https://github.com/org/repo.git', expected: 'https://github.com/org/repo' },
    { input: 'https://GITHUB.COM/Org/Repo.git/', expected: 'https://github.com/Org/Repo' },
    { input: 'git@github.com:org/repo.git', expected: 'https://github.com/org/repo' },
    { input: 'https://user:token@github.com/org/repo.git', expected: 'https://github.com/org/repo' },
    { input: 'ssh://git@github.com/org/repo.git', expected: 'ssh://github.com/org/repo' },
    { input: 'https://gitlab.com/group/sub/repo', expected: 'https://gitlab.com/group/sub/repo' },
    { input: 'git@gitlab.com:group/sub/repo.git', expected: 'https://gitlab.com/group/sub/repo' },
    { input: 'https://bitbucket.org/team/repo/src/main/?at=master', expected: 'https://bitbucket.org/team/repo/src/main' },
    { input: 'https://dev.azure.com/org/project/_git/repo', expected: 'https://dev.azure.com/org/project/_git/repo' },
    { input: 'https://gitea.example.com:3000/user/repo.git', expected: 'https://gitea.example.com:3000/user/repo' },
    { input: 'https://github.com/org/repo', expected: 'https://github.com/org/repo' },
    { input: 'https://github.com/org/repo#readme', expected: 'https://github.com/org/repo' },
    { input: 'HTTPS://GitHub.com/Org/Repo.GIT', expected: 'https://github.com/Org/Repo' },
    { input: 'git@github.com:Org/Repo.git', expected: 'https://github.com/Org/Repo' },
    { input: 'https://git.example.com/repo.git/', expected: 'https://git.example.com/repo' },
    { input: 'https://git.example.com/repo', expected: 'https://git.example.com/repo' },
    { input: 'https://git.example.com/a/b/c.git', expected: 'https://git.example.com/a/b/c' },
    { input: 'https://git.example.com/a%20b/repo.git', expected: 'https://git.example.com/a%20b/repo' },
    { input: 'https://git.example.com:443/repo.git', expected: 'https://git.example.com/repo' },
    { input: 'https://git.example.com/repo.git?ref=main', expected: 'https://git.example.com/repo' },
  ];

  it.each(vectors)('normalizes $input', ({ input, expected }) => {
    expect(normalizeRemoteUrl(input)).toBe(expected);
  });

  it('computes stable fingerprint for remote + root', () => {
    const result = computeFingerprint({
      version: 1,
      timestamp: new Date().toISOString(),
      platform: 'linux',
      repoRoot: '/tmp/repo',
      gitDir: '/tmp/repo/.git',
      branch: { head: 'main', oid: 'abc' },
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
      remotes: [{ name: 'origin', url: 'https://github.com/org/repo.git' }],
      rootCommitOid: 'a'.repeat(40),
    });
    expect(result.missingRemote).toBe(false);
    expect(result.displayName).toBe('repo');
    expect(result.fingerprint).toHaveLength(64);
  });

  it('computes local fingerprint without remote', () => {
    const result = computeFingerprint({
      version: 1,
      timestamp: new Date().toISOString(),
      platform: 'darwin',
      repoRoot: '/tmp/local',
      gitDir: '/tmp/local/.git',
      branch: { head: 'main', oid: 'abc' },
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
      rootCommitOid: 'b'.repeat(40),
    });
    expect(result.missingRemote).toBe(true);
    expect(result.displayName).toBe(`local/${'b'.repeat(8)}`);
  });
});
