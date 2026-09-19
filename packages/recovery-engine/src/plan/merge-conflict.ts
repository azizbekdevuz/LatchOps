import type { RecoveryAlternativeV1 } from '@latchops/schema';
import { git } from '../command.js';
import { rescueBranchName } from '../reflog.js';
import { planSequencerOperation } from './sequencer-operation.js';
import {
  check,
  expectation,
  orderSteps,
  undo,
  undoNoop,
  type PlanBody,
  type PlanInput,
} from './helpers.js';

/**
 * Merge conflict: inspect unmerged paths, then offer two mutually exclusive
 * paths — complete the merge or abort it. Aborting is never assumed correct.
 */
export function planMergeConflict(input: PlanInput): PlanBody {
  const { snapshot, signals } = input;

  // Defense in depth: only an ACTIVE merge (MERGE_HEAD present) may receive
  // merge-specific commands. Any other conflict source (cherry-pick, revert,
  // bisect, unknown) is delegated to the safe sequencer/manual-review plan so
  // we never emit `git merge --abort`/`--continue` for the wrong operation.
  if (!signals.operations.merge) {
    return planSequencerOperation(input);
  }

  const conflictedPaths = signals.worktree.conflictedPaths;
  const oid = snapshot.branch.oid ?? '';
  const backupBranch = rescueBranchName(oid || 'merge');

  // Concrete `git add <path>` commands for the real unmerged paths, when known.
  const addResolved =
    conflictedPaths.length > 0
      ? git(['add', '--', ...conflictedPaths])
      : git(['add', '-A']);

  // Common inspection steps.
  const steps = orderSteps([
    {
      id: 'inspect-unmerged',
      title: 'List unmerged paths',
      description: `Identify the ${conflictedPaths.length || 'conflicted'} path(s) with conflicts.`,
      commands: [
        git(['status', '--short', '--branch'], { readOnly: true }),
        git(['diff', '--name-only', '--diff-filter=U'], { readOnly: true }),
      ],
      expectedOutcome: 'You can see every path that still has conflict markers.',
      undoStrategy: undoNoop(),
      verification: expectation('Unmerged paths listed.', [], [
        git(['diff', '--name-only', '--diff-filter=U'], { readOnly: true }),
      ]),
    },
    {
      id: 'inspect-stages',
      title: 'Inspect conflict stages',
      description:
        'Review the base (stage 1), ours (stage 2), and theirs (stage 3) content for each conflict.',
      commands: [
        git(['diff', '--diff-filter=U'], { readOnly: true }),
        git(['ls-files', '-u'], { readOnly: true }),
      ],
      expectedOutcome: 'You understand what changed on each side of the conflict.',
      undoStrategy: undoNoop(),
      verification: expectation('Conflict stages reviewed.', [], []),
    },
  ]);

  const alternatives: RecoveryAlternativeV1[] = [
    completeMergeAlternative(addResolved),
    abortMergeAlternative(backupBranch, oid),
  ];

  const warnings = [
    'Do not assume aborting is correct. Completing the merge preserves the integration work already done.',
  ];

  return {
    incidentType: 'merge_conflict',
    summary: `Merge in progress with ${conflictedPaths.length || 'one or more'} conflicted path(s). Choose to complete or abort the merge.`,
    risk: 'medium',
    preconditions: ['A merge is in progress (MERGE_HEAD present).'],
    steps,
    alternatives,
    warnings,
    manualReviewRequired: false,
    incomplete: false,
  };
}

