"""
Request/Response Models for FastAPI
"""
from typing import Optional, TypedDict
from pydantic import BaseModel


class GitAnalysisState(TypedDict):
    """State that flows through the recovery engine graph pipeline."""
    snapshot: dict
    options: dict
    issue_type: str
    risk_level: str
    repo_graph: dict
    conflicts: list
    signals: dict
    summary: str
    conflict_explanations: dict
    plan_steps: list
    stage_traces: list
    error: str


class AnalyzeOptions(BaseModel):
    includeGraph: bool = True
    maxConflictFiles: int = 10
    maxHunksPerFile: int = 5


class AnalyzeRequest(BaseModel):
    snapshot: dict
    options: Optional[AnalyzeOptions] = None


class AnalyzeResponse(BaseModel):
    success: bool
    analysis: Optional[dict] = None
    error: Optional[str] = None
    durationMs: Optional[int] = None
    pipelineTraces: Optional[list] = None

