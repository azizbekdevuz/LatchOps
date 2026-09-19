import type { LogEntry } from '@latchops/schema';

/**
 * Parser for a custom, separator-delimited `git log` format:
 *
 *   git log -n <N> --decorate=short --format=%H%x1f%D%x1f%s%x1e
 *
 * Records are separated by 0x1e (RS) and fields by 0x1f (US). This avoids the
 * fragility of parsing `--oneline` output (which breaks on unusual subjects and
 * on hashes/refs that resemble message text).
 *
 * Fields: %H = full hash, %D = ref decorations (comma-separated), %s = subject.
 */
export const LOG_FORMAT = '%H%x1f%D%x1f%s%x1e';

const RS = '\x1e';
const US = '\x1f';

export function parseLog(raw: string): LogEntry[] {
  const entries: LogEntry[] = [];
  const records = raw.split(RS);

  for (const record of records) {
    const trimmed = record.replace(/^\n+/, '');
    if (trimmed.length === 0) continue;

    const [hash, decorations = '', message = ''] = trimmed.split(US);
    if (!hash) continue;

    entries.push({
      hash: hash.trim(),
      refs: parseDecorations(decorations),
      message: message.trim(),
    });
  }

  return entries;
}

function parseDecorations(decorations: string): string[] {
  if (!decorations.trim()) return [];
  const refs: string[] = [];
  for (const rawPart of decorations.split(',')) {
    const part = rawPart.trim();
    if (!part) continue;
    if (part.includes('->')) {
      // "HEAD -> main"
      const [head, branch] = part.split('->').map((s) => s.trim());
      if (head) refs.push(head);
      if (branch) refs.push(branch);
    } else {
      // Strip a leading "tag: " qualifier for a cleaner ref label.
      refs.push(part.replace(/^tag:\s*/, ''));
    }
  }
  return refs;
}
