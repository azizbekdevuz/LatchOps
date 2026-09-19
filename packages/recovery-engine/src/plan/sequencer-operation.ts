import type { RecoveryAlternativeV1 } from '@latchops/schema';
import { git } from '../command.js';
import {
  expectation,
  orderSteps,
  undo,
  undoNoop,
  type PlanBody,
  type PlanInput,
} from './helpers.js';

/**
 * Safe plan for conflicts/operations that are NOT an active merge:
 * cherry-pick, revert, bisect, or an unrecognised conflict source (conflicts
 * present with no MERGE_HEAD). This exists to guarantee the merge-conflict
 * planner never emits `git merge --abort`/`--continue` for the wrong Git
 * operation. It emits only operation-correct commands, and read-only
 * diagnostics otherwise, and always requires manual review.
 */
export function planSequencerOperation(input: PlanInput): PlanBody {
  const { signals } = input;
  const ops = signals.operations;
  const conflictedPaths = signals.worktree.conflictedPaths;
  const hasConflicts = signals.worktree.conflicted > 0;

  const addResolved =
    conflictedPaths.length > 0 ? git(['add', '--', ...conflictedPaths]) : git(['add', '-A']);

  const diagnosticsCommands = [
    git(['status', '--short', '--branch'], { readOnly: true }),
    ...(hasConflicts ? [git(['diff', '--name-only', '--diff-filter=U'], { readOnly: true })] : []),
  ];

  if (ops.cherryPick) {
    return sequencerPlan({
      operation: 'cherry-pick',
      diagnostics: diagnosticsCommands,
      alternatives: [
        continueAlternative('cherry-pick', hasConflicts, addResolved),
        abortAlternative('cherry-pick'),
      ],
      hasConflicts,
    });
  }

  if (ops.revert) {
    return sequencerPlan({
      operation: 'revert',
      diagnostics: diagnosticsCommands,
      alternatives: [
        continueAlternative('revert', hasConflicts, addResolved),
        abortAlternative('revert'),
      ],
      hasConflicts,
    });
  }

  if (ops.bisect) {
    return sequencerPlan({
      operation: 'bisect',
      diagnostics: [
        git(['bisect', 'log'], { readOnly: true }),
        git(['status', '--short', '--branch'], { readOnly: true }),
      ],
      alternatives: [bisectResetAlternative()],
      hasConflicts,
    });
  }

  // Conflicts with no active merge and no recognised operation: refuse to guess.
  return {
    incidentType: 'unknown',
    summary:
      'Conflicts are present but there is no active merge and no recognised operation (cherry-pick, revert, bisect). The conflict source could not be determined; manual review is required.',
    risk: 'medium',
    preconditions: [],
    steps: orderSteps([
      {
        id: 'diagnose-conflict-source',
        title: 'Identify the conflict source (read-only)',
        description:
          'Inspect the repository to determine why conflicts exist. No changes are made and no operation-specific command is issued, because the source is unknown.',
        commands: [
          git(['status', '--short', '--branch'], { readOnly: true }),
          git(['diff', '--name-only', '--diff-filter=U'], { readOnly: true }),
          git(['ls-files', '-u'], { readOnly: true }),
        ],
        expectedOutcome: 'You can see the conflicted paths and determine the operation that created them.',
        undoStrategy: undoNoop(),
        verification: expectation('Conflict source investigated.', [], []),
      },
    ]),
    alternatives: [],
    warnings: [
      'No MERGE_HEAD is present, so this is not an active merge. `git merge --abort` must NOT be run.',
    ],
    manualReviewRequired: true,
    incomplete: true,
  };
}

interface SequencerPlanInput {
  operation: 'cherry-pick' | 'revert' | 'bisect';
  diagnostics: ReturnType<typeof git>[];
  alternatives: RecoveryAlternativeV1[];
  hasConflicts: boolean;
}

function sequencerPlan(input: SequencerPlanInput): PlanBody {
  const { operation } = input;
  return {
    // Kept within the six-value enum: these operations are not first-class
    // incidents yet, so the plan is an explicit manual-review plan.
    incidentType: 'unknown',
    summary: `A ${operation} is in progress${input.hasConflicts ? ' with conflicts' : ''}. This is not a merge; only ${operation}-specific commands are offered. Manual review is required.`,
    risk: input.hasConflicts ? 'medium' : 'low',
    preconditions: [`A ${operation} is in progress.`],
    steps: orderSteps([
      {
        id: 'inspect-operation',
        title: `Inspect the in-progress ${operation}`,
        description: `Review the ${operation} state before acting. No changes are made.`,
        commands: input.diagnostics,
        expectedOutcome: `You understand the current ${operation} state.`,
        undoStrategy: undoNoop(),
        verification: expectation(`${operation} state inspected.`, [], []),
      },
    ]),
    alternatives: input.alternatives,
    warnings: [
      `This is a ${operation}, not a merge. Do not run \`git merge --abort\` or \`git merge --continue\`.`,
    ],
    manualReviewRequired: true,
    incomplete: false,
  };
}

