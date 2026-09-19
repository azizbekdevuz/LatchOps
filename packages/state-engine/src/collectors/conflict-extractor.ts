import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ConflictBlock, UnmergedFile } from '@latchops/schema';

const MAX_BLOCKS_PER_FILE = 3;
const CONTEXT_LINES = 10;
const MAX_BLOCK_SIZE = 2_000; // characters

export interface ExtractConflictsOptions {
  /** Absolute repository root; unmerged paths are resolved against it. */
  repoRoot: string;
  /** Repo-relative unmerged file paths (already truncated to a safe count by the caller). */
  unmergedPaths: string[];
}

/**
 * Extract conflict blocks (`<<<<<<<` / `=======` / `>>>>>>>`) from unmerged
 * files. Reads file contents directly from disk (read-only) and normalizes
 * line endings. Unicode paths are handled by resolving the path with `resolve`
 * and reading with the default utf8 decoder.
 */
export function extractConflicts(options: ExtractConflictsOptions): UnmergedFile[] {
  const results: UnmergedFile[] = [];

  for (const filePath of options.unmergedPaths) {
    const fullPath = resolve(options.repoRoot, filePath);

    if (!existsSync(fullPath)) {
      results.push({ path: filePath, conflictBlocks: [] });
      continue;
    }

    try {
      const content = readFileSync(fullPath, 'utf8').replace(/\r\n?/g, '\n');
      results.push({
        path: filePath,
        conflictBlocks: extractConflictBlocks(content).slice(0, MAX_BLOCKS_PER_FILE),
      });
    } catch {
      results.push({ path: filePath, conflictBlocks: [] });
    }
  }

  return results;
}

export function extractConflictBlocks(content: string): ConflictBlock[] {
  const lines = content.split('\n');
  const blocks: ConflictBlock[] = [];

  let i = 0;
  while (i < lines.length && blocks.length < MAX_BLOCKS_PER_FILE) {
    if (lines[i].startsWith('<<<<<<<')) {
      const startLine = i;
      let separatorLine = -1;
      let endLine = -1;

      for (let j = i + 1; j < lines.length; j++) {
        if (separatorLine === -1 && lines[j].startsWith('=======')) {
          separatorLine = j;
        } else if (lines[j].startsWith('>>>>>>>') && separatorLine !== -1) {
          endLine = j;
          break;
        }
      }

      if (separatorLine !== -1 && endLine !== -1) {
        const oursContent = truncate(lines.slice(startLine + 1, separatorLine).join('\n'));
        const theirsContent = truncate(lines.slice(separatorLine + 1, endLine).join('\n'));
        const contextStart = Math.max(0, startLine - CONTEXT_LINES);
        const contextEnd = Math.min(lines.length, endLine + CONTEXT_LINES + 1);
        const context = truncate(lines.slice(contextStart, contextEnd).join('\n'));

        blocks.push({
          startLine: startLine + 1, // 1-indexed for display
          endLine: endLine + 1,
          oursContent,
          theirsContent,
          context,
        });

        i = endLine + 1;
        continue;
      }
    }
    i++;
  }

  return blocks;
}

function truncate(text: string): string {
  return text.length <= MAX_BLOCK_SIZE ? text : `${text.slice(0, MAX_BLOCK_SIZE)}\n... [truncated]`;
}
