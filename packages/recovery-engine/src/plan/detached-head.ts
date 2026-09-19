import { git } from '../command.js';
import { analyzeDetached } from '../reflog.js';
import {
  check,
  expectation,
  orderSteps,
  undo,
  undoNoop,
  type PlanBody,
  type PlanInput,
  type StepInput,
} from './helpers.js';

/**
 * Detached HEAD: always preserve the current commit on a concrete rescue branch
 * first, then either switch to a confidently-identified branch or fall back to
 * a manual-review path with deterministic discovery commands. Detached commits
 * are never discarded by default.
 */
export function planDetachedHead(input: PlanInput): PlanBody {
  const { snapshot } = input;
  const analysis = analyzeDetached(snapshot);
  const oid = analysis.currentOid;
  const rescue = analysis.rescueBranch;

  if (!oid) {
    // No concrete commit to anchor on — refuse to guess.
    return manualReviewPlan(rescue, oid, analysis.candidateBranches, 'HEAD commit could not be read from the snapshot.');
  }

  const preserveStep: StepInput = {
    id: 'create-safety-branch',
    title: 'Preserve the current commit on a rescue branch',
    description: `Create branch ${rescue} pointing at the current commit ${shortOid(oid)} so the detached work cannot be lost.`,
    commands: [git(['branch', rescue, oid])],
    expectedOutcome: `Branch ${rescue} now references ${shortOid(oid)}; the detached commit is safe.`,
    prerequisites: [`Branch name ${rescue} is not already in use.`],
    undoStrategy: undo('reversible', 'Delete the rescue branch (the commit stays reachable via reflog).', {
      commands: [git(['branch', '-D', rescue])],
      recoveryReference: oid,
      guaranteed: true,
    }),
    verification: expectation(
      'The rescue branch exists and references the original commit.',
      [],
      [git(['branch', '--contains', oid], { readOnly: true })],
    ),
  };

  if (!analysis.hasConfidentTarget || !analysis.target) {
    // We preserved the commit, but cannot safely choose a destination.
    return manualReviewPlan(
      rescue,
      oid,
      analysis.candidateBranches,
      'No single safe destination branch could be determined from reflog/log decorations.',
      preserveStep,
    );
  }

  const target = analysis.target;

  const steps = orderSteps([
    preserveStep,
    {
      id: 'switch-to-branch',
      title: `Reattach HEAD to ${target}`,
      description: `Switch to ${target}, reattaching HEAD to a named branch.`,
      commands: [git(['switch', target])],
      expectedOutcome: `HEAD is attached to ${target}.`,
      prerequisites: [
        'The working tree is clean or your changes are stashed (switch refuses if it would lose changes).',
      ],
      undoStrategy: undo('reversible', 'Return to the detached commit.', {
        commands: [git(['switch', '--detach', oid])],
        recoveryReference: oid,
        guaranteed: true,
      }),
      verification: expectation(
        `HEAD is attached to ${target}.`,
        [check('branch.isDetached', 'isFalse', 'HEAD is attached to a branch')],
        [git(['status', '--short', '--branch'], { readOnly: true })],
      ),
    },
    {
      id: 'integrate-commits',
      title: 'Integrate the rescued commit (optional)',
      description: `If ${shortOid(oid)} contains work not already on ${target}, merge ${rescue} into ${target}. Skip if the commit is already reachable from ${target}.`,
      commands: [git(['merge', '--no-ff', rescue])],
      expectedOutcome: `The rescued work is integrated into ${target} if it was not already present.`,
      prerequisites: [
        `Confirm whether ${shortOid(oid)} is already reachable from ${target} (git branch --contains ${shortOid(oid)}).`,
      ],
      undoStrategy: undo('reversible', 'Undo the integration merge, keeping the merged content staged.', {
        commands: [git(['reset', '--soft', 'HEAD~1'])],
        recoveryReference: 'HEAD~1',
        guaranteed: true,
      }),
      verification: expectation(
        `${target} now contains the rescued commit.`,
        [],
        [git(['branch', '--contains', oid], { readOnly: true })],
      ),
      applicability: { appliesWhen: `${shortOid(oid)} is not already reachable from ${target}`, optional: true },
    },
  ]);

  return {
    incidentType: 'detached_head',
    summary: `HEAD is detached at ${shortOid(oid)}. Preserve the commit on ${rescue}, then reattach to ${target}.`,
    risk: 'medium',
    preconditions: ['HEAD is detached (not pointing at a branch).'],
    steps,
    alternatives: [],
    warnings: [
      `The detached commit ${shortOid(oid)} is preserved on ${rescue} before any switch, so it cannot be lost.`,
    ],
    manualReviewRequired: false,
    incomplete: false,
  };
}

