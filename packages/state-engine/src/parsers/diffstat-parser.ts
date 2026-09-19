import type { DiffStat } from '@latchops/schema';

/**
 * Parser for `git diff --numstat -z`.
 *
 * NUL-terminated numstat avoids path quoting entirely. Record layouts:
 * - Normal: `<add>\t<del>\t<path>\0`
 * - Binary: `-\t-\t<path>\0`
 * - Rename: `<add>\t<del>\t\0<oldPath>\0<newPath>\0`
 *   (the path field is empty and the two paths follow as separate NUL tokens)
 */
export function parseDiffStat(raw: string): DiffStat[] {
  if (!raw.trim()) return [];

  const tokens = raw.split('\0');
  if (tokens.length > 0 && tokens[tokens.length - 1] === '') tokens.pop();

  const stats: DiffStat[] = [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    const parts = token.split('\t');
    if (parts.length < 3) continue;

    const addStr = parts[0];
    const delStr = parts[1];
    let path = parts.slice(2).join('\t');

    if (path === '') {
      // Rename/copy: the following two tokens are old and new paths.
      const newPath = tokens[i + 2] ?? tokens[i + 1] ?? '';
      i += 2;
      path = newPath;
    }

    if (!path) continue;

    if (addStr === '-' && delStr === '-') {
      stats.push({ path, additions: 0, deletions: 0, binary: true });
    } else {
      stats.push({
        path,
        additions: Number.parseInt(addStr, 10) || 0,
        deletions: Number.parseInt(delStr, 10) || 0,
      });
    }
  }

  return stats;
}
