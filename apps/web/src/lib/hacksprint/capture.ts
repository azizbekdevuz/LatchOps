import { SnapshotV1Schema, type SnapshotV1 } from '@latchops/schema';
import {
  extractConflictBlocks,
  LOG_FORMAT,
  parseDiffStat,
  parseLog,
  parseReflog,
  parseStatus,
  REFLOG_FORMAT,
  toBranchInfo,
} from '@latchops/state-engine';
import type { ProofWorkspace } from './workspace';

const HISTORY = 20;

function normalizeStatus(raw: string): string {
  if (raw.includes('\0')) return raw;
  return raw.replace(/\r?\n/g, '\0');
}

async function revParse(ws: ProofWorkspace, ref: string): Promise<string | null> {
  const result = await ws.execGit(['rev-parse', '-q', '--verify', ref], { allowFail: true });
  if (result.exitCode !== 0) return null;
  const value = result.stdout.trim();
  return value || null;
}

export async function captureSnapshotFromWorkspace(ws: ProofWorkspace): Promise<SnapshotV1> {
  const statusRaw = (
    await ws.execGit(['status', '--porcelain=v2', '--branch', '-z'], { allowFail: true })
  ).stdout;
  const status = parseStatus(normalizeStatus(statusRaw));

  const [branches, log, reflog, graph, numstat] = await Promise.all([
    ws.execGit(['branch', '-vv'], { allowFail: true }),
    ws.execGit(['log', '-n', String(HISTORY), '--decorate=short', `--format=${LOG_FORMAT}`], {
      allowFail: true,
    }),
    ws.execGit(['reflog', '-n', String(HISTORY), `--format=${REFLOG_FORMAT}`], { allowFail: true }),
    ws.execGit(['log', '--graph', '--oneline', '--decorate', '--all', '-n', String(HISTORY)], {
      allowFail: true,
    }),
    ws.execGit(['diff', '--numstat', '-z'], { allowFail: true }),
  ]);

  const [mergeHead, cherryPick, revertHead, rebaseHead] = await Promise.all([
    revParse(ws, 'MERGE_HEAD'),
    revParse(ws, 'CHERRY_PICK_HEAD'),
    revParse(ws, 'REVERT_HEAD'),
    revParse(ws, 'REBASE_HEAD'),
  ]);

  let mergeMessage: string | undefined;
  if (mergeHead) {
    const msgPath = (await ws.execGit(['rev-parse', '--git-path', 'MERGE_MSG'], { allowFail: true }))
      .stdout
      .trim();
    if (msgPath && (await ws.exists(msgPath))) {
      mergeMessage = (await ws.readFile(msgPath)).replace(/\r\n?/g, '\n').trim();
    }
  }

  const unmergedFiles = [];
  for (const path of status.unmergedPaths.slice(0, 5)) {
    try {
      const content = (await ws.readFile(path)).replace(/\r\n?/g, '\n');
      unmergedFiles.push({
        path,
        conflictBlocks: extractConflictBlocks(content).slice(0, 3),
      });
    } catch {
      unmergedFiles.push({ path, conflictBlocks: [] });
    }
  }

  const platform = ws.kind === 'daytona' ? 'linux' : toPlatform();
  const gitDir = `${ws.repoRoot.replace(/\\/g, '/')}/.git`;

  const snapshot: SnapshotV1 = {
    version: 1,
    timestamp: new Date().toISOString(),
    platform,
    repoRoot: ws.repoRoot,
    gitDir,
    branch: toBranchInfo(status),
    isDetachedHead: status.isDetachedHead,
    rebaseState: rebaseHead
      ? { inProgress: true, type: 'merge' }
      : { inProgress: false, type: 'none' },
    unmergedFiles,
    stagedFiles: status.stagedFiles,
    modifiedFiles: status.modifiedFiles,
    untrackedFiles: status.untrackedFiles,
    recentLog: parseLog(log.stdout).slice(0, 30),
    recentReflog: parseReflog(reflog.stdout).slice(0, 30),
    commitGraph: graph.stdout || undefined,
    diffStats: parseDiffStat(numstat.stdout).length > 0 ? parseDiffStat(numstat.stdout) : undefined,
    mergeHead: mergeHead ?? undefined,
    mergeMessage,
    cherryPickInProgress: Boolean(cherryPick),
    revertInProgress: Boolean(revertHead),
    bisectInProgress: false,
    rawStatus: statusRaw.replace(/\0/g, '\n'),
    rawBranches: branches.stdout,
  };

  return SnapshotV1Schema.parse(snapshot);
}

function toPlatform(): SnapshotV1['platform'] {
  const platform = process.platform;
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') return platform;
  return 'linux';
}
