"""
recovery engine Graph Nodes
Pipeline stage implementations
"""
import time
import json
import logging
from typing import TYPE_CHECKING

# Handle both direct execution and module import
try:
    from .tools import DetectIssueTool, BuildGraphTool, ExtractConflictsTool
    from .fallback import generate_fallback_plan
    from .models import GitAnalysisState
except ImportError:
    from tools import DetectIssueTool, BuildGraphTool, ExtractConflictsTool
    from fallback import generate_fallback_plan
    from models import GitAnalysisState

if TYPE_CHECKING:
    from spoon_ai.chat import ChatBot

logger = logging.getLogger(__name__)


async def detect_issue_node(state: GitAnalysisState) -> dict:
    """Stage 1: Detect issue type and risk level."""
    start = time.time()
    snapshot = state["snapshot"]
    logger.info("🔍 [detect_issue] Starting issue detection...")

    tool = DetectIssueTool()
    result = await tool.execute(snapshot)
    
    duration_ms = int((time.time() - start) * 1000)
    logger.info(f"✅ [detect_issue] Completed in {duration_ms}ms - Issue: {result.get('issue_type')}, Risk: {result.get('risk_level')}")

    trace = {
        "stage": "detect_issue",
        "duration_ms": duration_ms,
        "output": result
    }

    return {
        "issue_type": result["issue_type"],
        "risk_level": result["risk_level"],
        "stage_traces": state.get("stage_traces", []) + [trace]
    }


async def build_graph_node(state: GitAnalysisState) -> dict:
    """Stage 2: Build repository visualization graph."""
    start = time.time()
    logger.info("📊 [build_graph] Building repository graph...")

    tool = BuildGraphTool()
    graph = await tool.execute(state["snapshot"])
    
    duration_ms = int((time.time() - start) * 1000)
    node_count = len(graph.get("nodes", []))
    edge_count = len(graph.get("edges", []))
    logger.info(f"✅ [build_graph] Completed in {duration_ms}ms - Nodes: {node_count}, Edges: {edge_count}")

    trace = {
        "stage": "build_graph",
        "duration_ms": duration_ms,
        "output": {"nodes": len(graph["nodes"]), "edges": len(graph["edges"])}
    }

    return {
        "repo_graph": graph,
        "stage_traces": state.get("stage_traces", []) + [trace]
    }


async def extract_conflicts_node(state: GitAnalysisState) -> dict:
    """Stage 3: Extract conflict information."""
    start = time.time()
    logger.info("🔧 [extract_conflicts] Extracting conflict information...")

    if state["issue_type"] != "merge_conflict":
        logger.info("⏭️  [extract_conflicts] Skipped - not a merge conflict")
        return {"conflicts": [], "stage_traces": state.get("stage_traces", [])}

    tool = ExtractConflictsTool()
    options = state.get("options", {})
    conflicts = await tool.execute(
        state["snapshot"],
        max_files=options.get("maxConflictFiles", 10),
        max_hunks=options.get("maxHunksPerFile", 5)
    )
    
    duration_ms = int((time.time() - start) * 1000)
    conflict_count = len(conflicts)
    logger.info(f"✅ [extract_conflicts] Completed in {duration_ms}ms - Found {conflict_count} conflict file(s)")

    trace = {
        "stage": "extract_conflicts",
        "duration_ms": duration_ms,
        "output": {"conflict_count": conflict_count}
    }

    return {
        "conflicts": conflicts,
        "stage_traces": state.get("stage_traces", []) + [trace]
    }


