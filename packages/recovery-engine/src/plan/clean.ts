import { git } from '../command.js';
import {
  buildStep,
  check,
  expectation,
  undoNoop,
  type PlanBody,
  type PlanInput,
} from './helpers.js';

/**
 * Clean repository: no recovery required. Only optional read-only verification
 * commands are offered.
 */
export function planClean(_input: PlanInput): PlanBody {
  const steps = [
    buildStep(1, {
      id: 'confirm-clean',
      title: 'Confirm the working tree is clean',
      description:
        'No recovery is required. Optionally confirm the clean state before continuing your work.',
      commands: [
        git(['status', '--short', '--branch'], { readOnly: true }),
        git(['log', '--oneline', '-n', '5'], { readOnly: true }),
      ],
      expectedOutcome: 'git status reports a clean working tree with no pending changes.',
      undoStrategy: undoNoop(),
      verification: expectation(
        'Repository remains clean.',
        [
          check('state', 'eq', 'repository state is clean', 'clean'),
          check('worktree.isDirty', 'isFalse', 'no staged, modified, or untracked changes'),
        ],
        [git(['status', '--porcelain=v2'], { readOnly: true })],
      ),
      applicability: { appliesWhen: 'always', optional: true },
    }),
  ];

  return {
    incidentType: 'clean',
    summary: 'The repository is clean. No recovery action is required.',
    risk: 'none',
    preconditions: [],
    steps,
    alternatives: [],
    warnings: [],
    manualReviewRequired: false,
    incomplete: false,
  };
}
