import type { RepoSignalsV1, SignalCheckV1 } from '@latchops/schema';

/** Resolve a dotted field path (e.g. `worktree.conflicted`) within signals. */
export function resolveSignalField(signals: RepoSignalsV1, field: string): unknown {
  const parts = field.split('.');
  let current: unknown = signals;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/** Evaluate a single signal check against a signals snapshot. */
export function evaluateSignalCheck(
  signals: RepoSignalsV1,
  check: SignalCheckV1,
): boolean {
  const actual = resolveSignalField(signals, check.field);
  const expected = check.value;

  switch (check.operator) {
    case 'eq':
      return actual === expected;
    case 'neq':
      return actual !== expected;
    case 'gt':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected;
    case 'gte':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected;
    case 'lt':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected;
    case 'lte':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected;
    case 'isTrue':
      return actual === true;
    case 'isFalse':
      return actual === false;
    case 'isEmpty':
      return isEmpty(actual);
    case 'isNonEmpty':
      return !isEmpty(actual);
    case 'includes':
      return Array.isArray(actual) && actual.includes(expected as never);
    case 'excludes':
      return Array.isArray(actual) && !actual.includes(expected as never);
    default:
      return false;
  }
}

function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.length === 0;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'number') return value === 0;
  return false;
}