async def collect_signals_node(state: GitAnalysisState) -> dict:
    """Stage 4: Collect normalized signals for AI analysis."""
    start = time.time()
    logger.info("📡 [collect_signals] Collecting repository signals...")
    snapshot = state["snapshot"]

    signals = {
        "primaryIssue": state["issue_type"],
        "riskLevel": state["risk_level"],
        "conflictCount": len(state.get("conflicts", [])),
        "isDetachedHead": snapshot.get("isDetachedHead", False),
        "isRebaseInProgress": snapshot.get("rebaseState", {}).get("inProgress", False),
        "currentBranch": snapshot.get("branch", {}).get("head", "unknown"),
        "hasStagedChanges": len(snapshot.get("stagedFiles", [])) > 0,
        "hasUnstagedChanges": len(snapshot.get("modifiedFiles", [])) > 0,
        "hasUntrackedFiles": len(snapshot.get("untrackedFiles", [])) > 0,
        "recentActions": [
            entry.get("action", "") for entry in snapshot.get("recentReflog", [])[:5]
        ],
    }

    duration_ms = int((time.time() - start) * 1000)
    logger.info(f"✅ [collect_signals] Completed in {duration_ms}ms - Primary issue: {signals.get('primaryIssue')}")

    trace = {
        "stage": "collect_signals",
        "duration_ms": duration_ms,
        "output": signals
    }

    return {
        "signals": signals,
        "stage_traces": state.get("stage_traces", []) + [trace]
    }


