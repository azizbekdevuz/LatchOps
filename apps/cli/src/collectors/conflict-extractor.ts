import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { UnmergedFile, ConflictBlock } from '@latchops/schema';

const MAX_BLOCKS_PER_FILE = 3;
const CONTEXT_LINES = 10;
const MAX_BLOCK_SIZE = 2000; // characters

/**
 * Extract conflict blocks from unmerged files.
 * Scans for <<<<<<<, =======, >>>>>>> markers.
 */
export async function extractConflicts(
  repoRoot: string,
  unmergedPaths: string[]
): Promise<UnmergedFile[]> {
  const results: UnmergedFile[] = [];

  for (const filePath of unmergedPaths) {
    const fullPath = resolve(repoRoot, filePath);

    if (!existsSync(fullPath)) {
      results.push({
        path: filePath,
        conflictBlocks: [],
      });
      continue;
    }

    try {
      let content = readFileSync(fullPath, 'utf-8');
      // Normalize line endings
      content = content.replace(/\r\n/g, '\n');

      const blocks = extractConflictBlocks(content);

      results.push({
        path: filePath,
        conflictBlocks: blocks.slice(0, MAX_BLOCKS_PER_FILE),
      });
    } catch {
      results.push({
        path: filePath,
        conflictBlocks: [],
      });
    }
  }

  return results;
}

function extractConflictBlocks(content: string): ConflictBlock[] {
  const lines = content.split('\n');
  const blocks: ConflictBlock[] = [];

  let i = 0;
  while (i < lines.length && blocks.length < MAX_BLOCKS_PER_FILE) {
    const line = lines[i];

    // Look for conflict start marker
    if (line.startsWith('<<<<<<<')) {
      const startLine = i;
      let separatorLine = -1;
      let endLine = -1;

      // Find separator and end
      for (let j = i + 1; j < lines.length; j++) {
        if (lines[j].startsWith('=======')) {
          separatorLine = j;
        } else if (lines[j].startsWith('>>>>>>>') && separatorLine !== -1) {
          endLine = j;
          break;
        }
      }

      if (separatorLine !== -1 && endLine !== -1) {
        // Extract ours (between <<<< and ====)
        const oursLines = lines.slice(startLine + 1, separatorLine);
        const oursContent = truncate(oursLines.join('\n'));

        // Extract theirs (between ==== and >>>>)
        const theirsLines = lines.slice(separatorLine + 1, endLine);
        const theirsContent = truncate(theirsLines.join('\n'));

        // Extract context (lines around the conflict)
        const contextStart = Math.max(0, startLine - CONTEXT_LINES);
        const contextEnd = Math.min(lines.length, endLine + CONTEXT_LINES + 1);
        const contextLines = lines.slice(contextStart, contextEnd);
        const context = truncate(contextLines.join('\n'));

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
  if (text.length <= MAX_BLOCK_SIZE) {
    return text;
  }
  return text.slice(0, MAX_BLOCK_SIZE) + '\n... [truncated]';
}
