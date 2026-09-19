import { discoverRepository } from '../discovery.js';
import { collectRemotes } from './remotes.js';
import { collectRootCommitOid } from './root-commit.js';

export interface RepositoryIdentity {
  repoRoot: string;
  remotes: Array<{ name: string; url: string }>;
  rootCommitOid: string | null;
}

/**
 * Collect the minimum read-only Git identity signals needed for repository
 * fingerprinting before deciding whether a full snapshot capture can be skipped.
 */
export async function collectRepositoryIdentity(options: { cwd?: string } = {}): Promise<RepositoryIdentity> {
  const context = await discoverRepository({ cwd: options.cwd });
  const [remotes, rootCommitOid] = await Promise.all([
    collectRemotes(context),
    collectRootCommitOid(context),
  ]);
  return {
    repoRoot: context.repoRoot,
    remotes,
    rootCommitOid,
  };
}
