import type { RecoveryCommandV1, RiskLevelV1 } from '@latchops/schema';

export interface CommandSafety {
  destructive: boolean;
  risk: RiskLevelV1;
  /** True when the command only inspects state and mutates nothing. */
  readOnly: boolean;
  reasons: string[];
}

const RISK_ORDER: RiskLevelV1[] = ['none', 'low', 'medium', 'high', 'critical'];

export function maxRisk(a: RiskLevelV1, b: RiskLevelV1): RiskLevelV1 {
  return RISK_ORDER.indexOf(a) >= RISK_ORDER.indexOf(b) ? a : b;
}

export function riskAtLeast(value: RiskLevelV1, min: RiskLevelV1): boolean {
  return RISK_ORDER.indexOf(value) >= RISK_ORDER.indexOf(min);
}

/** git subcommands that only read repository state. */
const READ_ONLY_GIT_SUBCOMMANDS = new Set([
  'status',
  'log',
  'diff',
  'show',
  'rev-parse',
  'reflog',
  'ls-files',
  'for-each-ref',
  'cat-file',
  'describe',
  'shortlog',
  'name-rev',
  'symbolic-ref',
  'rev-list',
  'whatchanged',
  'blame',
]);

/**
 * Deterministically classify a command's destructiveness and risk. Templates
 * use this to derive step-level `destructive`/`risk` from the actual commands,
 * so safety metadata cannot drift from what the command really does.
 *
 * Destructive = can discard committed/uncommitted work or rewrite history.
 */
