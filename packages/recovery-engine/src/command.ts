import type { CwdStrategyV1, RecoveryCommandV1 } from '@latchops/schema';

export interface CommandOptions {
  cwdStrategy?: CwdStrategyV1;
  containsPlaceholder?: boolean;
  readOnly?: boolean;
  display?: string;
}

/**
 * Quote a single argument for the human-readable `display` field only. This is
 * never used to build an executable command line — recovery commands are always
 * argument vectors. Quoting exists purely so operators can read the command.
 */
export function shellQuoteForDisplay(arg: string): string {
  if (arg.length === 0) return "''";
  // Safe, common shell token characters (includes placeholder angle brackets so
  // `<branch-name>` renders readably).
  if (/^[A-Za-z0-9_./:=@%^+,<>{}~-]+$/.test(arg)) return arg;
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

export function renderDisplay(executable: string, args: string[]): string {
  return [executable, ...args.map(shellQuoteForDisplay)].join(' ');
}

/** Build a typed command with argument boundaries preserved. */
export function command(
  executable: string,
  args: string[],
  opts: CommandOptions = {},
): RecoveryCommandV1 {
  return {
    executable,
    args,
    cwdStrategy: opts.cwdStrategy ?? 'repo_root',
    display: opts.display ?? renderDisplay(executable, args),
    containsPlaceholder: opts.containsPlaceholder ?? false,
    readOnly: opts.readOnly ?? false,
  };
}

/** Convenience for `git ...` commands. */
export function git(args: string[], opts: CommandOptions = {}): RecoveryCommandV1 {
  return command('git', args, opts);
}
