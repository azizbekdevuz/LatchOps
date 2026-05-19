"""
LatchOps Service - multi-stage Git Analysis
Uses recovery engine Graph System for multi-stage AI pipeline
"""
import os
import time
import json
import logging
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from spoon_ai.chat import ChatBot

# Handle both direct execution and module import
try:
    from .graph import create_analysis_graph
    from .models import AnalyzeRequest, AnalyzeResponse, GitAnalysisState
except ImportError:
    # When running directly (python main.py), use absolute imports
    from graph import create_analysis_graph
    from models import AnalyzeRequest, AnalyzeResponse, GitAnalysisState

load_dotenv()

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    datefmt='%Y-%m-%d %H:%M:%S'
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="LatchOps",
    description="multi-stage Git incident analysis service with graph-based AI pipeline",
    version="2.0.0",
)

# CORS for web app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize recovery engine LLM
MODEL = os.getenv("MODEL_NAME", "claude-sonnet-4-20250514")
llm = ChatBot(
    llm_provider="anthropic",
    model_name=MODEL,
)

# Create the compiled graph
analysis_pipeline = create_analysis_graph(llm)


# ==========================================
# API Endpoints
# ==========================================

@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {
        "status": "healthy",
        "service": "latchops-agent",
        "version": "2.0.0",
        "framework": "recovery engine"
    }


@app.post("/analyze", response_model=AnalyzeResponse)
async def analyze_snapshot(request: AnalyzeRequest):
    """Analyze a git snapshot using recovery engine graph pipeline."""
    start_time = time.time()
    request_id = f"py-{int(time.time() * 1000)}-{os.urandom(4).hex()}"
    
    logger.info("=" * 60)
    logger.info(f"🚀 [PYTHON:ANALYZE:{request_id}] New analysis request received")
    logger.info(f"   Timestamp: {time.strftime('%Y-%m-%d %H:%M:%S')}")
    logger.info(f"   Snapshot branch: {request.snapshot.get('branch', {}).get('head', 'unknown')}")
    logger.info(f"   Has conflicts: {len(request.snapshot.get('unmergedFiles', [])) > 0}")
    logger.info(f"   Detached HEAD: {request.snapshot.get('isDetachedHead', False)}")
    logger.info(f"   Rebase in progress: {request.snapshot.get('rebaseState', {}).get('inProgress', False)}")
    logger.info(f"   AI Model: {MODEL}")
    logger.info(f"   LLM Provider: anthropic")

    try:
        # Initialize state
        initial_state: GitAnalysisState = {
            "snapshot": request.snapshot,
            "options": request.options.model_dump() if request.options else {},
            "issue_type": "",
            "risk_level": "",
            "repo_graph": {},
            "conflicts": [],
            "signals": {},
            "summary": "",
            "conflict_explanations": {},
            "plan_steps": [],
            "stage_traces": [],
            "error": ""
        }

        # Run the recovery pipeline
        logger.info(f"🔄 [PYTHON:ANALYZE:{request_id}] Starting recovery pipeline execution...")
        logger.info(f"   Pipeline stages: detect_issue → build_graph → extract_conflicts → collect_signals → generate_analysis")
        result = await analysis_pipeline.invoke(initial_state)
        logger.info(f"✅ [PYTHON:ANALYZE:{request_id}] recovery pipeline completed successfully")

        duration_ms = int((time.time() - start_time) * 1000)
        logger.info(f"⏱️  [PYTHON:ANALYZE:{request_id}] Total analysis time: {duration_ms}ms")

        # Enhance conflicts with explanations
        conflicts_with_explanations = []
        for conflict in result.get("conflicts", []):
            explanation = result.get("conflict_explanations", {}).get(conflict["path"], {})
            conflicts_with_explanations.append({
                **conflict,
                "whatHappened": explanation.get("whatHappened"),
                "whyConflict": explanation.get("whyConflict"),
                "recommendation": explanation.get("recommendation"),
                "priority": explanation.get("priority", "medium")
            })

        logger.info(f"✅ [PYTHON:ANALYZE:{request_id}] Analysis complete")
        logger.info(f"   Issue type: {result['issue_type']}")
        logger.info(f"   Risk level: {result['risk_level']}")
        logger.info(f"   Plan steps: {len(result.get('plan_steps', []))}")
        logger.info(f"   Pipeline traces: {len(result.get('stage_traces', []))}")
        logger.info(f"   Conflicts: {len(result.get('conflicts', []))}")
        logger.info(f"   Summary length: {len(result.get('summary', ''))} chars")
        
        # Check if AI was used (has conflict_explanations or detailed summary)
        has_ai_content = bool(result.get('conflict_explanations')) or len(result.get('summary', '')) > 100
        if has_ai_content:
            logger.info(f"🎯 [PYTHON:ANALYZE:{request_id}] USING REAL AI MODEL - Response contains AI-generated content")
        else:
            logger.warning(f"⚠️  [PYTHON:ANALYZE:{request_id}] FALLBACK MODE - Response appears to be rule-based")
        
        logger.info("=" * 60)

        return AnalyzeResponse(
            success=True,
            analysis={
                "issueType": result["issue_type"],
                "riskLevel": result["risk_level"],
                "summary": result["summary"],
                "repoGraph": result["repo_graph"],
                "conflicts": conflicts_with_explanations,
                "planSteps": result["plan_steps"],
                "signals": result["signals"]
            },
            durationMs=duration_ms,
            pipelineTraces=result.get("stage_traces", [])
        )

    except Exception as e:
        duration_ms = int((time.time() - start_time) * 1000)
        logger.error(f"❌ [PYTHON:ANALYZE:{request_id}] Error during analysis: {str(e)}")
        logger.error(f"   Error type: {type(e).__name__}")
        logger.error(f"   Duration before error: {duration_ms}ms")
        import traceback
        logger.error(f"   Traceback: {traceback.format_exc()}")
        logger.info("=" * 60)
        return AnalyzeResponse(
            success=False,
            error=str(e),
            durationMs=duration_ms
        )


@app.post("/explain/conflict")
async def explain_conflict(file_path: str, hunk_index: int, ours: str, theirs: str):
    """Get detailed AI explanation for a specific conflict hunk."""
    prompt = f"""Analyze this specific git merge conflict and provide guidance:

**File**: {file_path}
**Hunk**: #{hunk_index + 1}

**OURS (your current branch)**:
```
{ours}
```

**THEIRS (incoming changes)**:
```
{theirs}
```

Provide a JSON response with:
1. "oursIntent": What your code is trying to do
2. "theirsIntent": What the incoming code is trying to do
3. "conflictReason": Why these changes conflict
4. "recommendation": "keep_ours", "keep_theirs", "combine", or "needs_review"
5. "combinedCode": If recommend combine, provide the merged code
6. "explanation": Human-readable explanation of your recommendation

Be specific and reference the actual code."""

    try:
        response = await llm.chat(prompt)
        content = response if isinstance(response, str) else response.content

        try:
            result = json.loads(content)
        except:
            if "```json" in content:
                result = json.loads(content.split("```json")[1].split("```")[0])
            else:
                result = {"explanation": content}

        return {"success": True, "explanation": result}
    except Exception as e:
        return {"success": False, "error": str(e)}


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8000"))
    host = os.getenv("HOST", "0.0.0.0")
    logger.info("=" * 60)
    logger.info("🚀 LatchOps Service Starting")
    logger.info(f"   Host: {host}")
    logger.info(f"   Port: {port}")
    logger.info(f"   Recovery Pipeline: Enabled")
    logger.info("=" * 60)
    uvicorn.run(app, host=host, port=port)
