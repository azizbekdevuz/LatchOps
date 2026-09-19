import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distModule = path.join(__dirname, '../../dist/send/pending-send.js');

const op = process.argv[2];
const payload = JSON.parse(process.argv[3] ?? '{}');

const mod = await import(pathToFileURL(distModule).href);

let result;
switch (op) {
  case 'create':
    result = await mod.createPendingSubmission(payload);
    break;
  case 'load':
    result = await mod.loadPendingRetry(payload);
    break;
  case 'clear':
    await mod.clearPendingSubmission(
      payload.apiOrigin,
      payload.repositoryFingerprint,
      payload.stateDir,
      payload.repoRoot,
    );
    result = { cleared: true };
    break;
  case 'store':
    result = await mod.readPendingStoreForTest(payload.stateDir);
    break;
  default:
    throw new Error(`Unknown op: ${op}`);
}

process.stdout.write(`${JSON.stringify(result)}\n`);
