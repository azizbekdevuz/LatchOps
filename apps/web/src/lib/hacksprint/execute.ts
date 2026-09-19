import type { RecoveryCommandV1, RecoveryPlanV1, RecoveryStepV1 } from '@latchops/schema';
import type { DemoScenario } from './scenario';
import type { BrokenEvidence, ExecEvidence } from './types';
import type { ProofWorkspace } from './workspace';

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
 * Structural allowlist for plan execution in the fixed demo.
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

export async function materializeBrokenRepo(
  ws: ProofWorkspace,
  scenario: DemoScenario,
): Promise<ExecEvidence[]> {
  const evidence: ExecEvidence[] = [];
  const run = async (args: string[], allowFail = false) => {
    const row = await ws.execGit(args, { allowFail, source: 'setup' });
    evidence.push(row);
    return row;
  };

  await run(['init', '-b', 'main']);
  await run(['config', 'user.name', 'LatchOps Demo']);
  await run(['config', 'user.email', 'demo@latchops.dev']);
  await run(['config', 'commit.gpgsign', 'false']);
  await run(['config', 'core.autocrlf', 'false']);
  await run(['config', 'merge.conflictStyle', 'merge']);

  await ws.writeFile('README.md', scenario.readme);
  await ws.writeFile(scenario.conflictPath, scenario.baseEnv);
  await run(['add', '--', 'README.md', scenario.conflictPath]);
  await run(['commit', '-m', scenario.initMessage]);

  await run(['switch', '-c', scenario.releaseBranch]);
  await ws.writeFile(scenario.conflictPath, scenario.releaseEnv);
  await run(['commit', '-am', scenario.releaseMessage]);

  await run(['switch', 'main']);
  await ws.writeFile(scenario.conflictPath, scenario.mainEnv);
  await run(['commit', '-am', scenario.mainMessage]);

  const merge = await run(['merge', scenario.releaseBranch, '--no-edit'], true);
  if (merge.exitCode === 0) {
    throw new Error('Demo setup expected a merge conflict, but git merge succeeded.');
  }

  return evidence;
}

export async function executeRecovery(
  ws: ProofWorkspace,
  plan: RecoveryPlanV1,
  scenario: DemoScenario,
): Promise<{ execution: ExecEvidence[]; failed: boolean; error?: string }> {
  const execution: ExecEvidence[] = [];
  const alternative = plan.alternatives.find((alt) => alt.id === scenario.selectedAlternativeId);
  if (!alternative) {
    return { execution, failed: true, error: `Plan is missing ${scenario.selectedAlternativeId}.` };
  }

  const steps: RecoveryStepV1[] = [...plan.steps, ...alternative.steps];

  try {
    for (const step of steps) {
      if (step.id === 'resolve-conflicts') {
        await ws.writeFile(scenario.conflictPath, scenario.resolvedEnv);
        execution.push({
          display: `write ${scenario.conflictPath}  # controlled demo orchestration — not an AI-generated fix`,
          executable: 'write',
          args: [scenario.conflictPath],
          exitCode: 0,
          stdout: scenario.resolvedEnv,
          stderr: '',
          durationMs: 0,
          source: 'demo_orchestration',
        });
        continue;
      }

      for (const command of step.commands) {
        if (!isExecutablePlanCommand(command)) {
          continue;
        }
        const inspect = isInspectCommand(command);
        const row = await ws.execGit(command.args, {
          allowFail: inspect,
          source: inspect ? 'inspect' : 'plan',
        });
        execution.push(row);
        if (!inspect && row.exitCode !== 0) {
          return {
            execution,
            failed: true,
            error: `${command.display} exited ${row.exitCode}`,
          };
        }
      }
    }
    return { execution, failed: false };
  } catch (error) {
    return {
      execution,
      failed: true,
      error: error instanceof Error ? error.message : 'Recovery execution failed',
    };
  }
}

export function brokenFromSignals(
  signals: import('@latchops/schema').RepoSignalsV1,
  snapshot: import('@latchops/schema').SnapshotV1,
  scenario: DemoScenario,
): BrokenEvidence {
  const file = snapshot.unmergedFiles.find((item) => item.path === scenario.conflictPath);
  const block = file?.conflictBlocks[0];
  return {
    incidentType: signals.state,
    branch: signals.branch.name,
    oid: signals.branch.oid,
    mergeActive: signals.operations.merge,
    conflictedPaths: signals.worktree.conflictedPaths,
    reasons: signals.reasons,
    rawStatus: snapshot.rawStatus,
    conflict: block
      ? {
          path: scenario.conflictPath,
          ours: block.oursContent,
          theirs: block.theirsContent,
        }
      : {
          path: scenario.conflictPath,
          ours: scenario.mainEnv,
          theirs: scenario.releaseEnv,
        },
  };
}
