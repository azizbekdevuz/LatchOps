import { NextRequest, NextResponse } from 'next/server';
import { SnapshotV1Schema } from '@latchops/schema';
import { createSession, createSnapshot, updateSessionStatus, saveTrace, createAnalysis, createConflictFile, createConflictHunk, createPlanStep } from '@/lib/db';
import { auth } from '@/lib/auth';
import { createHash } from 'crypto';
import { generateTitle, generateFallbackAnalysis, type AgentAnalysis } from './utils';

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:8000';

/**
 * POST /api/snapshots/ingest
 *
 * Ingest a snapshot from CLI, analyze with analysis service, and return session URL.
 * This is the main entry point for the CLI `latchops send` command.
 */
export async function POST(request: NextRequest) {
  const startTime = Date.now();
  const requestId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  console.log(`[WEB:INGEST:${requestId}] ========================================`);
  console.log(`[WEB:INGEST:${requestId}] 📥 New snapshot ingestion request received`);
  console.log(`[WEB:INGEST:${requestId}] Timestamp: ${new Date().toISOString()}`);
  console.log(`[WEB:INGEST:${requestId}] Agent URL: ${AGENT_URL}`);

  try {
    const body = await request.json();
    const { snapshot: rawSnapshot } = body;

    console.log(`[WEB:INGEST:${requestId}] ✅ Request body parsed successfully`);
    console.log(`[WEB:INGEST:${requestId}] Snapshot size: ${JSON.stringify(rawSnapshot).length} bytes`);

    // Validate snapshot
    const snapshot = SnapshotV1Schema.parse(rawSnapshot);
    console.log(`[WEB:INGEST:${requestId}] ✅ Snapshot validated against schema`);
    console.log(`[WEB:INGEST:${requestId}] Repository: ${snapshot.repoRoot}`);
    console.log(`[WEB:INGEST:${requestId}] Branch: ${snapshot.branch.head}`);
    console.log(`[WEB:INGEST:${requestId}] Conflicts: ${snapshot.unmergedFiles.length} files`);
    console.log(`[WEB:INGEST:${requestId}] Detached HEAD: ${snapshot.isDetachedHead}`);
    console.log(`[WEB:INGEST:${requestId}] Rebase in progress: ${snapshot.rebaseState.inProgress}`);

    // Get current user (optional - uploads can be anonymous)
    const session = await auth();
    const userId = session?.user?.id || null;
    console.log(`[WEB:INGEST:${requestId}] User: ${userId || 'anonymous'}`);

    // Create hash of repo root for deduplication
    const repoRootHash = createHash('sha256')
      .update(snapshot.repoRoot)
      .digest('hex')
      .slice(0, 16);

    // Generate title from branch and issue
    const title = generateTitle(snapshot);
    console.log(`[WEB:INGEST:${requestId}] Generated title: ${title}`);

    // Create session in database
    const gitSession = await createSession({
      title,
      os: snapshot.platform,
      repoRootHash,
      userId,
      status: 'analyzing',
    });
    console.log(`[WEB:INGEST:${requestId}] ✅ Session created: ${gitSession.id}`);

    // Save snapshot
    const snapshotRecord = await createSnapshot({
      gitSessionId: gitSession.id,
      snapshotJson: snapshot,
    });
    console.log(`[WEB:INGEST:${requestId}] ✅ Snapshot saved: ${snapshotRecord.id}`);

    // Save ingest trace
    await saveTrace(
      gitSession.id,
      'ingest',
      snapshotRecord.id,
      { source: 'api' },
      { snapshotId: snapshotRecord.id },
      startTime
    );
    console.log(`[WEB:INGEST:${requestId}] ✅ Ingest trace saved`);

    // Call analysis service for analysis
    const analyzeStartTime = Date.now();
    let agentResponse: { 
      success: boolean; 
      analysis?: AgentAnalysis; 
      error?: string;
      durationMs?: number;
      pipelineTraces?: Array<{
        stage: string;
        duration_ms?: number;
        durationMs?: number;
        input?: unknown;
        inputJson?: unknown;
        output?: unknown;
        outputJson?: unknown;
        success?: boolean;
      }>;
    };

    try {
      console.log(`[WEB:INGEST:${requestId}] 🔄 Attempting to call Python agent...`);
      console.log(`[WEB:INGEST:${requestId}]    URL: ${AGENT_URL}/analyze`);
      console.log(`[WEB:INGEST:${requestId}]    Method: POST`);
      
      const agentRequestStart = Date.now();
      const agentResult = await fetch(`${AGENT_URL}/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          snapshot,
          options: {
            includeGraph: true,
            maxConflictFiles: 10,
            maxHunksPerFile: 5,
          },
        }),
      });

      const agentRequestDuration = Date.now() - agentRequestStart;
      console.log(`[WEB:INGEST:${requestId}]    Request duration: ${agentRequestDuration}ms`);
      console.log(`[WEB:INGEST:${requestId}]    Response status: ${agentResult.status}`);

      if (!agentResult.ok) {
        const errorText = await agentResult.text();
        console.error(`[WEB:INGEST:${requestId}] ❌ Agent returned error status ${agentResult.status}`);
        console.error(`[WEB:INGEST:${requestId}]    Error body: ${errorText.substring(0, 200)}`);
        throw new Error(`Agent returned ${agentResult.status}: ${errorText}`);
      }

      agentResponse = await agentResult.json();
      console.log(`[WEB:INGEST:${requestId}] ✅ Agent response received successfully`);
      console.log(`[WEB:INGEST:${requestId}]    Success: ${agentResponse.success}`);
      console.log(`[WEB:INGEST:${requestId}]    Pipeline traces: ${agentResponse.pipelineTraces?.length || 0}`);
      console.log(`[WEB:INGEST:${requestId}]    Duration (agent): ${agentResponse.durationMs || 'unknown'}ms`);
      console.log(`[WEB:INGEST:${requestId}] 🎯 USING REAL AI MODEL (Python Agent)`);
      
      // Save recovery pipeline traces if available from Python agent
      if (agentResponse.pipelineTraces && Array.isArray(agentResponse.pipelineTraces)) {
        console.log(`[WEB:INGEST:${requestId}] 💾 Saving ${agentResponse.pipelineTraces.length} pipeline traces...`);
        let cumulativeTime = analyzeStartTime;
        for (const trace of agentResponse.pipelineTraces) {
          const traceStart = cumulativeTime;
          cumulativeTime += (trace.duration_ms || trace.durationMs || 0);
          await saveTrace(
            gitSession.id,
            trace.stage || 'unknown',
            snapshotRecord.id,
            trace.input || trace.inputJson || {},
            trace.output || trace.outputJson || {},
            traceStart,
            trace.success !== false,
          );
          console.log(`[WEB:INGEST:${requestId}]    ✓ Saved trace: ${trace.stage} (${trace.duration_ms || trace.durationMs || 0}ms)`);
        }
        console.log(`[WEB:INGEST:${requestId}] ✅ All pipeline traces saved`);
      }
    } catch (agentError) {
      // Fallback to basic analysis if agent is unavailable
      console.error(`[WEB:INGEST:${requestId}] ❌ Python agent call failed`);
      console.error(`[WEB:INGEST:${requestId}]    Error type: ${agentError instanceof Error ? agentError.constructor.name : typeof agentError}`);
      console.error(`[WEB:INGEST:${requestId}]    Error message: ${agentError instanceof Error ? agentError.message : String(agentError)}`);
      console.error(`[WEB:INGEST:${requestId}] ⚠️  FALLBACK MODE: Using TypeScript fallback analysis (NO AI)`);
      agentResponse = generateFallbackAnalysis(snapshot);
      console.log(`[WEB:INGEST:${requestId}] ✅ Fallback analysis generated`);
      if (agentResponse.analysis) {
        console.log(`[WEB:INGEST:${requestId}]    Issue type: ${agentResponse.analysis.issueType}`);
        console.log(`[WEB:INGEST:${requestId}]    Plan steps: ${agentResponse.analysis.plan.length}`);
      }
    }

    // Save analyze trace (for compatibility)
    await saveTrace(
      gitSession.id,
      'analyze',
      snapshotRecord.id,
      { snapshotId: snapshotRecord.id },
      agentResponse,
      analyzeStartTime,
      agentResponse.success
    );

    if (!agentResponse.success || !agentResponse.analysis) {
      console.error(`[WEB:INGEST:${requestId}] ❌ Analysis failed or missing`);
      await updateSessionStatus(gitSession.id, 'error');
      return NextResponse.json(
        { error: agentResponse.error || 'Analysis failed' },
        { status: 500 }
      );
    }

    // TypeScript guard: we know analysis exists after the check above
    const analysis: AgentAnalysis = agentResponse.analysis!;
    console.log(`[WEB:INGEST:${requestId}] ✅ Analysis received successfully`);

    console.log(`[WEB:INGEST:${requestId}] 💾 Storing analysis in database...`);
    // Store analysis in database
    const analysisRecord = await createAnalysis({
      gitSessionId: gitSession.id,
      snapshotId: snapshotRecord.id,
      issueType: analysis.issueType,
      summary: analysis.summary,
      repoGraphJson: analysis.repoGraph,
    });
    console.log(`[WEB:INGEST:${requestId}] ✅ Analysis record created: ${analysisRecord.id}`);

    // Store conflict files and hunks
    if (analysis.conflicts) {
      console.log(`[WEB:INGEST:${requestId}] 💾 Storing ${analysis.conflicts.length} conflict files...`);
      for (const conflict of analysis.conflicts) {
        const conflictFile = await createConflictFile({
          analysisId: analysisRecord.id,
          path: conflict.path,
          highLevelSummary: conflict.highLevelSummary,
        });

        for (const hunk of conflict.hunks) {
          await createConflictHunk({
            conflictFileId: conflictFile.id,
            index: hunk.index,
            startLine: hunk.startLine,
            endLine: hunk.endLine,
            baseText: hunk.baseText,
            oursText: hunk.oursText,
            theirsText: hunk.theirsText,
            explanation: hunk.explanation,
            suggestedChoice: hunk.suggestedChoice,
            suggestedContent: hunk.suggestedContent,
          });
        }
      }
      console.log(`[WEB:INGEST:${requestId}] ✅ All conflict files stored`);
    }

    // Store plan steps
    console.log(`[WEB:INGEST:${requestId}] 💾 Storing ${analysis.plan.length} plan steps...`);
    for (const step of analysis.plan) {
      await createPlanStep({
        analysisId: analysisRecord.id,
        index: step.index,
        title: step.title,
        rationale: step.rationale,
        commandsJson: step.commands,
        verifyJson: step.verify,
        undoJson: step.undo,
        dangerLevel: step.dangerLevel,
      });
    }
    console.log(`[WEB:INGEST:${requestId}] ✅ All plan steps stored`);

    // Update session status to ready
    await updateSessionStatus(gitSession.id, 'ready');
    console.log(`[WEB:INGEST:${requestId}] ✅ Session status updated to 'ready'`);

    // Build response URL
    const baseUrl = process.env.NEXTAUTH_URL || process.env.AUTH_URL || 'http://localhost:3000';
    const sessionUrl = `${baseUrl}/incident/${gitSession.id}`;

    const totalDuration = Date.now() - startTime;
    console.log(`[WEB:INGEST:${requestId}] ✅ Request completed successfully`);
    console.log(`[WEB:INGEST:${requestId}]    Total duration: ${totalDuration}ms`);
    console.log(`[WEB:INGEST:${requestId}]    Session URL: ${sessionUrl}`);
    console.log(`[WEB:INGEST:${requestId}] ========================================`);

    return NextResponse.json({
      sessionId: gitSession.id,
      url: sessionUrl,
      analysis: {
        issueType: analysis.issueType,
        summary: analysis.summary,
      },
    });
  } catch (error) {
    console.error(`[WEB:INGEST:${requestId}] ❌ Fatal error during ingestion`);
    console.error(`[WEB:INGEST:${requestId}]    Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(`[WEB:INGEST:${requestId}]    Stack: ${error.stack.substring(0, 500)}`);
    }
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

