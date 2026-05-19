import { NextRequest, NextResponse } from 'next/server';
import { SnapshotV1Schema } from '@latchops/schema';
import { getSessionWithDetails } from '@/lib/db';
import { collectSignals } from '@/lib/agent/collector';

/**
 * GET /api/sessions/[id]
 * Get session data with snapshot, analysis, and traces.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;

    const sessionData = await getSessionWithDetails(sessionId);
    if (!sessionData) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const latestSnapshot = sessionData.snapshots[0];
    if (!latestSnapshot) {
      return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
    }

    const snapshot = SnapshotV1Schema.parse(latestSnapshot.snapshotJson);
    const latestAnalysis = sessionData.analyses[0];

    // Compute signals from snapshot
    const signals = collectSignals(snapshot);

    const traces = sessionData.traces.map((t) => ({
      stage: t.stage,
      input: t.inputJson,
      output: t.outputJson,
      createdAt: t.createdAt.toISOString(),
      durationMs: t.durationMs,
      success: t.success,
    })).filter(t => 
      // Only include recovery pipeline stages for the pipeline tab
      ['detect_issue', 'build_graph', 'extract_conflicts', 'collect_signals', 'generate_analysis'].includes(t.stage) ||
      // Or include all traces if none match (for backward compatibility)
      !sessionData.traces.some(tr => ['detect_issue', 'build_graph', 'extract_conflicts', 'collect_signals', 'generate_analysis'].includes(tr.stage))
    );

    // Transform plan steps from database to PlanV1 format
    let plan = null;
    if (latestAnalysis && latestAnalysis.planSteps.length > 0) {
      plan = {
        version: 1,
        timestamp: latestAnalysis.createdAt.toISOString(),
        issueType: latestAnalysis.issueType,
        issueSummary: latestAnalysis.summary || 'Recovery plan generated',
        risk: signals.estimatedRisk || 'medium',
        steps: latestAnalysis.planSteps.map((s) => {
          // Parse undo from JSON
          const undoData = s.undoJson as { commands?: string[]; description?: string; possible?: boolean } | string[] || {};
          const undoCommands = Array.isArray(undoData) ? undoData : (undoData.commands || []);
          const undoDescription = Array.isArray(undoData) ? 'Undo this step' : (undoData.description || 'Undo this step');

          return {
            id: s.id,
            title: s.title,
            description: s.rationale || s.title,
            commands: Array.isArray(s.commandsJson) ? s.commandsJson : [],
            expected: typeof s.verifyJson === 'object' && s.verifyJson !== null && 'expected' in s.verifyJson
              ? String((s.verifyJson as { expected?: unknown }).expected)
              : 'Command executed successfully',
            undo: {
              possible: true,
              commands: undoCommands,
              description: undoDescription,
            },
            dangerous: s.dangerLevel === 'dangerous',
            requiresUserInput: false,
          };
        }),
        reflogRecovery: {
          description: 'If something goes wrong, use reflog to recover',
          relevantEntries: ['HEAD@{1}'],
          recoveryCommand: 'git reset --hard HEAD@{1}',
        },
      };
    }

    return NextResponse.json({
      session: {
        id: sessionData.id,
        title: sessionData.title,
        status: sessionData.status,
        createdAt: sessionData.createdAt.toISOString(),
      },
      snapshot,
      signals,
      plan,
      analysis: latestAnalysis
        ? {
            issueType: latestAnalysis.issueType,
            summary: latestAnalysis.summary,
            repoGraph: latestAnalysis.repoGraphJson,
            conflictFiles: latestAnalysis.conflictFiles.map((f) => ({
              id: f.id,
              path: f.path,
              summary: f.highLevelSummary,
              hunks: f.hunks.map((h) => ({
                id: h.id,
                index: h.index,
                baseText: h.baseText,
                oursText: h.oursText,
                theirsText: h.theirsText,
                explanation: h.explanation,
                suggestedChoice: h.suggestedChoice,
                userChoice: h.userChoice,
              })),
            })),
            planSteps: latestAnalysis.planSteps.map((s) => ({
              id: s.id,
              index: s.index,
              title: s.title,
              rationale: s.rationale,
              commands: s.commandsJson,
              verify: s.verifyJson,
              undo: s.undoJson,
              dangerLevel: s.dangerLevel,
              status: s.status,
            })),
          }
        : null,
      traces,
    });
  } catch (error) {
    console.error('Error fetching session:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