function continueAlternative(
  operation: 'cherry-pick' | 'revert',
  hasConflicts: boolean,
  addResolved: ReturnType<typeof git>,
): RecoveryAlternativeV1 {
  const steps = hasConflicts
    ? orderSteps([
        {
          id: 'resolve-conflicts',
          title: 'Resolve conflict markers',
          description: 'Edit each conflicted file to remove markers and keep the intended content.',
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
          description: 'Mark the resolved paths so the operation can continue.',
          commands: [addResolved],
          expectedOutcome: 'Resolved paths are staged; no unmerged paths remain.',
          prerequisites: ['All conflict markers removed.'],
          undoStrategy: undo('reversible', 'Unstage the files.', {
            commands: [git(['reset'])],
            guaranteed: true,
          }),
          verification: expectation('No unmerged paths remain.', [], [
            git(['diff', '--name-only', '--diff-filter=U'], { readOnly: true }),
          ]),
        },
        {
          id: `${operation}-continue`,
          title: `Continue the ${operation}`,
          description: `Advance the ${operation} after resolving conflicts.`,
          commands: [git([operation, '--continue'])],
          expectedOutcome: `The ${operation} advances (or completes).`,
          prerequisites: ['All conflicts for the current step are resolved and staged.'],
          undoStrategy: undo('partial', `Abort the ${operation} to return to the prior state.`, {
            commands: [git([operation, '--abort'])],
            guaranteed: false,
            notes: `Aborting discards the in-progress ${operation}.`,
          }),
          verification: expectation(`The ${operation} advanced.`, [], [
            git(['status', '--short', '--branch'], { readOnly: true }),
          ]),
        },
      ])
    : orderSteps([
        {
          id: `${operation}-continue`,
          title: `Continue the ${operation}`,
          description: `Advance the ${operation}.`,
          commands: [git([operation, '--continue'])],
          expectedOutcome: `The ${operation} advances (or completes).`,
          undoStrategy: undo('partial', `Abort the ${operation} to return to the prior state.`, {
            commands: [git([operation, '--abort'])],
            guaranteed: false,
            notes: `Aborting discards the in-progress ${operation}.`,
          }),
          verification: expectation(`The ${operation} advanced.`, [], [
            git(['status', '--short', '--branch'], { readOnly: true }),
          ]),
        },
      ]);

  return {
    id: `continue_${operation}`,
    title: `Continue the ${operation}`,
    description: hasConflicts
      ? `Resolve conflicts, stage them, and continue the ${operation}.`
      : `Continue the ${operation}.`,
    risk: 'medium',
    recommended: true,
    tradeoffs: `Keeps the ${operation} in progress and applies it. May pause again on the next conflict.`,
    steps,
    expectedOutcome: expectation(`${operation} completed.`, [], [
      git(['status', '--short', '--branch'], { readOnly: true }),
    ]),
  };
}

function abortAlternative(operation: 'cherry-pick' | 'revert'): RecoveryAlternativeV1 {
  return {
    id: `abort_${operation}`,
    title: `Abort the ${operation}`,
    description: `Discard the in-progress ${operation} and return to the prior state.`,
    risk: 'high',
    recommended: false,
    tradeoffs: `Discards the in-progress ${operation}. The branch returns to the state before it started.`,
    steps: orderSteps([
      {
        id: `${operation}-abort`,
        title: `Abort the ${operation}`,
        description: `Run \`git ${operation} --abort\` to restore the prior state.`,
        commands: [git([operation, '--abort'])],
        expectedOutcome: `The ${operation} is aborted and the prior state is restored.`,
        prerequisites: [`You accept that the in-progress ${operation} will be discarded.`],
        undoStrategy: undo('irreversible', `Re-run the original ${operation} to attempt it again.`, {
          guaranteed: false,
          notes: `Undo is not guaranteed: conflict resolutions performed during the aborted ${operation} are not restored.`,
        }),
        verification: expectation(`${operation} aborted.`, [], [
          git(['status', '--short', '--branch'], { readOnly: true }),
        ]),
      },
    ]),
    expectedOutcome: expectation(`${operation} aborted; prior state restored.`, [], [
      git(['status', '--short', '--branch'], { readOnly: true }),
    ]),
  };
}

function bisectResetAlternative(): RecoveryAlternativeV1 {
  return {
    id: 'reset_bisect',
    title: 'End the bisect session',
    description: 'Stop bisecting and return HEAD to where it was before the bisect started.',
    risk: 'medium',
    recommended: true,
    tradeoffs: 'Ends the bisect and restores the original HEAD. Bisect progress/log is discarded.',
    steps: orderSteps([
      {
        id: 'bisect-reset',
        title: 'Reset the bisect',
        description: 'Run `git bisect reset` to end the session and restore the original branch.',
        commands: [git(['bisect', 'reset'])],
        expectedOutcome: 'Bisect ends; HEAD returns to the pre-bisect position.',
        prerequisites: ['You want to stop the bisect session.'],
        undoStrategy: undo('partial', 'Restart the bisect if needed.', {
          commands: [git(['bisect', 'start'])],
          guaranteed: false,
          notes: 'Restarting begins a new bisect; the prior good/bad markings are not restored.',
        }),
        verification: expectation('Bisect is no longer active.', [], [
          git(['status', '--short', '--branch'], { readOnly: true }),
        ]),
      },
    ]),
    expectedOutcome: expectation('Bisect ended; original HEAD restored.', [], [
      git(['status', '--short', '--branch'], { readOnly: true }),
    ]),
  };
}
