import { NextRequest, NextResponse } from 'next/server';
import { SnapshotV1Schema } from '@latchops/schema';
import {
  getSession,
  getLatestSnapshot,
  getLatestAnalysis,
  updatePlanStepStatus,
  createAnalysis,
  createPlanStep,
  createConflictFile,
  createConflictHunk,
  saveTrace,
  deleteAnalysisBySnapshotId,
} from '@/lib/db';
import { collectSignals } from '@/lib/agent/collector';
import { classifyIssue } from '@/lib/agent/classifier';
import { generatePlan } from '@/lib/agent/planner';

const AGENT_URL = process.env.AGENT_URL || 'http://localhost:8000';

/**
 * GET /api/sessions/[id]/plan
 * Get the recovery plan for a session.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: sessionId } = await params;

    const analysis = await getLatestAnalysis(sessionId);
    if (!analysis) {
      return NextResponse.json({ error: 'No analysis found' }, { status: 404 });
    }

    return NextResponse.json({
      issueType: analysis.issueType,
      summary: analysis.summary,
      planSteps: analysis.planSteps.map((step) => ({
        id: step.id,
        index: step.index,
        title: step.title,
        rationale: step.rationale,
        commands: step.commandsJson,
        verify: step.verifyJson,
        undo: step.undoJson,
        dangerLevel: step.dangerLevel,
        status: step.status,
      })),
    });
  } catch (error) {
    console.error('Error fetching plan:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * PATCH /api/sessions/[id]/plan
 * Update a plan step status.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await params; // Validate params exist
    const body = await request.json();
    const { stepId, status, userConfirmed } = body;

    if (!stepId || !status) {
      return NextResponse.json(
        { error: 'stepId and status are required' },
        { status: 400 }
      );
    }

    const updatedStep = await updatePlanStepStatus(stepId, status, userConfirmed);

    return NextResponse.json({
      id: updatedStep.id,
      status: updatedStep.status,
      completedAt: updatedStep.completedAt?.toISOString(),
    });
  } catch (error) {
    console.error('Error updating plan step:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * POST /api/sessions/[id]/plan
 * Generate a recovery plan for a session.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const requestId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const pipelineStart = Date.now();

  console.log(`[WEB:PLAN:${requestId}] ========================================`);
  console.log(`[WEB:PLAN:${requestId}] 📋 New plan generation request`);
  console.log(`[WEB:PLAN:${requestId}] Timestamp: ${new Date().toISOString()}`);
  console.log(`[WEB:PLAN:${requestId}] Agent URL: ${AGENT_URL}`);

  try {
    const { id: sessionId } = await params;
    console.log(`[WEB:PLAN:${requestId}] Session ID: ${sessionId}`);

    // Check for optional dangerousAllowed body parameter
    let dangerousAllowed = false;
    try {
      const body = await request.json();
      dangerousAllowed = body.dangerousAllowed ?? false;
    } catch {
      // No body or invalid JSON is fine, use defaults
    }

    const session = await getSession(sessionId);
    if (!session) {
      console.error(`[WEB:PLAN:${requestId}] ❌ Session not found`);
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    const snapshotRecord = await getLatestSnapshot(sessionId);
    if (!snapshotRecord) {
      console.error(`[WEB:PLAN:${requestId}] ❌ Snapshot not found`);
      return NextResponse.json({ error: 'Snapshot not found' }, { status: 404 });
    }

    const snapshot = SnapshotV1Schema.parse(snapshotRecord.snapshotJson);
    console.log(`[WEB:PLAN:${requestId}] ✅ Snapshot loaded`);
    console.log(`[WEB:PLAN:${requestId}]    Branch: ${snapshot.branch.head}`);
    console.log(`[WEB:PLAN:${requestId}]    Conflicts: ${snapshot.unmergedFiles.length} files`);

    // Try to call Python agent first
    console.log(`[WEB:PLAN:${requestId}] 🔄 Attempting to call Python agent for AI analysis...`);
    let usePythonAgent = false;
    let agentAnalysis = null;

    try {
      const agentRequestStart = Date.now();
      console.log(`[WEB:PLAN:${requestId}]    Calling: ${AGENT_URL}/analyze`);
      
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
      console.log(`[WEB:PLAN:${requestId}]    Request duration: ${agentRequestDuration}ms`);
      console.log(`[WEB:PLAN:${requestId}]    Response status: ${agentResult.status}`);

      if (agentResult.ok) {
        agentAnalysis = await agentResult.json();
        usePythonAgent = true;
        console.log(`[WEB:PLAN:${requestId}] ✅ Python agent responded successfully`);
        console.log(`[WEB:PLAN:${requestId}]    Success: ${agentAnalysis.success}`);
        console.log(`[WEB:PLAN:${requestId}]    Pipeline traces: ${agentAnalysis.pipelineTraces?.length || 0}`);
        console.log(`[WEB:PLAN:${requestId}] 🎯 USING REAL AI MODEL (Python Agent)`);
        
        // Save pipeline traces from Python agent
        if (agentAnalysis.pipelineTraces && Array.isArray(agentAnalysis.pipelineTraces)) {
          console.log(`[WEB:PLAN:${requestId}] 💾 Saving ${agentAnalysis.pipelineTraces.length} pipeline traces from Python agent...`);
          let cumulativeTime = pipelineStart;
          for (const trace of agentAnalysis.pipelineTraces) {
            const traceStart = cumulativeTime;
            cumulativeTime += (trace.duration_ms || trace.durationMs || 0);
            await saveTrace(
              sessionId,
              trace.stage || 'unknown',
              snapshotRecord.id,
              trace.input || trace.inputJson || {},
              trace.output || trace.outputJson || {},
              traceStart,
              trace.success !== false,
            );
            console.log(`[WEB:PLAN:${requestId}]    ✓ Saved trace: ${trace.stage}`);
          }
        }
      } else {
        const errorText = await agentResult.text();
        console.error(`[WEB:PLAN:${requestId}] ❌ Python agent returned error: ${agentResult.status}`);
        console.error(`[WEB:PLAN:${requestId}]    Error: ${errorText.substring(0, 200)}`);
        throw new Error(`Agent returned ${agentResult.status}`);
      }
    } catch (agentError) {
      console.error(`[WEB:PLAN:${requestId}] ❌ Python agent call failed`);
      console.error(`[WEB:PLAN:${requestId}]    Error: ${agentError instanceof Error ? agentError.message : String(agentError)}`);
      console.warn(`[WEB:PLAN:${requestId}] ⚠️  FALLBACK MODE: Using TypeScript analysis (NO AI)`);
      usePythonAgent = false;
    }

    // Run the recovery pipeline (either from Python agent or TypeScript fallback)
    let plan;
    let analysis;

    if (usePythonAgent && agentAnalysis?.success && agentAnalysis?.analysis) {
      // Use Python agent's AI-generated analysis
      console.log(`[WEB:PLAN:${requestId}] 📝 Processing Python agent analysis...`);
      const aiAnalysis = agentAnalysis.analysis;

      // Delete existing analysis for this snapshot (allows regeneration)
      await deleteAnalysisBySnapshotId(snapshotRecord.id);

      // Save analysis and plan steps from Python agent
      analysis = await createAnalysis({
        gitSessionId: sessionId,
        snapshotId: snapshotRecord.id,
        issueType: aiAnalysis.issueType,
        summary: aiAnalysis.summary,
        repoGraphJson: aiAnalysis.repoGraph,
      });
      console.log(`[WEB:PLAN:${requestId}] ✅ Analysis saved: ${analysis.id}`);

      // Store conflict files and hunks from Python agent
      if (aiAnalysis.conflicts) {
        console.log(`[WEB:PLAN:${requestId}] 💾 Storing ${aiAnalysis.conflicts.length} conflict files from Python agent...`);
        for (const conflict of aiAnalysis.conflicts) {
          const conflictFile = await createConflictFile({
            analysisId: analysis.id,
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
      }

      // Convert Python agent plan steps to our format
      const planSteps = aiAnalysis.planSteps || [];
      console.log(`[WEB:PLAN:${requestId}] 💾 Storing ${planSteps.length} plan steps from Python agent...`);
      for (let i = 0; i < planSteps.length; i++) {
        const step = planSteps[i];
        await createPlanStep({
          analysisId: analysis.id,
          index: i,
          title: step.title,
          rationale: step.description || step.rationale,
          commandsJson: step.commands || [],
          verifyJson: step.verify || [],
          undoJson: step.undo || [],
          dangerLevel: step.dangerLevel || 'safe',
        });
      }

      // Convert to PlanV1 format for response
      plan = {
        issueType: aiAnalysis.issueType,
        issueSummary: aiAnalysis.summary,
        risk: aiAnalysis.riskLevel || 'medium',
        steps: planSteps.map((step: any, idx: number) => ({
          id: `step-${idx}`,
          title: step.title,
          description: step.description || step.rationale || '',
          commands: step.commands || [],
          expected: step.expectedOutput || '',
          undo: {
            possible: (step.undo || []).length > 0,
            description: step.undo?.length > 0 ? 'Use undo commands' : '',
            commands: step.undo || [],
          },
          dangerous: step.dangerLevel === 'dangerous' || step.dangerLevel === 'caution',
        })),
      };

      console.log(`[WEB:PLAN:${requestId}] ✅ Plan generated from Python agent (AI-powered)`);
    } else {
      // Fallback to TypeScript analysis
      console.log(`[WEB:PLAN:${requestId}] 📝 Using TypeScript fallback analysis...`);

      // Stage 1: Detect Issue (Pipeline: detect_issue)
      const detectStart = Date.now();
      const signals = collectSignals(snapshot);
      const issueType = signals.primaryIssue || 'unknown';
      const riskLevel = signals.estimatedRisk || 'medium';
      await saveTrace(sessionId, 'detect_issue', snapshotRecord.id, { snapshot: 'parsed' }, { issueType, riskLevel }, detectStart);
      console.log(`[WEB:PLAN:${requestId}]    ✓ detect_issue: ${issueType}, ${riskLevel}`);

      // Stage 2: Build Graph (Pipeline: build_graph)
      const graphStart = Date.now();
      const repoGraph = {
        nodes: [],
        edges: [],
        headRef: snapshot.branch.oid,
      };
      await saveTrace(sessionId, 'build_graph', snapshotRecord.id, { snapshot }, { nodes: 0, edges: 0 }, graphStart);
      console.log(`[WEB:PLAN:${requestId}]    ✓ build_graph`);

      // Stage 3: Extract Conflicts (Pipeline: extract_conflicts)
      const extractStart = Date.now();
      const conflictCount = snapshot.unmergedFiles.length;
      await saveTrace(sessionId, 'extract_conflicts', snapshotRecord.id, { snapshot }, { conflictCount }, extractStart);
      console.log(`[WEB:PLAN:${requestId}]    ✓ extract_conflicts: ${conflictCount} files`);

      // Stage 4: Collect Signals (Pipeline: collect_signals)
      const signalsStart = Date.now();
      await saveTrace(sessionId, 'collect_signals', snapshotRecord.id, { snapshot }, signals, signalsStart);
      console.log(`[WEB:PLAN:${requestId}]    ✓ collect_signals`);

      // Stage 5: Classify Issue (refinement)
      const classifierStart = Date.now();
      const classification = await classifyIssue(signals);
      await saveTrace(sessionId, 'classifier', snapshotRecord.id, signals, classification, classifierStart);
      console.log(`[WEB:PLAN:${requestId}]    ✓ classifier`);

      // Update signals with classification results
      const classifiedSignals = {
        ...signals,
        primaryIssue: classification.primaryIssue,
        secondaryIssues: classification.secondaryIssues,
        estimatedRisk: classification.estimatedRisk,
      };

      // Stage 6: Generate Analysis (Pipeline: generate_analysis)
      const plannerStart = Date.now();
      plan = await generatePlan(snapshot, classifiedSignals, dangerousAllowed);
      await saveTrace(sessionId, 'generate_analysis', snapshotRecord.id, classifiedSignals, plan, plannerStart);
      console.log(`[WEB:PLAN:${requestId}]    ✓ generate_analysis: ${plan.steps.length} steps`);

      // Delete existing analysis for this snapshot (allows regeneration)
      await deleteAnalysisBySnapshotId(snapshotRecord.id);

      // Save analysis and plan steps to database
      analysis = await createAnalysis({
        gitSessionId: sessionId,
        snapshotId: snapshotRecord.id,
        issueType: plan.issueType,
        summary: plan.issueSummary,
      });
      console.log(`[WEB:PLAN:${requestId}] ✅ Analysis saved: ${analysis.id}`);

      // Create plan steps
      console.log(`[WEB:PLAN:${requestId}] 💾 Storing ${plan.steps.length} plan steps from TypeScript fallback...`);
      for (let i = 0; i < plan.steps.length; i++) {
        const step = plan.steps[i];
        await createPlanStep({
          analysisId: analysis.id,
          index: i,
          title: step.title,
          rationale: step.description,
          commandsJson: step.commands,
          verifyJson: { expected: step.expected },
          undoJson: step.undo,
          dangerLevel: step.dangerous ? 'dangerous' : 'safe',
        });
      }

      console.log(`[WEB:PLAN:${requestId}] ✅ Plan generated from TypeScript fallback (NO AI)`);
    }

    const totalDuration = Date.now() - pipelineStart;
    console.log(`[WEB:PLAN:${requestId}] ✅ Plan generation completed`);
    console.log(`[WEB:PLAN:${requestId}]    Total duration: ${totalDuration}ms`);
    console.log(`[WEB:PLAN:${requestId}]    Plan steps: ${plan.steps.length}`);
    console.log(`[WEB:PLAN:${requestId}]    Source: ${usePythonAgent ? 'Python Agent (AI)' : 'TypeScript Fallback (NO AI)'}`);
    console.log(`[WEB:PLAN:${requestId}] ========================================`);

    return NextResponse.json({
      success: true,
      plan,
      analysisId: analysis.id,
      duration: totalDuration,
    });
  } catch (error) {
    console.error(`[WEB:PLAN:${requestId}] ❌ Fatal error during plan generation`);
    console.error(`[WEB:PLAN:${requestId}]    Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      console.error(`[WEB:PLAN:${requestId}]    Stack: ${error.stack.substring(0, 500)}`);
    }
    console.error(`[WEB:PLAN:${requestId}] ========================================`);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
