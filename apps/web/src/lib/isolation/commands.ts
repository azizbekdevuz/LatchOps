import type { RecoveryCommandV1 } from '@latchops/schema';

const INSPECT_SUBCOMMANDS = new Set([
  'status',
  'diff',
  'ls-files',
  'log',
  'reflog',
  'rev-parse',
  'show',
]);

function isInspectCommand(cmd: RecoveryCommandV1): boolean {
  const sub = cmd.args[0] ?? '';
  return INSPECT_SUBCOMMANDS.has(sub);
}

/**
 * Structural allowlist for plan execution.
 * `readOnly` on the command is ignored — only concrete inspect/recovery shapes pass.
 */
export function isExecutablePlanCommand(cmd: RecoveryCommandV1): boolean {
  if (cmd.executable !== 'git') return false;
  if (cmd.containsPlaceholder) return false;
  const [sub, ...rest] = cmd.args;
  if (!sub) return false;
  if (isInspectCommand(cmd)) return true;
  if (sub === 'add') {
    return rest[0] === '--' || rest[0] === '-A';
  }
  if (sub === 'commit') {
    return rest.length === 1 && rest[0] === '--no-edit';
  }
  if (sub === 'merge') {
    return rest.length === 1 && rest[0] === '--abort';
  }
  return false;
}
