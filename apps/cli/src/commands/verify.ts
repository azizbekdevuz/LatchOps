import { readFileSync } from 'node:fs';
import { PlanArtifactV1Schema, RepoSignalsV1Schema } from '@latchops/schema';
import { captureRepoState } from '@latchops/state-engine';
import { verifyRecovery } from '@latchops/recovery-engine';
import { ExitCode, exitCodeForVerification } from '../exit-codes.js';
import { reportCaptureError } from '../errors.js';
import { renderVerify } from '../render.js';

interface VerifyOptions {
  plan?: string;
  json?: boolean;
}

/**
 * Verify recovery progress by comparing the before-state captured in a plan
 * artifact against the current repository state. Requires `--plan <file>`.
 */
export async function verifyCommand(options: VerifyOptions): Promise<void> {
  if (!options.plan) {
    console.error('error: --plan <file> is required for verification.');
    console.error('Generate one with: latchops plan --output latchops-plan.json');
    process.exit(ExitCode.INVALID_INPUT);
  }

  let raw: string;
  try {
    raw = readFileSync(options.plan, 'utf-8');
  } catch {
    console.error(`error: cannot read plan file '${options.plan}'.`);
    process.exit(ExitCode.INVALID_INPUT);
  }

  const parsed = PlanArtifactV1Schema.safeParse(safeJsonParse(raw));
  if (!parsed.success) {
    console.error(`error: invalid plan artifact in '${options.plan}': ${parsed.error.message}`);
    process.exit(ExitCode.INVALID_INPUT);
  }
  const artifact = parsed.data;

  const beforeParsed = RepoSignalsV1Schema.safeParse(artifact.beforeSignals);
  if (!beforeParsed.success) {
    console.error(
      `error: plan artifact is missing valid before-state signals: ${beforeParsed.error.message}`,
    );
    process.exit(ExitCode.INVALID_INPUT);
  }

  try {
    const { signals: after } = await captureRepoState();
    const result = verifyRecovery({
      incidentType: artifact.incidentType,
      before: beforeParsed.data,
      after,
      plan: artifact.plan,
      selectedAlternativeId: artifact.selectedAlternativeId,
    });

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderVerify(result));
    }

    process.exit(exitCodeForVerification(result.status));
  } catch (error) {
    reportCaptureError(error);
  }
}

function safeJsonParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