export function classifyCommand(cmd: RecoveryCommandV1): CommandSafety {
  if (cmd.executable !== 'git') {
    // Non-git executables are treated conservatively but non-destructive unless
    // explicitly a known dangerous tool. LatchOps only emits git commands today.
    return { destructive: false, risk: 'low', readOnly: false, reasons: [] };
  }

  const args = cmd.args;
  const sub = args[0] ?? '';
  const has = (flag: string): boolean => args.includes(flag);
  const reasons: string[] = [];

  const destructive = (risk: RiskLevelV1, reason: string): CommandSafety => {
    reasons.push(reason);
    return { destructive: true, risk, readOnly: false, reasons };
  };

  if (READ_ONLY_GIT_SUBCOMMANDS.has(sub)) {
    return { destructive: false, risk: 'none', readOnly: true, reasons: ['read-only inspection'] };
  }

  switch (sub) {
    case 'push': {
      if (has('--force') || has('-f')) {
        return destructive('critical', 'force push can overwrite remote history');
      }
      if (has('--force-with-lease')) {
        return destructive('high', 'force-with-lease rewrites remote history (guarded by lease)');
      }
      return { destructive: false, risk: 'medium', readOnly: false, reasons: ['updates remote'] };
    }
    case 'reset': {
      if (has('--hard')) {
        return destructive('high', 'reset --hard discards uncommitted changes and moves HEAD');
      }
      if (has('--keep') || has('--merge')) {
        return { destructive: false, risk: 'medium', readOnly: false, reasons: ['moves HEAD, may refuse on conflicts'] };
      }
      // soft/mixed keep working-tree content but move HEAD/index.
      return { destructive: false, risk: 'medium', readOnly: false, reasons: ['moves HEAD/index; working tree preserved'] };
    }
    case 'clean': {
      return destructive('high', 'clean permanently deletes untracked files');
    }
    case 'branch': {
      if (has('-D') || has('--delete') || (has('-d') && has('--force'))) {
        return destructive('high', 'deleting a branch can orphan commits');
      }
      // Creating/listing branches is safe.
      return { destructive: false, risk: 'low', readOnly: !has('-d') && !has('-m') && !has('-M') && !has('--edit-description') && args.length <= 2 && !hasNewBranchName(args), reasons: ['branch management'] };
    }
    case 'checkout': {
      if (has('-b') || has('-B')) {
        return { destructive: false, risk: 'low', readOnly: false, reasons: ['creates a new branch'] };
      }
      if (has('--') || args.includes('.')) {
        return destructive('high', 'checkout of paths discards uncommitted changes to those paths');
      }
      return { destructive: false, risk: 'medium', readOnly: false, reasons: ['switches HEAD; refuses if it would lose changes'] };
    }
    case 'switch': {
      if (has('-c') || has('-C')) {
        return { destructive: false, risk: 'low', readOnly: false, reasons: ['creates a new branch'] };
      }
      if (has('--discard-changes')) {
        return destructive('high', 'switch --discard-changes discards uncommitted changes');
      }
      return { destructive: false, risk: 'low', readOnly: false, reasons: ['switches branch; refuses if it would lose changes'] };
    }
    case 'restore': {
      if (has('--staged') && !has('--worktree')) {
        return { destructive: false, risk: 'medium', readOnly: false, reasons: ['unstages; working tree preserved'] };
      }
      return destructive('high', 'restore overwrites working-tree files, discarding changes');
    }
    case 'rebase': {
      if (has('--abort')) {
        return destructive('high', 'rebase --abort discards the in-progress rebase');
      }
      if (has('--skip')) {
        return destructive('high', 'rebase --skip drops the current commit from the rebase');
      }
      if (has('--continue') || has('--edit-todo') || has('--quit')) {
        return { destructive: false, risk: 'medium', readOnly: false, reasons: ['advances the in-progress rebase'] };
      }
      return destructive('high', 'rebase rewrites commit history');
    }
    case 'merge': {
      if (has('--abort')) {
        return destructive('high', 'merge --abort discards the in-progress merge');
      }
      if (has('--continue')) {
        return { destructive: false, risk: 'medium', readOnly: false, reasons: ['completes the in-progress merge'] };
      }
      return { destructive: false, risk: 'medium', readOnly: false, reasons: ['creates a merge commit'] };
    }
    case 'commit': {
      if (has('--amend')) {
        return destructive('high', 'commit --amend rewrites the last commit');
      }
      return { destructive: false, risk: 'low', readOnly: false, reasons: ['creates a commit'] };
    }
    case 'stash': {
      const op = args[1] ?? 'push';
      if (op === 'drop' || op === 'clear') {
        return destructive('high', 'dropping/clearing stash permanently loses stashed work');
      }
      if (op === 'pop') {
        return { destructive: false, risk: 'medium', readOnly: false, reasons: ['restores stash; may conflict'] };
      }
      if (op === 'list' || op === 'show') {
        return { destructive: false, risk: 'none', readOnly: true, reasons: ['inspects stash'] };
      }
      return { destructive: false, risk: 'low', readOnly: false, reasons: ['saves work to stash (non-destructive)'] };
    }
    case 'add': {
      return { destructive: false, risk: 'low', readOnly: false, reasons: ['stages changes'] };
    }
    case 'filter-branch':
    case 'filter-repo': {
      return destructive('critical', 'history rewriting across the repository');
    }
    case 'update-ref': {
      if (has('-d')) return destructive('high', 'deletes a ref');
      return { destructive: false, risk: 'high', readOnly: false, reasons: ['moves a ref directly'] };
    }
    case 'tag': {
      if (has('-d') || has('--delete')) return destructive('medium', 'deletes a tag');
      return { destructive: false, risk: 'low', readOnly: false, reasons: ['creates a tag'] };
    }
    default: {
      // Unknown git subcommand: be conservative but not falsely destructive.
      return { destructive: false, risk: 'low', readOnly: false, reasons: [`unclassified git ${sub}`] };
    }
  }
}

function hasNewBranchName(args: string[]): boolean {
  // `git branch <name> [<start>]` — a positional after the subcommand indicates
  // branch creation (still non-destructive, but not read-only).
  return args.length >= 2 && !args[1].startsWith('-');
}

/** Aggregate safety across a set of commands. */
export function aggregateSafety(cmds: RecoveryCommandV1[]): {
  destructive: boolean;
  risk: RiskLevelV1;
  reasons: string[];
} {
  let destructive = false;
  let risk: RiskLevelV1 = 'none';
  const reasons: string[] = [];
  for (const cmd of cmds) {
    const s = classifyCommand(cmd);
    destructive = destructive || s.destructive;
    risk = maxRisk(risk, s.risk);
    reasons.push(...s.reasons);
  }
  return { destructive, risk, reasons };
}
