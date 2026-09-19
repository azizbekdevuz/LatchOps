import type { RepositoryContext } from '../discovery.js';
import { runGit } from '../git-runner/index.js';

export interface RemoteEntry {
  name: string;
  url: string;
}

export async function collectRemotes(context: RepositoryContext): Promise<RemoteEntry[]> {
  const result = await runGit(['remote', '-v'], { cwd: context.repoRoot });
  const remotes = new Map<string, string>();
  for (const line of result.stdout.split('\n')) {
    const match = /^(\S+)\s+(\S+)\s+\(fetch\)/.exec(line.trim());
    if (match) remotes.set(match[1]!, match[2]!);
  }
  return [...remotes.entries()].map(([name, url]) => ({ name, url }));
}
