import type { RecoveryAlternativeV1 } from '@latchops/schema';
import { git } from '../command.js';
import {
  buildStep,
  check,
  expectation,
  orderSteps,
  undo,
  undoNoop,
  type PlanBody,
  type PlanInput,
} from './helpers.js';

/**
 * Dirty worktree: distinguish staged / modified / untracked / conflicted and
 * offer non-destructive preservation options. Never blindly recommends
 * `git reset --hard`.
 */
export function planDirtyWorktree(input: PlanInput): PlanBody {
  const { signals } = input;
  const { staged, modified, untracked, conflicted } = signals.worktree;

  const inventory: string[] = [];
  if (staged > 0) inventory.push(`${staged} staged`);
  if (modified > 0) inventory.push(`${modified} modified`);
  if (untracked > 0) inventory.push(`${untracked} untracked`);
  if (conflicted > 0) inventory.push(`${conflicted} conflicted`);

  const warnings: string[] = [];
  if (conflicted > 0) {
    warnings.push(
      'Conflicted paths are present. Resolve conflicts (see the merge-conflict guidance) before preserving or committing.',
    );
  }

  // Common, non-destructive inspection steps.
  const steps = orderSteps([
    {
      id: 'inspect-status',
      title: 'Review the pending changes',
      description: `Inspect what is staged, modified, and untracked (${inventory.join(', ') || 'no changes'}).`,
      commands: [
        git(['status', '--short', '--branch'], { readOnly: true }),
        git(['diff', '--stat'], { readOnly: true }),
        git(['diff', '--stat', '--staged'], { readOnly: true }),
      ],
      expectedOutcome: 'You can see exactly which files are staged, modified, and untracked.',
      undoStrategy: undoNoop(),
      verification: expectation('Change inventory reviewed.', [], [
        git(['status', '--porcelain=v2'], { readOnly: true }),
      ]),
    },
  ]);

  // Preservation alternatives (mutually exclusive user decisions).
  const alternatives: RecoveryAlternativeV1[] = [];

  // 1) Stash including untracked (recommended default preservation).
  alternatives.push({
    id: 'stash',
    title: 'Stash all changes (including untracked)',
    description:
      'Save staged, modified, and untracked changes to a stash, leaving a clean working tree you can restore later.',
    risk: 'low',
    recommended: true,
    tradeoffs:
      'Non-destructive: work is preserved in the stash and fully restorable with `git stash pop`. Reapplying may cause conflicts if the base has moved.',
    steps: [
      buildStep(1, {
        id: 'stash-push',
        title: 'Create a stash including untracked files',
        description: 'Preserve all current work to a named stash.',
        commands: [git(['stash', 'push', '--include-untracked', '-m', 'latchops-checkpoint'])],
        expectedOutcome: 'Working tree becomes clean; changes are saved to stash@{0}.',
        prerequisites: ['Review the pending changes so you know what is being stashed.'],
        undoStrategy: undo('reversible', 'Restore the stashed changes.', {
          commands: [git(['stash', 'pop'])],
          recoveryReference: 'stash@{0}',
          guaranteed: true,
        }),
        verification: expectation(
          'Working tree is clean and the stash exists.',
          [check('worktree.isDirty', 'isFalse', 'working tree no longer dirty')],
          [git(['stash', 'list'], { readOnly: true })],
        ),
      }),
    ],
    expectedOutcome: expectation(
      'Working tree is clean; changes preserved in the stash.',
      [check('worktree.isDirty', 'isFalse', 'no pending changes remain in the working tree')],
      [git(['stash', 'list'], { readOnly: true })],
    ),
  });

  // 2) Create a patch file (fully non-destructive, keeps working tree as-is).
  alternatives.push({
    id: 'patch',
    title: 'Export changes to a patch file',
    description:
      'Write tracked changes to a patch file for backup or review without altering the working tree.',
    risk: 'none',
    recommended: false,
    tradeoffs:
      'Fully non-destructive; the working tree is untouched. Untracked files are not included in a diff patch and must be backed up separately.',
    steps: [
      buildStep(1, {
        id: 'write-patch',
        title: 'Write a patch of tracked changes',
        description:
          'Create latchops-changes.patch containing staged and unstaged tracked changes.',
        commands: [git(['diff', 'HEAD', '--output', 'latchops-changes.patch'], { readOnly: false })],
        expectedOutcome: 'latchops-changes.patch is created; the working tree is unchanged.',
        undoStrategy: undo('reversible', 'Delete the patch file; no repository state changed.', {
          guaranteed: true,
        }),
        verification: expectation(
          'A patch file was produced (verify on disk) and the working tree remains dirty by design.',
          [],
          [git(['status', '--short'], { readOnly: true })],
        ),
        applicability: { appliesWhen: 'tracked changes exist', optional: false },
      }),
    ],
    expectedOutcome: expectation(
      'Patch created; working tree intentionally unchanged (evidence is the patch file on disk).',
      [],
      [git(['status', '--short'], { readOnly: true })],
    ),
  });

  // 3) Checkpoint commit — optional user decision.
  alternatives.push({
    id: 'checkpoint-commit',
    title: 'Create a checkpoint commit (optional)',
    description:
      'Commit the current work as a checkpoint on the current branch so it is captured in history.',
    risk: 'low',
    recommended: false,
    tradeoffs:
      'Non-destructive and reversible with `git reset --soft HEAD~1`, which keeps your changes staged. Adds a commit you may want to amend or squash later.',
    steps: orderSteps([
      {
        id: 'stage-all',
        title: 'Stage all changes',
        description: 'Stage tracked and untracked changes for the checkpoint commit.',
        commands: [git(['add', '-A'])],
        expectedOutcome: 'All changes are staged.',
        undoStrategy: undo('reversible', 'Unstage everything.', {
          commands: [git(['reset'])],
          guaranteed: true,
        }),
        verification: expectation('Changes are staged.', [], [
          git(['status', '--short'], { readOnly: true }),
        ]),
      },
      {
        id: 'checkpoint',
        title: 'Create the checkpoint commit',
        description: 'Record the staged work as a checkpoint commit.',
        commands: [git(['commit', '-m', 'latchops checkpoint'])],
        expectedOutcome: 'A new commit captures the work; the working tree becomes clean.',
        prerequisites: ['All intended changes are staged.'],
        undoStrategy: undo(
          'reversible',
          'Undo the checkpoint commit while keeping the changes staged.',
          {
            commands: [git(['reset', '--soft', 'HEAD~1'])],
            recoveryReference: 'HEAD~1',
            guaranteed: true,
          },
        ),
        verification: expectation(
          'A checkpoint commit exists and the working tree is clean.',
          [check('worktree.isDirty', 'isFalse', 'no pending changes remain')],
          [git(['log', '--oneline', '-n', '1'], { readOnly: true })],
        ),
      },
    ]),
    expectedOutcome: expectation(
      'Work captured in a checkpoint commit; working tree clean.',
      [check('worktree.isDirty', 'isFalse', 'no pending changes remain')],
      [git(['log', '--oneline', '-n', '1'], { readOnly: true })],
    ),
  });

  return {
    incidentType: 'dirty_worktree',
    summary: `Uncommitted changes present (${inventory.join(', ') || 'changes detected'}). Preserve your work before doing anything destructive.`,
    risk: conflicted > 0 ? 'medium' : 'low',
    preconditions: [
      'Do not run destructive commands (reset --hard, clean, checkout --) before preserving work.',
    ],
    steps,
    alternatives,
    warnings,
    manualReviewRequired: false,
    incomplete: false,
  };
}
