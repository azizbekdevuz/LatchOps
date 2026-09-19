import type { RecoveryAlternativeV1 } from '@latchops/schema';
import { git } from '../command.js';
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
 * Rebase in progress: distinguish conflicted vs non-conflicted, and offer
 * continue / abort / skip as explicit alternatives. `--skip` is never
 * recommended by default because it drops a commit.
 */
export function planRebaseInProgress(input: PlanInput): PlanBody {
  const { snapshot, signals } = input;
  const hasConflicts = signals.worktree.conflicted > 0;
  const conflictedPaths = signals.worktree.conflictedPaths;
  const headName = snapshot.rebaseState.headName;
  const onto = snapshot.rebaseState.onto;

  const addResolved =
    conflictedPaths.length > 0 ? git(['add', '--', ...conflictedPaths]) : git(['add', '-A']);

  const steps = orderSteps([
    {
      id: 'inspect-rebase',
      title: 'Inspect the rebase state',
      description: `Review the in-progress rebase${headName ? ` of ${headName}` : ''}${onto ? ` onto ${onto}` : ''} and whether conflicts are present.`,
      commands: [
        git(['status', '--short', '--branch'], { readOnly: true }),
        ...(hasConflicts ? [git(['diff', '--name-only', '--diff-filter=U'], { readOnly: true })] : []),
      ],
      expectedOutcome: hasConflicts
        ? 'You can see which paths are conflicted and must be resolved before continuing.'
        : 'You can see the current rebase position.',
      undoStrategy: undoNoop(),
      verification: expectation('Rebase state inspected.', [], [
        git(['status', '--short', '--branch'], { readOnly: true }),
      ]),
    },
  ]);

  const alternatives: RecoveryAlternativeV1[] = [
    continueAlternative(hasConflicts, addResolved),
    abortAlternative(),
    skipAlternative(),
  ];

  const warnings = [
    'Do not use `git rebase --skip` unless you have explicitly decided the current commit should be dropped.',
  ];
  if (hasConflicts) {
    warnings.push('The rebase is paused on conflicts. Resolve them before continuing.');
  }

  return {
    incidentType: 'rebase_in_progress',
    summary: `Rebase in progress${hasConflicts ? ' with conflicts' : ''}${headName ? ` (${headName}${onto ? ` onto ${onto}` : ''})` : ''}. Choose to continue, abort, or (deliberately) skip.`,
    risk: 'medium',
    preconditions: ['A rebase is in progress (rebase metadata present).'],
    steps,
    alternatives,
    warnings,
    manualReviewRequired: false,
    incomplete: false,
  };
}

function continueAlternative(
  hasConflicts: boolean,
  addResolved: ReturnType<typeof git>,
): RecoveryAlternativeV1 {
  const steps = hasConflicts
    ? orderSteps([
        {
          id: 'resolve-conflicts',
          title: 'Resolve conflict markers',
          description:
            'Edit each conflicted file to remove markers and keep the intended content. This is a manual edit.',
          commands: [git(['diff', '--diff-filter=U'], { readOnly: true })],
          expectedOutcome: 'Conflict markers are removed from all files.',
          prerequisites: ['You have reviewed both sides of every conflict.'],
          undoStrategy: undo('reversible', 'Re-checkout a file to its conflicted state.', {
            commands: [git(['checkout', '--merge', '--', '<file>'], { containsPlaceholder: true })],
            notes: '<file> is a user-supplied placeholder.',
          }),
          verification: expectation('No conflict markers remain.', [], [
            git(['diff', '--check'], { readOnly: true }),
          ]),
          applicability: { appliesWhen: 'conflicts are present', optional: false },
        },
        {
          id: 'stage-resolved',
          title: 'Stage resolved files',
          description: 'Mark the resolved paths so the rebase can proceed.',
          commands: [addResolved],
          expectedOutcome: 'Resolved paths are staged; no unmerged paths remain.',
          prerequisites: ['All conflict markers removed.'],
          undoStrategy: undo('reversible', 'Unstage the files.', {
            commands: [git(['reset'])],
            guaranteed: true,
          }),
          verification: expectation(
            'No unmerged paths remain.',
            [check('worktree.conflicted', 'eq', 'no conflicted paths remain', 0)],
            [git(['diff', '--name-only', '--diff-filter=U'], { readOnly: true })],
          ),
        },
        {
          id: 'rebase-continue',
          title: 'Continue the rebase',
          description: 'Advance the rebase to the next step (or completion).',
          commands: [git(['rebase', '--continue'])],
          expectedOutcome: 'The rebase advances; it completes if there are no further conflicts.',
          prerequisites: ['All conflicts for the current step are resolved and staged.'],
          undoStrategy: undo(
            'partial',
            'Abort the rebase to return to the pre-rebase branch state.',
            {
              commands: [git(['rebase', '--abort'])],
              guaranteed: false,
              notes: 'Aborting discards progress made so far in this rebase.',
            },
          ),
          verification: expectation(
            'Rebase is no longer in progress once fully complete.',
            [check('operations.rebase', 'isFalse', 'rebase metadata removed')],
            [git(['status', '--short', '--branch'], { readOnly: true })],
          ),
        },
      ])
    : orderSteps([
        {
          id: 'rebase-continue',
          title: 'Continue the rebase',
          description: 'Advance the rebase to the next step (or completion).',
          commands: [git(['rebase', '--continue'])],
          expectedOutcome: 'The rebase advances; it completes if there are no further conflicts.',
          undoStrategy: undo(
            'partial',
            'Abort the rebase to return to the pre-rebase branch state.',
            {
              commands: [git(['rebase', '--abort'])],
              guaranteed: false,
              notes: 'Aborting discards progress made so far in this rebase.',
            },
          ),
          verification: expectation(
            'Rebase is no longer in progress once fully complete.',
            [check('operations.rebase', 'isFalse', 'rebase metadata removed')],
            [git(['status', '--short', '--branch'], { readOnly: true })],
          ),
        },
      ]);

  return {
    id: 'continue_rebase',
    title: 'Continue the rebase',
    description: hasConflicts
      ? 'Resolve the current conflicts, stage them, and continue.'
      : 'Continue the rebase to completion.',
    risk: 'medium',
    recommended: true,
    tradeoffs: 'Keeps all commits being rebased. May pause again at the next conflicting commit.',
    steps,
    expectedOutcome: expectation(
      'Rebase completes: rebase metadata is gone.',
      [check('operations.rebase', 'isFalse', 'rebase no longer in progress')],
      [git(['status', '--short', '--branch'], { readOnly: true })],
    ),
  };
}

