import { execSync } from 'node:child_process';

export interface ExecResult {
  stdout: string;
  success: boolean;
}

/**
 * Execute a git command and return the output.
 * Normalizes line endings to LF for cross-platform compatibility.
 */
export function execGit(args: string[], cwd?: string): ExecResult {
  try {
    const result = execSync(`git ${args.join(' ')}`, {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024, // 10MB
    });

    // Normalize CRLF to LF
    const normalized = result.replace(/\r\n/g, '\n');

    return {
      stdout: normalized,
      success: true,
    };
  } catch (error) {
    if (error instanceof Error && 'stdout' in error) {
      const stdout = (error as { stdout: string }).stdout || '';
      return {
        stdout: stdout.replace(/\r\n/g, '\n'),
        success: false,
      };
    }
    throw error;
  }
}

/**
 * Check if a path exists using git rev-parse --git-path
 */
export async function gitPathExists(gitDir: string, subpath: string): Promise<boolean> {
  try {
    const result = execGit(['rev-parse', '--git-path', subpath]);
    if (!result.success) return false;

    const fullPath = result.stdout.trim();
    // Use git to check if the path exists by trying to list it
    const { existsSync } = await import('node:fs');
    const { resolve } = await import('node:path');

    // If the path is relative, resolve it against gitDir's parent
    const resolvedPath = fullPath.startsWith('/') || /^[A-Za-z]:/.test(fullPath)
      ? fullPath
      : resolve(process.cwd(), fullPath);

    return existsSync(resolvedPath);
  } catch {
    return false;
  }
}
