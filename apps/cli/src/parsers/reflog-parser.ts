import type { ReflogEntry } from '@latchops/schema';

/**
 * Parse git reflog output.
 * Format: <hash> <selector> <action>: <message>
 * Example: abc1234 HEAD@{0} commit: Fix bug
 */
export function parseReflog(reflogOutput: string): ReflogEntry[] {
  const lines = reflogOutput.split('\n').filter(line => line.length > 0);
  const entries: ReflogEntry[] = [];

  for (const line of lines) {
    const entry = parseReflogLine(line);
    if (entry) {
      entries.push(entry);
    }
  }

  return entries;
}

function parseReflogLine(line: string): ReflogEntry | null {
  // Match: <hash> <selector> <action>: <message>
  // Example: 57c3040 HEAD@{0}: commit: Add validation to functions
  // Note: action can contain sub-parts like "commit (initial)"
  const match = line.match(/^([a-f0-9]+)\s+(HEAD@\{\d+\}):\s+([^:]+):\s*(.*)$/);

  if (match) {
    const [, hash, selector, action, message] = match;
    return {
      hash,
      selector,
      action: action.trim(),
      message: message.trim(),
    };
  }

  // Try format with parentheses in action: "commit (initial): message"
  const parenMatch = line.match(/^([a-f0-9]+)\s+(HEAD@\{\d+\}):\s+([^:]+\([^)]+\)):\s*(.*)$/);
  if (parenMatch) {
    const [, hash, selector, action, message] = parenMatch;
    return {
      hash,
      selector,
      action: action.trim(),
      message: message.trim(),
    };
  }

  // Fallback: simpler format
  const simpleMatch = line.match(/^([a-f0-9]+)\s+(HEAD@\{\d+\}):\s+(.*)$/);
  if (simpleMatch) {
    const [, hash, selector, rest] = simpleMatch;
    // Try to split on first colon for action
    const colonIdx = rest.indexOf(':');
    if (colonIdx > 0) {
      return {
        hash,
        selector,
        action: rest.slice(0, colonIdx).trim(),
        message: rest.slice(colonIdx + 1).trim(),
      };
    }
    return {
      hash,
      selector,
      action: 'unknown',
      message: rest.trim(),
    };
  }

  return null;
}
