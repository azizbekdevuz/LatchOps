-- Representative Phase 3 fixture (baseline schema only)
INSERT INTO "User" (id, email, name, "createdAt", "updatedAt")
VALUES
  ('user_owner_phase3', 'owner@phase3.test', 'Owner', NOW(), NOW()),
  ('user_anon_phase3', 'anon@phase3.test', 'Anon', NOW(), NOW());

INSERT INTO "Account" (id, "userId", type, provider, "providerAccountId")
VALUES ('acct_owner', 'user_owner_phase3', 'oauth', 'github', 'gh-owner');

INSERT INTO "GitSession" (id, title, os, "repoRootHash", status, "userId", "createdAt", "updatedAt")
VALUES
  ('gs_owned', 'Owned merge conflict', 'linux', 'hash-owned', 'ready', 'user_owner_phase3', NOW(), NOW()),
  ('gs_anon', 'Anonymous dirty worktree', 'darwin', 'hash-anon', 'ready', NULL, NOW(), NOW());

INSERT INTO "Snapshot" (id, "gitSessionId", "snapshotJson", truncated, "createdAt")
VALUES
  ('snap_owned', 'gs_owned', '{"version":1,"repoRoot":"/tmp/phase3-owned"}'::jsonb, false, NOW()),
  ('snap_anon', 'gs_anon', '{"version":1,"repoRoot":"/tmp/phase3-anon"}'::jsonb, false, NOW());

INSERT INTO "Analysis" (id, "gitSessionId", "snapshotId", "issueType", summary, "signalsJson", "planJson", risk, "engineVersion", "createdAt")
VALUES
  ('analysis_owned', 'gs_owned', 'snap_owned', 'merge_conflict', 'Merge conflict in src/app.ts',
   '{"state":"merge_conflict"}'::jsonb, '{"incidentType":"merge_conflict","risk":"medium"}'::jsonb, 'medium', 'recovery-engine@1', NOW()),
  ('analysis_anon', 'gs_anon', 'snap_anon', 'dirty_worktree', 'Uncommitted changes',
   '{"state":"dirty_worktree"}'::jsonb, '{"incidentType":"dirty_worktree","risk":"low"}'::jsonb, 'low', 'recovery-engine@1', NOW());

INSERT INTO "ConflictFile" (id, "analysisId", path, "createdAt")
VALUES ('cf_1', 'analysis_owned', 'src/app.ts', NOW());

INSERT INTO "ConflictHunk" (id, "conflictFileId", index, "startLine", "endLine", "baseText", "oursText", "theirsText", "createdAt")
VALUES ('ch_1', 'cf_1', 0, 1, 5, 'ctx', 'ours', 'theirs', NOW());

INSERT INTO "PlanStep" (id, "analysisId", index, title, "commandsJson", "verifyJson", "undoJson", "createdAt")
VALUES ('ps_1', 'analysis_owned', 0, 'Inspect conflicts', '[]'::jsonb, '{}'::jsonb, '{}'::jsonb, NOW());

INSERT INTO "Trace" (id, "gitSessionId", stage, "snapshotId", "outputJson", success, "createdAt")
VALUES
  ('tr_owned', 'gs_owned', 'plan_generated', 'snap_owned', '{"ok":true}'::jsonb, true, NOW()),
  ('tr_anon', 'gs_anon', 'plan_generated', 'snap_anon', '{"ok":true}'::jsonb, true, NOW());

INSERT INTO "Event" (id, type, "userId", "gitSessionId", "createdAt")
VALUES
  ('ev_owned', 'session.created', 'user_owner_phase3', 'gs_owned', NOW()),
  ('ev_anon', 'session.created', NULL, 'gs_anon', NOW());
