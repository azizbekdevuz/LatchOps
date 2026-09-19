import { captureRepoState } from '@latchops/state-engine';
import { exitCodeForIncident } from '../exit-codes.js';
import { reportCaptureError } from '../errors.js';
import { renderDiagnose } from '../render.js';

interface DiagnoseOptions {
  json?: boolean;
}

/**
 * Capture the current repository state and print the deterministic
 * classification. Exit code reflects the diagnosis (see exit-codes.ts).
 */
export async function diagnoseCommand(options: DiagnoseOptions): Promise<void> {
  try {
    const { signals } = await captureRepoState();

    if (options.json) {
      console.log(JSON.stringify(signals, null, 2));
    } else {
      console.log(renderDiagnose(signals));
    }

    process.exit(exitCodeForIncident(signals.state));
  } catch (error) {
    reportCaptureError(error);
  }
}