function manualReviewPlan(
  rescue: string,
  oid: string,
  candidates: string[],
  reason: string,
  preserveStep?: StepInput,
): PlanBody {
  const discovery: StepInput = {
    id: 'discover-destinations',
    title: 'Discover safe destination branches',
    description:
      'Run these read-only commands to find which branches contain the current commit and where you recently were, then choose a destination manually.',
    commands: [
      oid
        ? git(['branch', '--contains', oid], { readOnly: true })
        : git(['branch', '--all'], { readOnly: true }),
      git(['reflog', '-n', '20'], { readOnly: true }),
      git(['log', '--oneline', '--decorate', '-n', '20'], { readOnly: true }),
    ],
    expectedOutcome: 'You can see candidate branches and recent history to pick a destination.',
    undoStrategy: undoNoop(),
    verification: expectation('Destination candidates enumerated.', [], []),
  };

  const chooseAndSwitch: StepInput = {
    id: 'switch-manual',
    title: 'Switch to the chosen branch (manual)',
    description:
      'After choosing a destination from the discovery output, reattach HEAD. The branch name is a placeholder you must supply.',
    commands: [git(['switch', '<branch-name>'], { containsPlaceholder: true })],
    expectedOutcome: 'HEAD is attached to the branch you selected.',
    prerequisites: ['You have chosen a concrete destination branch from the discovery output.'],
    undoStrategy: undo('reversible', 'Return to the detached commit.', {
      commands: oid ? [git(['switch', '--detach', oid])] : [],
      recoveryReference: oid || undefined,
      guaranteed: Boolean(oid),
      notes: '<branch-name> is a user-supplied placeholder; do not run this verbatim.',
    }),
    verification: expectation(
      'HEAD is attached to a branch.',
      [check('branch.isDetached', 'isFalse', 'HEAD is attached to a branch')],
      [git(['status', '--short', '--branch'], { readOnly: true })],
    ),
    applicability: { appliesWhen: 'a destination has been chosen manually', optional: false },
  };

  const stepInputs: StepInput[] = [];
  if (preserveStep) stepInputs.push(preserveStep);
  stepInputs.push(discovery, chooseAndSwitch);

  const candidateNote =
    candidates.length > 0
      ? `Observed candidate branches: ${candidates.join(', ')}.`
      : 'No candidate branches were observed in recent history.';

  return {
    incidentType: 'detached_head',
    summary: `HEAD is detached${oid ? ` at ${shortOid(oid)}` : ''}. ${reason} Manual selection of a destination branch is required.`,
    risk: 'medium',
    preconditions: ['HEAD is detached (not pointing at a branch).'],
    steps: orderSteps(stepInputs),
    alternatives: [],
    warnings: [
      reason,
      candidateNote,
      oid ? `The commit ${shortOid(oid)} is preserved on ${rescue}, so it cannot be lost.` : '',
    ].filter(Boolean),
    manualReviewRequired: true,
    incomplete: true,
  };
}

function shortOid(oid: string): string {
  return oid && /^[0-9a-f]{7,40}$/i.test(oid) ? oid.slice(0, 8) : oid;
}
