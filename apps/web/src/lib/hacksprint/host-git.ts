import { runGit } from '@latchops/state-engine';

export async function hostGitAvailable(): Promise<boolean> {
  try {
    const result = await runGit(['--version'], { timeoutMs: 3_000 });
    return result.ok && /git version/i.test(result.stdout);
  } catch {
    return false;
  }
}

export function vercelRuntime(): boolean {
  return process.env.VERCEL === '1';
}
