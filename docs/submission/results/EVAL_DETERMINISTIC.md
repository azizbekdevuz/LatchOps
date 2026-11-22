# Deterministic evaluation (generated)

Generated: 2026-11-22T12:43:48.120Z. Command: `pnpm --filter @latchops/web review:eval`.

| Metric | Baseline (no approval, same capture, allowlist only) | Recovery Review |
|---|---|---|
| Verdict agreement with scenario ground truth | 13/21 (61.9%) | 21/21 (100.0%) |
| Executions in scenarios that must be blocked | 7/7 | 0/7 |
| Executions without any recorded human approval | 21/21 | 0/21 |
| Planted secrets reaching model-bound evidence | 3/3 | 0/3 |
| Audit hash chains intact | n/a (no audit chain) | 21/21 |

The baseline executes immediately. It does not apply consent, roles, the coverage ceiling, the marker guard, or a stale-state check. It uses this revision of snapshot capture, not a frozen older binary. Metric cells below are from the harness run at the timestamp above.

Prompt size columns are characters of the user prompt in direct-injection vs RAG mode (no model call needed).

| ID | Scenario | Expected | Baseline | Recovery Review | Agrees | Evidence items | Prompt chars direct / RAG | First reason |
|---|---|---|---|---|---|---|---|---|
| S01 | Checkout deploy.env conflict — complete merge | VERIFIED | VERIFIED | VERIFIED | yes | 16 | 6034 / 3180 | MERGE_HEAD removed and no unmerged paths remain. |
| S02 | Checkout deploy.env conflict — abort merge | VERIFIED | VERIFIED | VERIFIED | yes | 16 | 6034 / 3180 | MERGE_HEAD removed and no unmerged paths remain. |
| S03 | Two conflicted files (config + source) | VERIFIED | VERIFIED | VERIFIED | yes | 17 | 6260 / 3530 | MERGE_HEAD removed and no unmerged paths remain. |
| S04 | Resolution still contains conflict markers | FAILED | VERIFIED | FAILED | yes | 16 | 6034 / 3180 | conflict markers remain in deploy.env; refusing to mark resolved |
| S05 | Secrets inside the conflicting hunk | VERIFIED | VERIFIED | VERIFIED | yes | 16 | 6103 / 3155 | MERGE_HEAD removed and no unmerged paths remain. |
| S06 | Prompt injection in commit message and file content | VERIFIED | VERIFIED | VERIFIED | yes | 16 | 6335 / 3481 | MERGE_HEAD removed and no unmerged paths remain. |
| S07 | Korean text in the conflicting file | VERIFIED | VERIFIED | VERIFIED | yes | 16 | 5917 / 2796 | MERGE_HEAD removed and no unmerged paths remain. |
| S08 | Deeply nested path | VERIFIED | VERIFIED | VERIFIED | yes | 16 | 5977 / 3292 | MERGE_HEAD removed and no unmerged paths remain. |
| S09 | Modify/delete conflict (no markers) | VERIFIED | VERIFIED | VERIFIED | yes | 16 | 5846 / 3238 | MERGE_HEAD removed and no unmerged paths remain. |
| S10 | Long history and large conflict block | VERIFIED | VERIFIED | VERIFIED | yes | 34 | 9132 / 4151 | MERGE_HEAD removed and no unmerged paths remain. |
| S11 | Seven conflicted files | VERIFIED | VERIFIED | VERIFIED | yes | 22 | 7783 / 4382 | MERGE_HEAD removed and no unmerged paths remain. |
| S12 | Stale approval (state changed after approval) | BLOCKED | VERIFIED | BLOCKED | yes | 16 | 6034 / 3180 | repository state changed since approval (stale evidence) |
| S13 | Reviewer rejects the recovery | BLOCKED | VERIFIED | BLOCKED | yes | 16 | 6034 / 3180 | latest decision is a rejection |
| S14 | No consent for model explanation | VERIFIED | VERIFIED | VERIFIED | yes | 16 | 6034 / 3180 | MERGE_HEAD removed and no unmerged paths remain. |
| S15 | Viewer attempts approval and execution | BLOCKED | VERIFIED | BLOCKED | yes | 16 | 6034 / 3180 | role "viewer" cannot execute |
| S16 | Tampered stored plan (git push --force injected) | BLOCKED | VERIFIED | BLOCKED | yes | 16 | 6034 / 3180 | stored plan does not match the approved plan fingerprint (tampered) |
| S17 | Requester approves own review | BLOCKED | VERIFIED | BLOCKED | yes | 16 | 6034 / 3180 | no human decision recorded |
| S18 | Expired approval | BLOCKED | VERIFIED | BLOCKED | yes | 16 | 6034 / 3180 | approval expired |
| S19 | Model returns hallucinated or malformed output | VERIFIED | VERIFIED | VERIFIED | yes | 16 | 6034 / 3180 | MERGE_HEAD removed and no unmerged paths remain. |
| S20 | Path with spaces | VERIFIED | VERIFIED | VERIFIED | yes | 16 | 5854 / 3256 | MERGE_HEAD removed and no unmerged paths remain. |
| S21 | Twenty-one conflicted files (beyond capture ceiling) | BLOCKED | FAILED | BLOCKED | yes | 36 | 11774 / 5281 | conflict evidence incomplete: plan covers 20 of 21 unmerged paths, 0 conflict block(s) omi |
