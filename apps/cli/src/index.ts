#!/usr/bin/env node
import { program } from 'commander';
import { snapshotCommand } from './commands/snapshot.js';
import { sendCommand } from './commands/send.js';

program
  .name('latchops')
  .description('LatchOps CLI - inspect repository state and generate deterministic recovery diagnostics')
  .version('1.0.0');

program
  .command('snapshot')
  .description('Generate a read-only diagnostic snapshot of the current git repository state')
  .option('-o, --output <file>', 'Write snapshot to file instead of stdout')
  .option('--pretty', 'Pretty-print JSON output')
  .action(snapshotCommand);

program
  .command('send')
  .description('Capture repository state and send it to LatchOps for incident analysis')
  .option('-u, --api-url <url>', 'LatchOps API URL (default: http://localhost:3000)')
  .option('-o, --open', 'Open the incident room in browser after upload')
  .action(sendCommand);

program.parse();
