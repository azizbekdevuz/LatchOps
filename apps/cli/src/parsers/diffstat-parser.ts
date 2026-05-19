import type { DiffStat } from '@latchops/schema';

/**
 * Parse git diff --numstat output into structured diff stats.
 * Format: additions<TAB>deletions<TAB>path
 * For binary files: -<TAB>-<TAB>path
 */
export function parseDiffStat(rawOutput: string): DiffStat[] {
  if (!rawOutput.trim()) {
    return [];
  }

  const stats: DiffStat[] = [];
  const lines = rawOutput.split('\n').filter(Boolean);

  for (const line of lines) {
    // Skip the summary line (e.g., "3 files changed, 10 insertions(+)")
    if (line.includes('files changed') || line.includes('file changed')) {
      continue;
    }

    // Parse numstat format: additions<TAB>deletions<TAB>path
    const parts = line.split('\t');
    if (parts.length >= 3) {
      const [addStr, delStr, ...pathParts] = parts;
      const path = pathParts.join('\t'); // Handle paths with tabs

      if (addStr === '-' && delStr === '-') {
        // Binary file
        stats.push({
          path,
          additions: 0,
          deletions: 0,
          binary: true,
        });
      } else {
        stats.push({
          path,
          additions: parseInt(addStr, 10) || 0,
          deletions: parseInt(delStr, 10) || 0,
        });
      }
    }
  }

  return stats;
}