function abortAlternative(): RecoveryAlternativeV1 {
  return {
    id: 'abort_rebase',
    title: 'Abort the rebase',
    description: 'Discard the in-progress rebase and return to the pre-rebase branch state.',
    risk: 'high',
    recommended: false,
    tradeoffs:
      'Discards all progress made during this rebase and restores the original branch tip. Preserve partial work first if needed.',
    steps: orderSteps([
      {
        id: 'preserve-before-abort',
        title: 'Preserve in-progress work (optional)',
        description: 'Save any partial changes to a patch before aborting.',
        commands: [git(['diff', 'HEAD', '--output', 'latchops-rebase-wip.patch'])],
        expectedOutcome: 'A patch of in-progress changes is written to latchops-rebase-wip.patch.',
        undoStrategy: undo('reversible', 'Delete the patch file; no repository state changed.', {
          guaranteed: true,
        }),
        verification: expectation('A backup patch exists on disk before aborting.', [], []),
        applicability: { appliesWhen: 'you may need the partial work later', optional: true },
      },
      {
        id: 'rebase-abort',
        title: 'Abort the rebase',
        description: 'Return the branch to its pre-rebase state.',
        commands: [git(['rebase', '--abort'])],
        expectedOutcome: 'Rebase metadata is removed and the original branch tip is restored.',
        prerequisites: ['You accept that rebase progress will be discarded.'],
        undoStrategy: undo('irreversible', 'Re-run the original rebase to attempt it again.', {
          guaranteed: false,
          notes:
            'Undo is not guaranteed: the specific conflict resolutions performed during the aborted rebase are not restored.',
        }),
        verification: expectation(
          'Rebase aborted: rebase metadata is gone.',
          [check('operations.rebase', 'isFalse', 'rebase metadata removed')],
          [git(['status', '--short', '--branch'], { readOnly: true })],
        ),
      },
    ]),
    expectedOutcome: expectation(
      'Rebase aborted: rebase metadata is gone.',
      [check('operations.rebase', 'isFalse', 'rebase no longer in progress')],
      [git(['status', '--short', '--branch'], { readOnly: true })],
    ),
  };
}

function skipAlternative(): RecoveryAlternativeV1 {
  return {
    id: 'skip_commit',
    title: 'Skip the current commit (deliberate)',
    description:
      'Drop the commit the rebase is currently applying and continue. Only choose this if you have decided the commit should be omitted.',
    risk: 'high',
    recommended: false,
    tradeoffs:
      'Permanently omits the current commit from the rebased history. Its changes will not be present unless recovered from reflog.',
    steps: orderSteps([
      {
        id: 'rebase-skip',
        title: 'Skip the current commit',
        description: 'Drop the current commit and advance the rebase.',
        commands: [git(['rebase', '--skip'])],
        expectedOutcome: 'The current commit is omitted and the rebase advances.',
        prerequisites: ['You have explicitly decided this commit should be dropped.'],
        undoStrategy: undo(
          'partial',
          'Recover the dropped commit from reflog if you change your mind.',
          {
            commands: [git(['reflog'], { readOnly: true })],
            guaranteed: false,
            notes:
              'The dropped commit remains in reflog for a time but is not on any branch; recovery is manual and time-limited.',
          },
        ),
        verification: expectation(
          'The rebase advanced past the skipped commit.',
          [],
          [git(['status', '--short', '--branch'], { readOnly: true })],
        ),
      },
    ]),
    expectedOutcome: expectation(
      'Rebase advanced with the current commit omitted.',
      [],
      [git(['status', '--short', '--branch'], { readOnly: true })],
    ),
  };
}
