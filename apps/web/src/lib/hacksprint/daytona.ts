import { createDaytonaWorkspace, type DaytonaSandboxLike, type ProofWorkspace } from './workspace';

const DEFAULT_REPO = '/home/daytona/latchops-proof';

export function daytonaKeyPresent(): boolean {
  return Boolean(process.env.DAYTONA_API_KEY?.trim());
}

export function isolationPreference(): 'auto' | 'local' {
  return process.env.HACKSPRINT_ISOLATION === 'local' ? 'local' : 'auto';
}

export interface DaytonaSession {
  workspace: ProofWorkspace;
  sandboxId: string;
}

/**
 * Create a disposable Daytona sandbox. A real API create() must succeed
 * before callers may report Daytona as live.
 */
export async function createDaytonaSession(): Promise<DaytonaSession> {
  const apiKey = process.env.DAYTONA_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('DAYTONA_API_KEY is not set');
  }

  const { Daytona } = await import('@daytona/sdk');
  const daytona = new Daytona({
    apiKey,
    apiUrl: process.env.DAYTONA_API_URL?.trim() || undefined,
    target: process.env.DAYTONA_TARGET?.trim() || undefined,
  });

  const sandbox = (await daytona.create(
    {
      language: 'typescript',
      ephemeral: true,
      autoStopInterval: 5,
      autoDeleteInterval: 0,
      ttlMinutes: 10,
      labels: { purpose: 'latchops-hacksprint-proof' },
    },
    { timeout: 90 },
  )) as DaytonaSandboxLike;

  if (!sandbox?.id) {
    throw new Error('Daytona create() returned no sandbox id');
  }

  const repoRoot = DEFAULT_REPO;

  const deleteSandbox = async () => {
    try {
      if (typeof sandbox.delete === 'function') {
        await sandbox.delete(30, true);
      } else {
        await daytona.delete(sandbox as never, 30, true);
      }
    } finally {
      const dispose = (daytona as { [Symbol.asyncDispose]?: () => Promise<void> })[Symbol.asyncDispose];
      if (dispose) {
        await dispose.call(daytona);
      }
    }
  };

  try {
    await sandbox.process.executeCommand(`mkdir -p ${repoRoot}`, undefined, undefined, 15);
  } catch (error) {
    await deleteSandbox().catch(() => undefined);
    throw error;
  }

  return {
    sandboxId: sandbox.id,
    workspace: createDaytonaWorkspace(sandbox, repoRoot, deleteSandbox),
  };
}
