import os from 'node:os';
import path from 'node:path';

/** User-level LatchOps state directory (outside any git repository). */
export function getLatchOpsStateDir(): string {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
    return path.join(base, 'LatchOps');
  }
  return path.join(os.homedir(), '.latchops');
}

export function pendingSendsFilePath(stateDir = getLatchOpsStateDir()): string {
  return path.join(stateDir, 'pending-sends.json');
}

export function pendingSendsLockPath(stateDir = getLatchOpsStateDir()): string {
  return path.join(stateDir, 'pending-sends.lock');
}

export function pendingPayloadsDir(stateDir = getLatchOpsStateDir()): string {
  return path.join(stateDir, 'payloads');
}

export function pendingPayloadPath(stateDir: string, payloadFile: string): string {
  return path.join(stateDir, payloadFile);
}
