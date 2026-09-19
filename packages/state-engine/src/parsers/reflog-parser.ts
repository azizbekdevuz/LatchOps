import type { ReflogEntry } from '@latchops/schema';

/**
 * Parser for a custom, separator-delimited `git reflog` format:
 *
 *   git reflog -n <N> --format=%H%x1f%gD%x1f%gs%x1e
 *
 * Fields: %H = full hash, %gD = reflog selector (e.g. `HEAD@{0}`),
 * %gs = reflog subject (e.g. `commit: fix bug`, `checkout: moving from a to b`).
 *
 * The subject is split into an `action` (before the first colon) and a
 * `message` (after it), matching the shape consumed downstream by signal
 * extraction (which keys off `action === 'checkout'`, etc.).
 */
export const REFLOG_FORMAT = '%H%x1f%gD%x1f%gs%x1e';

const RS = '\x1e';
const US = '\x1f';

export function parseReflog(raw: string): ReflogEntry[] {
  const entries: ReflogEntry[] = [];
  const records = raw.split(RS);

  for (const record of records) {
    const trimmed = record.replace(/^\n+/, '');
    if (trimmed.length === 0) continue;

    const [hash, selector = '', subject = ''] = trimmed.split(US);
    if (!hash || !selector) continue;

    const colonIdx = subject.indexOf(':');
    let action: string;
    let message: string;
    if (colonIdx >= 0) {
      action = subject.slice(0, colonIdx).trim();
      message = subject.slice(colonIdx + 1).trim();
    } else {
      action = 'unknown';
      message = subject.trim();
    }

    entries.push({
      hash: hash.trim(),
      selector: selector.trim(),
      action,
      message,
    });
  }

  return entries;
}
