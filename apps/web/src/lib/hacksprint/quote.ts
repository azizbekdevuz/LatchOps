/**
 * POSIX single-quote for Daytona `executeCommand` (Linux sandbox shell).
 * Never used to interpolate client input — callers must pass server-owned args.
 */
export function posixQuote(arg: string): string {
  return `'${arg.replace(/'/g, `'\\''`)}'`;
}

export function toPosixCommand(executable: string, args: readonly string[]): string {
  return [executable, ...args.map(posixQuote)].join(' ');
}

export function boundText(value: string, max = 4000): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`;
}
