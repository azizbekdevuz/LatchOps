import { NextRequest, NextResponse } from 'next/server';
import { SnapshotV1Schema } from '@latchops/schema';
import { createSnapshot, getLatestAnalysis, getTraces, saveTrace } from '@/lib/db';

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:8000';

/**
 * POST /api/sessions/[id]/verify
 * Upload a new snapshot to verify progress.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;
    const body = await request.json();
    const { snapshot: rawSnapshot } = body;

    // Validate new snapshot
    const newSnapshot = SnapshotV1Schema.parse(rawSnapshot);

    // Save new snapshot
    const snapshotRecord = await createSnapshot({
      gitSessionId: sessionId,
      snapshotJson: newSnapshot,
    });

    // Get original analysis
    const originalAnalysis = await getLatestAnalysis(sessionId);
    const originalIssueType = originalAnalysis?.issueType || 'unknown';

    // Determine new issue type based on snapshot
    let newIssueType = 'unknown';
    if (newSnapshot.unmergedFiles.length > 0) {
      newIssueType = 'merge_conflict';
    } else if (newSnapshot.rebaseState.inProgress) {
      newIssueType = 'rebase_in_progress';
    } else if (newSnapshot.isDetachedHead) {
      newIssueType = 'detached_head';
    } else {
      newIssueType = 'clean';
    }

    const resolved = newIssueType === 'clean';
    const remainingIssues: string[] = [];

    if (newSnapshot.unmergedFiles.length > 0) {
      remainingIssues.push(...newSnapshot.unmergedFiles.map((f) => `Conflict: ${f.path}`));
    }
    if (newSnapshot.rebaseState.inProgress) {
      remainingIssues.push('Rebase in progress');
    }
    if (newSnapshot.isDetachedHead) {
      remainingIssues.push('Detached HEAD');
    }

    const result = {
      previousIssue: originalIssueType,
      currentIssue: newIssueType,
      resolved,
      remainingIssues,
      snapshotId: snapshotRecord.id,
    };

    // Save verify trace
    await saveTrace(
      sessionId,
      'verify',
      snapshotRecord.id,
      { previousSnapshot: 'omitted', newSnapshot: 'omitted' },
      result,
      Date.now(),
      true
    );

    return NextResponse.json(result);
  } catch (error) {
    console.error('Error verifying progress:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
