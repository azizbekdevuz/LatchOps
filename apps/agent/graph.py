"""
recovery engine Graph Construction
Creates the analysis pipeline graph
"""
from typing import TYPE_CHECKING
from spoon_ai.graph import StateGraph, END

# Handle both direct execution and module import
try:
    from .models import GitAnalysisState
    from .nodes import (
        detect_issue_node,
        build_graph_node,
        extract_conflicts_node,
        collect_signals_node,
    )
except ImportError:
    from models import GitAnalysisState
    from nodes import (
        detect_issue_node,
        build_graph_node,
        extract_conflicts_node,
        collect_signals_node,
    )

if TYPE_CHECKING:
    from spoon_ai.chat import ChatBot


def create_analysis_graph(llm: "ChatBot") -> StateGraph:
    """Create the recovery engine graph for git analysis pipeline."""
    graph = StateGraph(GitAnalysisState)

    # Add nodes
    graph.add_node("detect_issue", detect_issue_node)
    graph.add_node("build_graph", build_graph_node)
    graph.add_node("extract_conflicts", extract_conflicts_node)
    graph.add_node("collect_signals", collect_signals_node)
    
    # Generate analysis node needs LLM, so we create a wrapper
    async def generate_analysis_wrapper(state: GitAnalysisState) -> dict:
        try:
            from .nodes import generate_analysis_node
        except ImportError:
            from nodes import generate_analysis_node
        return await generate_analysis_node(state, llm)
    
    graph.add_node("generate_analysis", generate_analysis_wrapper)

    # Set entry point
    graph.set_entry_point("detect_issue")

    # Define edges (sequential pipeline)
    graph.add_edge("detect_issue", "build_graph")
    graph.add_edge("build_graph", "extract_conflicts")
    graph.add_edge("extract_conflicts", "collect_signals")
    graph.add_edge("collect_signals", "generate_analysis")
    graph.add_edge("generate_analysis", END)

    return graph.compile()