function completeMergeAlternative(addResolved: ReturnType<typeof git>): RecoveryAlternativeV1 {
  return {
    id: 'complete_merge',
    title: 'Complete the merge',
    description: 'Resolve each conflict, mark the paths resolved, and finish the merge commit.',
    risk: 'medium',
    recommended: true,
    tradeoffs:
      'Keeps the integration work. Requires manually resolving conflict markers; a wrong resolution can be reverted by re-editing before committing.',
    steps: orderSteps([
      {
        id: 'resolve-conflicts',
        title: 'Resolve conflict markers',
        description:
          'Edit each unmerged file to remove <<<<<<< / ======= / >>>>>>> markers and keep the intended content. This is a manual edit; no command performs it.',
        commands: [git(['diff', '--diff-filter=U'], { readOnly: true })],
        expectedOutcome: 'Conflict markers are removed and each file contains the intended result.',
        prerequisites: ['You have reviewed both sides of every conflict.'],
        undoStrategy: undo(
          'reversible',
          'Restore the conflicted version of a file to redo resolution.',
          {
            commands: [git(['checkout', '--merge', '--', '<file>'], { containsPlaceholder: true })],
            notes: '<file> is a user-supplied placeholder for the path to reset to its conflicted state.',
          },
        ),
        verification: expectation(
          'No conflict markers remain in the working files.',
          [],
          [git(['diff', '--check'], { readOnly: true })],
        ),
        applicability: { appliesWhen: 'conflicts require manual resolution', optional: false },
      },
      {
        id: 'mark-resolved',
        title: 'Mark conflicts resolved',
        description: 'Stage the resolved files to mark them as no longer conflicted.',
        commands: [addResolved],
        expectedOutcome: 'The previously unmerged paths are staged and no longer conflicted.',
        prerequisites: ['All conflict markers have been removed.'],
        undoStrategy: undo('reversible', 'Unstage to return files to their conflicted state.', {
          commands: [git(['reset'])],
          guaranteed: true,
        }),
        verification: expectation(
          'No unmerged paths remain in the index.',
          [check('worktree.conflicted', 'eq', 'no conflicted paths remain', 0)],
          [git(['diff', '--name-only', '--diff-filter=U'], { readOnly: true })],
        ),
      },
      {
        id: 'commit-merge',
        title: 'Finish the merge commit',
        description: 'Create the merge commit using the prepared merge message.',
        commands: [git(['commit', '--no-edit'])],
        expectedOutcome: 'The merge commit is created; MERGE_HEAD is cleared.',
        prerequisites: ['All conflicts are resolved and staged.'],
        undoStrategy: undo(
          'partial',
          'Undo the merge commit, keeping the merged content staged.',
          {
            commands: [git(['reset', '--soft', 'HEAD~1'])],
            recoveryReference: 'HEAD~1',
            guaranteed: false,
            notes:
              'Returns to a pre-commit state but does not automatically restore the mid-merge conflicted index.',
          },
        ),
        verification: expectation(
          'Merge finished: no active merge and no unmerged paths.',
          [
            check('operations.merge', 'isFalse', 'MERGE_HEAD removed (merge no longer active)'),
            check('worktree.conflicted', 'eq', 'no conflicted paths remain', 0),
          ],
          [git(['status', '--short', '--branch'], { readOnly: true })],
        ),
      },
    ]),
    expectedOutcome: expectation(
      'Merge completed: MERGE_HEAD gone and no unmerged paths remain.',
      [
        check('operations.merge', 'isFalse', 'merge no longer active'),
        check('worktree.conflicted', 'eq', 'no conflicted paths', 0),
      ],
      [git(['status', '--short', '--branch'], { readOnly: true })],
    ),
  };
}

function abortMergeAlternative(backupBranch: string, oid: string): RecoveryAlternativeV1 {
  const hasConcreteOid = oid.length > 0;
  return {
    id: 'abort_merge',
    title: 'Abort the merge',
    description:
      'Discard the in-progress merge and return to the pre-merge state. Preserve any partial resolutions first.',
    risk: 'high',
    recommended: false,
    tradeoffs:
      'Discards all conflict resolution work done during this merge. The pre-merge branch state is restored. Preserve partial work first if you may need it.',
    steps: orderSteps([
      {
        id: 'preserve-before-abort',
        title: 'Preserve in-progress work (optional)',
        description:
          'Save any partial conflict resolutions to a patch before aborting, in case you need them later.',
        commands: [git(['diff', 'HEAD', '--output', 'latchops-merge-wip.patch'])],
        expectedOutcome: 'A patch of in-progress changes is written to latchops-merge-wip.patch.',
        undoStrategy: undo('reversible', 'Delete the patch file; no repository state changed.', {
          guaranteed: true,
        }),
        verification: expectation('A backup patch exists on disk before aborting.', [], []),
        applicability: { appliesWhen: 'you may need the partial resolutions later', optional: true },
      },
      {
        id: 'merge-abort',
        title: 'Abort the merge',
        description: 'Run the abort to restore the pre-merge state.',
        commands: [git(['merge', '--abort'])],
        expectedOutcome: 'MERGE_HEAD is cleared and the working tree returns to the pre-merge commit.',
        prerequisites: [
          'You have preserved any partial resolution work you may need.',
          'You accept that in-merge changes will be discarded.',
        ],
        undoStrategy: undo(
          'partial',
          hasConcreteOid
            ? `Re-run the merge from the same commit to reach the conflicted state again.`
            : 'Re-run the original merge to reach the conflicted state again.',
          {
            recoveryReference: hasConcreteOid ? oid : undefined,
            guaranteed: false,
            notes:
              'Undo is not guaranteed: the specific conflict resolutions performed before abort are not restored by re-running the merge.',
          },
        ),
        verification: expectation(
          'Merge aborted: no active merge and no unmerged paths.',
          [
            check('operations.merge', 'isFalse', 'MERGE_HEAD removed'),
            check('worktree.conflicted', 'eq', 'no conflicted paths remain', 0),
          ],
          [git(['status', '--short', '--branch'], { readOnly: true })],
        ),
      },
    ]),
    expectedOutcome: expectation(
      'Merge aborted: MERGE_HEAD gone and no unmerged paths remain.',
      [
        check('operations.merge', 'isFalse', 'merge no longer active'),
        check('worktree.conflicted', 'eq', 'no conflicted paths', 0),
      ],
      [git(['status', '--short', '--branch'], { readOnly: true })],
    ),
  };
}
