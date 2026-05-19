"""
recovery engine Tools for Git Analysis
Tools used by the StateGraph pipeline
"""
from spoon_ai.tools.base import BaseTool


class DetectIssueTool(BaseTool):
    """Tool to detect the primary issue type from a git snapshot."""
    name: str = "detect_issue"
    description: str = "Analyze git snapshot to detect the primary issue (merge_conflict, detached_head, rebase_in_progress, clean)"
    parameters: dict = {
        "type": "object",
        "properties": {
            "snapshot": {"type": "object", "description": "Git repository snapshot"}
        },
        "required": ["snapshot"]
    }

    async def execute(self, snapshot: dict) -> dict:
        unmerged = snapshot.get("unmergedFiles", [])
        is_detached = snapshot.get("isDetachedHead", False)
        rebase_state = snapshot.get("rebaseState", {})

        if unmerged and len(unmerged) > 0:
            issue_type = "merge_conflict"
            risk = "high" if len(unmerged) > 3 else "medium"
        elif rebase_state.get("inProgress", False):
            issue_type = "rebase_in_progress"
            risk = "medium"
        elif is_detached:
            issue_type = "detached_head"
            risk = "medium"
        else:
            staged = snapshot.get("stagedFiles", [])
            modified = snapshot.get("modifiedFiles", [])
            if not staged and not modified:
                issue_type = "clean"
                risk = "low"
            else:
                issue_type = "unknown"
                risk = "low"

        return {"issue_type": issue_type, "risk_level": risk}


class BuildGraphTool(BaseTool):
    """Tool to build repository visualization graph."""
    name: str = "build_graph"
    description: str = "Build a visual graph representation of the repository state"
    parameters: dict = {
        "type": "object",
        "properties": {
            "snapshot": {"type": "object", "description": "Git repository snapshot"}
        },
        "required": ["snapshot"]
    }

    async def execute(self, snapshot: dict) -> dict:
        nodes = []
        edges = []

        branch = snapshot.get("branch", {})
        head_oid = branch.get("oid", "")[:7]
        head_name = branch.get("head", "HEAD")
        is_detached = snapshot.get("isDetachedHead", False)

        # Add HEAD node
        nodes.append({
            "id": "head",
            "type": "head",
            "label": "HEAD",
            "sha": head_oid,
            "isCurrent": True,
            "isDetached": is_detached,
            "x": 400, "y": 50
        })

        # Add current branch
        if not is_detached and head_name:
            nodes.append({
                "id": f"branch-{head_name}",
                "type": "branch",
                "label": head_name,
                "sha": head_oid,
                "isCurrent": True,
                "x": 550, "y": 50
            })
            edges.append({"from": "head", "to": f"branch-{head_name}", "type": "ref"})

        # Add commits from log
        recent_log = snapshot.get("recentLog", [])[:8]
        for i, entry in enumerate(recent_log):
            commit_id = f"commit-{i}"
            sha = entry.get("hash", "")[:7]
            message = entry.get("message", "")[:40]
            refs = entry.get("refs", [])

            nodes.append({
                "id": commit_id,
                "type": "commit",
                "label": message,
                "sha": sha,
                "isCurrent": (i == 0),
                "x": 400,
                "y": 120 + (i * 80)
            })

            # Add refs
            for j, ref in enumerate(refs):
                if ref and not ref.startswith("HEAD"):
                    ref_id = f"ref-{ref.replace('/', '-')}"
                    ref_type = "remote" if "/" in ref else "branch"
                    nodes.append({
                        "id": ref_id,
                        "type": ref_type,
                        "label": ref,
                        "sha": sha,
                        "x": 550 + (j * 100),
                        "y": 120 + (i * 80)
                    })
                    edges.append({"from": ref_id, "to": commit_id, "type": "ref"})

            # Connect to previous commit
            if i > 0:
                edges.append({"from": f"commit-{i-1}", "to": commit_id, "type": "parent"})

        # Connect HEAD to first commit
        if recent_log:
            edges.append({"from": "head", "to": "commit-0", "type": "pointer"})

        # Add merge head if exists
        merge_head = snapshot.get("mergeHead")
        if merge_head:
            nodes.append({
                "id": "merge-head",
                "type": "merge",
                "label": "MERGE_HEAD",
                "sha": merge_head[:7],
                "x": 250, "y": 50
            })
            edges.append({"from": "merge-head", "to": "commit-0", "type": "merge"})

        return {
            "nodes": nodes,
            "edges": edges,
            "headRef": head_oid,
            "mergeHeadRef": merge_head[:7] if merge_head else None
        }


class ExtractConflictsTool(BaseTool):
    """Tool to extract and structure conflict information."""
    name: str = "extract_conflicts"
    description: str = "Extract conflict files and hunks from snapshot"
    parameters: dict = {
        "type": "object",
        "properties": {
            "snapshot": {"type": "object"},
            "max_files": {"type": "integer", "default": 10},
            "max_hunks": {"type": "integer", "default": 5}
        },
        "required": ["snapshot"]
    }

    async def execute(self, snapshot: dict, max_files: int = 10, max_hunks: int = 5) -> list:
        conflicts = []
        unmerged = snapshot.get("unmergedFiles", [])[:max_files]

        for file_data in unmerged:
            path = file_data.get("path", "unknown")
            blocks = file_data.get("conflictBlocks", [])[:max_hunks]

            hunks = []
            for i, block in enumerate(blocks):
                hunks.append({
                    "index": i,
                    "startLine": block.get("startLine"),
                    "endLine": block.get("endLine"),
                    "baseText": block.get("context", ""),
                    "oursText": block.get("oursContent", ""),
                    "theirsText": block.get("theirsContent", ""),
                    "linesAdded": len(block.get("oursContent", "").split("\n")),
                    "linesRemoved": len(block.get("theirsContent", "").split("\n")),
                })

            conflicts.append({
                "path": path,
                "hunks": hunks,
                "hunkCount": len(hunks),
                "severity": "high" if len(hunks) > 2 else "medium" if len(hunks) > 1 else "low"
            })

        return conflicts

