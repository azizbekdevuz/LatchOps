"""
Fallback Plan Generation
Generates recovery plans without AI when LLM is unavailable
"""


def generate_fallback_plan(issue_type: str, snapshot: dict, conflicts: list) -> list:
    """Generate fallback plan without AI."""
    branch = snapshot.get("branch", {}).get("head", "main")

    if issue_type == "merge_conflict":
        conflict_files = [c["path"] for c in conflicts]
        return [
            {
                "title": "Review Conflict Files",
                "description": f"You have conflicts in {len(conflicts)} file(s): {', '.join(conflict_files[:3])}. Review each to understand what changed.",
                "commands": ["git status", "git diff --name-only --diff-filter=U"],
                "expectedOutput": "List of files with UU (unmerged) status",
                "verify": ["git status"],
                "undo": [],
                "dangerLevel": "safe",
                "estimatedTime": "quick"
            },
            {
                "title": "Resolve Conflicts",
                "description": "Open each conflicted file and resolve the conflict markers (<<<<<<, ======, >>>>>>).",
                "commands": [f"# Edit {f}" for f in conflict_files[:3]],
                "expectedOutput": "Files no longer contain conflict markers",
                "verify": ["git diff"],
                "undo": ["git checkout --conflict=merge <file>"],
                "dangerLevel": "safe",
                "estimatedTime": "careful"
            },
            {
                "title": "Stage Resolved Files",
                "description": "Mark conflicts as resolved by staging the files.",
                "commands": [f"git add {f}" for f in conflict_files[:3]],
                "expectedOutput": "Files moved from 'Unmerged' to 'Staged'",
                "verify": ["git status"],
                "undo": ["git reset HEAD <file>"],
                "dangerLevel": "safe",
                "estimatedTime": "quick"
            },
            {
                "title": "Complete Merge",
                "description": "Commit the merge resolution.",
                "commands": ["git commit -m 'Resolve merge conflicts'"],
                "expectedOutput": "Merge commit created",
                "verify": ["git log -1"],
                "undo": ["git reset --soft HEAD~1"],
                "dangerLevel": "caution",
                "estimatedTime": "quick"
            }
        ]
    elif issue_type == "detached_head":
        return [
            {
                "title": "Check Current Position",
                "description": "See where HEAD is pointing and what branches exist.",
                "commands": ["git log --oneline -5", "git branch -a"],
                "expectedOutput": "Current commit history and available branches",
                "verify": ["git status"],
                "undo": [],
                "dangerLevel": "safe",
                "estimatedTime": "quick"
            },
            {
                "title": "Save Your Work",
                "description": "Create a branch to preserve current commits before moving.",
                "commands": ["git branch temp-save-work"],
                "expectedOutput": "New branch 'temp-save-work' created at current commit",
                "verify": ["git branch"],
                "undo": ["git branch -d temp-save-work"],
                "dangerLevel": "safe",
                "estimatedTime": "quick"
            },
            {
                "title": f"Return to {branch}",
                "description": f"Switch back to your main working branch '{branch}'.",
                "commands": [f"git checkout {branch}"],
                "expectedOutput": f"Switched to branch '{branch}'",
                "verify": ["git status"],
                "undo": ["git checkout temp-save-work"],
                "dangerLevel": "safe",
                "estimatedTime": "quick"
            }
        ]
    elif issue_type == "rebase_in_progress":
        return [
            {
                "title": "Check Rebase Status",
                "description": "Understand where you are in the rebase process.",
                "commands": ["git status", "git rebase --show-current-patch"],
                "expectedOutput": "Current rebase step and conflict details",
                "verify": [],
                "undo": [],
                "dangerLevel": "safe",
                "estimatedTime": "quick"
            },
            {
                "title": "Option A: Continue Rebase",
                "description": "If you've resolved conflicts, continue the rebase.",
                "commands": ["git add .", "git rebase --continue"],
                "expectedOutput": "Rebase continues to next commit or completes",
                "verify": ["git status"],
                "undo": ["git rebase --abort"],
                "dangerLevel": "caution",
                "estimatedTime": "moderate"
            },
            {
                "title": "Option B: Abort Rebase",
                "description": "Cancel the rebase and return to the original state.",
                "commands": ["git rebase --abort"],
                "expectedOutput": "Returns to state before rebase started",
                "verify": ["git status", "git log -3"],
                "undo": [],
                "dangerLevel": "safe",
                "estimatedTime": "quick"
            }
        ]
    else:
        return [
            {
                "title": "Check Status",
                "description": "Review the current repository state.",
                "commands": ["git status", "git log --oneline -5"],
                "expectedOutput": "Current branch and recent commits",
                "verify": [],
                "undo": [],
                "dangerLevel": "safe",
                "estimatedTime": "quick"
            }
        ]

