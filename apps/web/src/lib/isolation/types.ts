export type RecoveryVerdict = 'VERIFIED' | 'FAILED';

export interface ExecEvidence {
  display: string;
  executable: string;
  args: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  source: 'plan' | 'demo_orchestration' | 'setup' | 'inspect';
}

export interface ExecOptions {
  allowFail?: boolean;
  source?: ExecEvidence['source'];
  timeoutMs?: number;
}

/** Local throwaway repository. Remote sandboxes are not part of this product. */
export interface GitWorkspace {
  kind: 'local';
  repoRoot: string;
  execGit(args: readonly string[], opts?: ExecOptions): Promise<ExecEvidence>;
  writeFile(relPath: string, content: string): Promise<void>;
  readFile(relPath: string): Promise<string>;
  exists(relPath: string): Promise<boolean>;
  dispose(): Promise<{ cleanedUp: boolean; error?: string }>;
}
