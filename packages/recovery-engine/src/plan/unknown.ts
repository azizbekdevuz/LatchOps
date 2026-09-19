import { git } from '../command.js';
import {
  expectation,
  orderSteps,
  undoNoop,
  type PlanBody,
  type PlanInput,
} from './helpers.js';

/**
 * Unknown state: no fabricated solution. Emit a read-only diagnostic plan and
 * require manual review, explaining why automated recovery is unavailable.
 */
export function planUnknown(input: PlanInput): PlanBody {
  const reasons = input.signals.reasons;

  const steps = orderSteps([
    {
      id: 'gather-diagnostics',
      title: 'Gather read-only diagnostics',
      description:
        'Run these read-only commands to characterize the repository state. No changes are made.',
      commands: [
        git(['status', '--short', '--branch'], { readOnly: true }),
        git(['rev-parse', '--is-inside-work-tree'], { readOnly: true }),
        git(['symbolic-ref', '--quiet', 'HEAD'], { readOnly: true }),
        git(['reflog', '-n', '20'], { readOnly: true }),
        git(['log', '--oneline', '--decorate', '-n', '20'], { readOnly: true }),
      ],
      expectedOutcome: 'You collect enough detail to classify the state manually.',
      undoStrategy: undoNoop(),
      verification: expectation('Diagnostics gathered for manual review.', [], []),
    },
  ]);

  return {
    incidentType: 'unknown',
    summary:
      'The repository state could not be classified into a known incident type. Automated recovery is not available; manual review is required.',
    risk: 'low',
    preconditions: [],
    steps,
    alternatives: [],
    warnings: [
      'No automated recovery is offered for an unknown state to avoid unsafe assumptions.',
      ...(reasons.length > 0 ? [`Classifier notes: ${reasons.join('; ')}`] : []),
    ],
    manualReviewRequired: true,
    incomplete: true,
  };
}
