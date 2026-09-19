import type { RepositoryContext } from '../discovery.js';
import { runGit } from '../git-runner/index.js';

export async function collectRootCommitOid(context: RepositoryContext): Promise<string | null> {
  try {
    const result = await runGit(['rev-list', '--max-parents=0', 'HEAD'], { cwd: context.repoRoot });
    const oid = result.stdout.trim().split('\n')[0]?.trim();
    return oid && /^[0-9a-f]{40}$/i.test(oid) ? oid : null;
  } catch {
    return null;
  }
}
