import { SnapshotV1Schema, type SnapshotV1 } from '@latchops/schema';
import { collectGitInfo } from '../collectors/git-info.js';
import { parseStatus } from '../parsers/status-parser.js';
import { parseBranches } from '../parsers/branch-parser.js';
import { parseLog } from '../parsers/log-parser.js';
import { parseReflog } from '../parsers/reflog-parser.js';
import { parseDiffStat } from '../parsers/diffstat-parser.js';
import { detectRebaseState } from '../collectors/rebase-detector.js';
import { extractConflicts } from '../collectors/conflict-extractor.js';

const DEFAULT_API_URL = 'http://localhost:3000';

interface SendOptions {
  apiUrl?: string;
  open?: boolean;
}

interface IngestResponse {
  sessionId: string;
  url: string;
  analysis: {
    issueType: string;
    summary: string;
  };
}

export async function sendCommand(options: SendOptions): Promise<void> {
  const apiUrl = options.apiUrl || process.env.LATCHOPS_API_URL || DEFAULT_API_URL;
  const requestId = `cli-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  console.error(`[CLI:SEND:${requestId}] ========================================`);
  console.error(`[CLI:SEND:${requestId}] Starting LatchOps repository diagnostic capture`);
  console.error(`[CLI:SEND:${requestId}] API URL: ${apiUrl}`);
  console.error(`[CLI:SEND:${requestId}] Timestamp: ${new Date().toISOString()}`);

  try {
    console.error(`[CLI:SEND:${requestId}] 📥 Collecting Git repository information...`);
    // Collect git information
    const gitInfo = await collectGitInfo();
    console.error(`[CLI:SEND:${requestId}] ✅ Git info collected`);
    console.error(`[CLI:SEND:${requestId}]    Repo root: ${gitInfo.repoRoot}`);
    console.error(`[CLI:SEND:${requestId}]    Git dir: ${gitInfo.gitDir}`);

    console.error(`[CLI:SEND:${requestId}] 🔍 Parsing Git status...`);
    // Parse status
    const statusInfo = parseStatus(gitInfo.status);
    console.error(`[CLI:SEND:${requestId}] ✅ Status parsed`);
    console.error(`[CLI:SEND:${requestId}]    Branch: ${statusInfo.branch}`);
    console.error(`[CLI:SEND:${requestId}]    Unmerged files: ${statusInfo.unmergedPaths.length}`);
    console.error(`[CLI:SEND:${requestId}]    Staged: ${statusInfo.stagedFiles.length}, Modified: ${statusInfo.modifiedFiles.length}`);

    console.error(`[CLI:SEND:${requestId}] 🔍 Parsing branches...`);
    // Parse branches
    const branchInfo = parseBranches(gitInfo.branches, statusInfo.branch);
    console.error(`[CLI:SEND:${requestId}] ✅ Branches parsed: ${branchInfo.head}`);

    console.error(`[CLI:SEND:${requestId}] 🔍 Parsing commit logs...`);
    // Parse logs
    const logEntries = parseLog(gitInfo.log);
    const reflogEntries = parseReflog(gitInfo.reflog);
    console.error(`[CLI:SEND:${requestId}] ✅ Logs parsed: ${logEntries.length} commits, ${reflogEntries.length} reflog entries`);

    console.error(`[CLI:SEND:${requestId}] 🔍 Parsing diff stats...`);
    // Parse diff stats
    const diffStats = parseDiffStat(gitInfo.diffStat);
    console.error(`[CLI:SEND:${requestId}] ✅ Diff stats parsed: ${diffStats.length} files`);

    console.error(`[CLI:SEND:${requestId}] 🔍 Detecting rebase state...`);
    // Detect rebase state
    const rebaseState = await detectRebaseState(gitInfo.gitDir);
    console.error(`[CLI:SEND:${requestId}] ✅ Rebase state: ${rebaseState.inProgress ? 'IN PROGRESS' : 'none'}`);

    console.error(`[CLI:SEND:${requestId}] 🔍 Extracting conflict details...`);
    // Extract conflict details
    const unmergedFiles = await extractConflicts(
      gitInfo.repoRoot,
      statusInfo.unmergedPaths.slice(0, 10) // Extract up to 10 conflict files
    );
    console.error(`[CLI:SEND:${requestId}] ✅ Conflicts extracted: ${unmergedFiles.length} files with conflicts`);

    // Build snapshot
    const snapshot: SnapshotV1 = {
      version: 1,
      timestamp: new Date().toISOString(),
      platform: process.platform as 'win32' | 'darwin' | 'linux',
      repoRoot: gitInfo.repoRoot,
      gitDir: gitInfo.gitDir,

      branch: branchInfo,
      isDetachedHead: statusInfo.isDetachedHead,

      rebaseState,

      unmergedFiles,
      stagedFiles: statusInfo.stagedFiles,
      modifiedFiles: statusInfo.modifiedFiles,
      untrackedFiles: statusInfo.untrackedFiles,

      recentLog: logEntries,
      recentReflog: reflogEntries,

      commitGraph: gitInfo.commitGraph || undefined,
      diffStats: diffStats.length > 0 ? diffStats : undefined,
      mergeHead: gitInfo.mergeHead || undefined,
      mergeMessage: gitInfo.mergeMessage || undefined,

      rawStatus: gitInfo.status,
      rawBranches: gitInfo.branches,
    };

    console.error(`[CLI:SEND:${requestId}] ✅ Validating snapshot with schema...`);
    // Validate with Zod
    const validated = SnapshotV1Schema.parse(snapshot);
    console.error(`[CLI:SEND:${requestId}] ✅ Snapshot validated`);
    console.error(`[CLI:SEND:${requestId}]    Snapshot size: ${JSON.stringify(validated).length} bytes`);

    console.error(`[CLI:SEND:${requestId}] Uploading snapshot to LatchOps API...`);
    console.error(`[CLI:SEND:${requestId}]    Endpoint: ${apiUrl}/api/snapshots/ingest`);

    const uploadStart = Date.now();
    // Send to API
    const response = await fetch(`${apiUrl}/api/snapshots/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ snapshot: validated }),
    });

    const uploadDuration = Date.now() - uploadStart;
    console.error(`[CLI:SEND:${requestId}]    Upload duration: ${uploadDuration}ms`);
    console.error(`[CLI:SEND:${requestId}]    Response status: ${response.status}`);

    if (!response.ok) {
      let errorMessage = `Server returned ${response.status}`;
      try {
        const errorData = await response.json() as { error?: string };
        if (errorData.error) {
          errorMessage = errorData.error;
        }
      } catch {
        // Ignore JSON parse errors
      }
      console.error(`[CLI:SEND:${requestId}] ❌ Upload failed: ${errorMessage}`);
      throw new Error(errorMessage);
    }

    const result = await response.json() as IngestResponse;
    console.error(`[CLI:SEND:${requestId}] ✅ Upload successful`);
    console.error(`[CLI:SEND:${requestId}]    Session ID: ${result.sessionId}`);
    console.error(`[CLI:SEND:${requestId}]    Issue type: ${result.analysis.issueType}`);

    // Display results
    console.log('');
    console.log('='.repeat(60));
    console.log('');
    console.log(`  Issue Type: ${result.analysis.issueType.replace('_', ' ').toUpperCase()}`);
    console.log(`  Summary: ${result.analysis.summary}`);
    console.log('');
    console.log(`  Incident Room: ${result.url}`);
    console.log('');
    console.log('='.repeat(60));
    console.log('');

    // Try to open in browser if requested
    if (options.open) {
      try {
        const open = await getOpenCommand();
        if (open) {
          const { exec } = await import('node:child_process');
          exec(`${open} "${result.url}"`);
          console.error(`[CLI:SEND:${requestId}] 🌐 Opening incident room in browser...`);
        }
      } catch {
        // Silently fail if we can't open the browser
      }
    }

    console.error(`[CLI:SEND:${requestId}] ✅ Command completed successfully`);
    console.error(`[CLI:SEND:${requestId}] ========================================`);
  } catch (error) {
    console.error(`[CLI:SEND:${requestId}] ❌ Command failed`);
    if (error instanceof Error) {
      console.error(`[CLI:SEND:${requestId}]    Error: ${error.message}`);
      if (error.message.includes('not a git repository')) {
        console.error('Please run this command from within a git repository.');
      } else if (error.message.includes('fetch')) {
        console.error(`Could not connect to ${apiUrl}. Is the server running?`);
      }
    }
    console.error(`[CLI:SEND:${requestId}] ========================================`);
    process.exit(1);
  }
}

async function getOpenCommand(): Promise<string | null> {
  switch (process.platform) {
    case 'darwin':
      return 'open';
    case 'win32':
      return 'start';
    case 'linux':
      return 'xdg-open';
    default:
      return null;
  }
}