async def generate_analysis_node(state: GitAnalysisState, llm: "ChatBot") -> dict:
    """Stage 5: Use LLM to generate analysis, explanations, and plan."""
    start = time.time()
    logger.info("🤖 [generate_analysis] Generating AI analysis and recovery plan...")

    snapshot = state["snapshot"]
    signals = state["signals"]
    conflicts = state.get("conflicts", [])

    # Build detailed context for LLM
    context = f"""You are LatchOps, an expert Git recovery assistant. Analyze this repository state and provide specific, actionable guidance.

## Current Situation
- **Issue Type**: {signals["primaryIssue"].replace("_", " ").title()}
- **Risk Level**: {signals["riskLevel"].upper()}
- **Branch**: {signals["currentBranch"]}
- **Conflicts**: {signals["conflictCount"]} file(s)
- **Detached HEAD**: {"Yes" if signals["isDetachedHead"] else "No"}
- **Rebase in Progress**: {"Yes" if signals["isRebaseInProgress"] else "No"}

## Repository State
- Staged files: {len(snapshot.get("stagedFiles", []))}
- Modified files: {len(snapshot.get("modifiedFiles", []))}
- Untracked files: {len(snapshot.get("untrackedFiles", []))}

## Recent Git Actions
{chr(10).join(f"- {action}" for action in signals["recentActions"]) if signals["recentActions"] else "No recent actions recorded"}
"""

    if conflicts:
        context += "\n## Conflict Details\n"
        for cf in conflicts[:5]:
            context += f"\n### {cf['path']} ({cf['hunkCount']} hunks, {cf['severity']} severity)\n"
            for hunk in cf["hunks"][:2]:
                context += f"""
**Hunk {hunk['index'] + 1}** (lines {hunk.get('startLine', '?')}-{hunk.get('endLine', '?')}):
- OURS ({hunk['linesAdded']} lines):
```
{hunk['oursText'][:300]}{'...' if len(hunk['oursText']) > 300 else ''}
```
- THEIRS ({hunk['linesRemoved']} lines):
```
{hunk['theirsText'][:300]}{'...' if len(hunk['theirsText']) > 300 else ''}
```
"""

    prompt = f"""{context}

## Your Task
Provide a comprehensive analysis in JSON format with these fields:

1. **summary**: A clear 2-3 sentence explanation of what happened and why (be specific to THIS situation, not generic)

2. **conflictExplanations**: For each conflict file, provide:
   - "path": file path
   - "whatHappened": Specific explanation of what each side changed
   - "whyConflict": Why these changes conflict
   - "recommendation": Specific resolution strategy (keep ours, keep theirs, or how to combine)
   - "priority": "high", "medium", or "low"

3. **planSteps**: Array of specific recovery steps, each with:
   - "title": Clear action title
   - "description": Detailed explanation of what this step does and why
   - "commands": Exact git commands to run (with actual file names from the conflicts)
   - "expectedOutput": What user should see after running
   - "verify": Commands to verify success
   - "undo": Commands to undo if something goes wrong
   - "dangerLevel": "safe", "caution", or "dangerous"
   - "estimatedTime": "quick" (< 1 min), "moderate" (1-5 min), or "careful" (> 5 min)

4. **quickActions**: Array of 2-3 one-click actions for common resolutions:
   - "label": Button label
   - "command": Single git command
   - "description": What it does

Be SPECIFIC to this user's actual situation. Reference actual file names and branch names. Focus on SAFE, REVERSIBLE solutions.

Respond with ONLY valid JSON, no markdown code blocks."""

    try:
        logger.info(f"🤖 [generate_analysis] Calling AI model (LLM)...")
        logger.info(f"   Model: {llm.model_name if hasattr(llm, 'model_name') else 'unknown'}")
        logger.info(f"   Provider: {llm.llm_provider if hasattr(llm, 'llm_provider') else 'unknown'}")
        logger.info(f"   Prompt length: {len(prompt)} characters")
        
        llm_call_start = time.time()
        response = await llm.chat(prompt)
        llm_call_duration = int((time.time() - llm_call_start) * 1000)
        logger.info(f"✅ [generate_analysis] AI model responded in {llm_call_duration}ms")
        
        content = response if isinstance(response, str) else response.content
        logger.info(f"   Response length: {len(content)} characters")

        # Parse JSON response
        try:
            result = json.loads(content)
            logger.info(f"✅ [generate_analysis] Successfully parsed JSON response from AI")
        except json.JSONDecodeError:
            logger.warning(f"⚠️  [generate_analysis] JSON parse failed, attempting markdown extraction...")
            # Try to extract from markdown
            if "```json" in content:
                json_str = content.split("```json")[1].split("```")[0]
                result = json.loads(json_str)
                logger.info(f"✅ [generate_analysis] Extracted JSON from markdown code block")
            elif "```" in content:
                json_str = content.split("```")[1].split("```")[0]
                result = json.loads(json_str)
                logger.info(f"✅ [generate_analysis] Extracted JSON from code block")
            else:
                logger.error(f"❌ [generate_analysis] Failed to parse JSON response")
                raise

        duration_ms = int((time.time() - start) * 1000)
        plan_steps_count = len(result.get("planSteps", []))
        logger.info(f"✅ [generate_analysis] Completed in {duration_ms}ms - Generated {plan_steps_count} plan steps")
        logger.info(f"🎯 [generate_analysis] USING REAL AI MODEL - Analysis generated by LLM")

        trace = {
            "stage": "generate_analysis",
            "duration_ms": duration_ms,
            "output": {"has_summary": "summary" in result, "plan_steps": plan_steps_count}
        }

        return {
            "summary": result.get("summary", "Analysis complete."),
            "conflict_explanations": {
                exp["path"]: exp for exp in result.get("conflictExplanations", [])
            },
            "plan_steps": result.get("planSteps", []),
            "stage_traces": state.get("stage_traces", []) + [trace]
        }

    except Exception as e:
        duration_ms = int((time.time() - start) * 1000)
        logger.error(f"❌ [generate_analysis] AI model call failed: {str(e)}")
        logger.error(f"   Error type: {type(e).__name__}")
        logger.warning(f"⚠️  [generate_analysis] FALLBACK MODE: Using rule-based plan (NO AI)")
        trace = {
            "stage": "generate_analysis",
            "duration_ms": duration_ms,
            "error": str(e)
        }

        # Fallback plan
        fallback_plan = generate_fallback_plan(signals["primaryIssue"], snapshot, conflicts)
        logger.info(f"✅ [generate_analysis] Fallback plan generated: {len(fallback_plan)} steps")
        return {
            "summary": f"Detected {signals['primaryIssue'].replace('_', ' ')} in your repository.",
            "conflict_explanations": {},
            "plan_steps": fallback_plan,
            "stage_traces": state.get("stage_traces", []) + [trace]
        }

