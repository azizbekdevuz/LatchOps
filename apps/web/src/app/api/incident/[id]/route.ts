import { NextRequest, NextResponse } from 'next/server';
import { getSessionWithDetails } from '@/lib/db';

/**
 * GET /api/incident/[id]
 *
 * Fetch session data with all related details for the incident room.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await getSessionWithDetails(id);

    if (!session) {
      return NextResponse.json(
        { error: 'Session not found' },
        { status: 404 }
      );
    }

    // Get the latest snapshot and analysis
    const snapshot = session.snapshots[0];
    const analysis = session.analyses[0];

    // Transform to the expected format
    const response = {
      id: session.id,
      title: session.title,
      status: session.status,
      createdAt: session.createdAt.toISOString(),
      snapshot: snapshot ? {
        branch: (snapshot.snapshotJson as { branch?: { head?: string; oid?: string } })?.branch || { head: 'unknown', oid: '' },
        platform: (snapshot.snapshotJson as { platform?: string })?.platform || 'unknown',
        isDetachedHead: (snapshot.snapshotJson as { isDetachedHead?: boolean })?.isDetachedHead || false,
        rebaseState: (snapshot.snapshotJson as { rebaseState?: { inProgress: boolean } })?.rebaseState || { inProgress: false },
      } : {
        branch: { head: 'unknown', oid: '' },
        platform: 'unknown',
        isDetachedHead: false,
        rebaseState: { inProgress: false },
      },
      analysis: analysis ? {
        issueType: analysis.issueType,
        summary: analysis.summary,
        repoGraphJson: analysis.repoGraphJson,
        conflictFiles: analysis.conflictFiles.map(file => ({
          id: file.id,
          path: file.path,
          highLevelSummary: file.highLevelSummary,
          hunks: file.hunks.map(hunk => ({
            id: hunk.id,
            index: hunk.index,
            baseText: hunk.baseText,
            oursText: hunk.oursText,
            theirsText: hunk.theirsText,
            explanation: hunk.explanation,
            suggestedChoice: hunk.suggestedChoice,
            userChoice: hunk.userChoice,
          })),
        })),
        planSteps: analysis.planSteps.map(step => ({
          id: step.id,
          index: step.index,
          title: step.title,
          rationale: step.rationale,
          commandsJson: step.commandsJson,
          verifyJson: step.verifyJson,
          undoJson: step.undoJson,
          dangerLevel: step.dangerLevel,
          status: step.status,
        })),
      } : null,
      traces: session.traces.map(trace => ({
        id: trace.id,
        stage: trace.stage,
        inputJson: trace.inputJson,
        outputJson: trace.outputJson,
        durationMs: trace.durationMs,
        success: trace.success,
        createdAt: trace.createdAt.toISOString(),
      })),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error('Error fetching session:', error);
    return NextResponse.json(
      { error: 'Failed to fetch session' },
      { status: 500 }
    );
  }
}
