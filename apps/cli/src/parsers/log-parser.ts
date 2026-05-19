import type { LogEntry } from '@latchops/schema';

/**
 * Parse git log --oneline --decorate output.
 * Format: <hash> (<decorations>) <message>
 * Or: <hash> <message> (if no decorations)
 */
export function parseLog(logOutput: string): LogEntry[] {
  const lines = logOutput.split('\n').filter(line => line.length > 0);
  const entries: LogEntry[] = [];

  for (const line of lines) {
    const entry = parseLogLine(line);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

function parseLogLine(line: string): LogEntry | null {
  // Match: <hash> (optional decorations) <message>
  const match = line.match(/^([a-f0-9]+)\s+(?:\(([^)]+)\)\s+)?(.*)$/);

  if (!match) {
    return null;
  }

  const [, hash, decorations, message] = match;

  const refs: string[] = [];
  if (decorations) {
    // Parse decorations like "HEAD -> main, origin/main, tag: v1.0"
    const parts = decorations.split(',').map(p => p.trim());
    for (const part of parts) {
      // Handle "HEAD -> branch"
      if (part.includes('->')) {
        const [head, branch] = part.split('->').map(s => s.trim());
        refs.push(head);
        refs.push(branch);
      } else {
        refs.push(part);
      }
    }
  }

  return {
    hash,
    refs,
    message: message.trim(),
  };
}
