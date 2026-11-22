import type { RecoveryPlanV1, RepoSignalsV1, SnapshotV1 } from '@latchops/schema';
import { hashValue } from './canonical';
import { detectSecrets, redactText } from './redact';
import type { EvidenceItem, EvidenceKind, EvidenceSnapshot, RedactionReport } from './types';

const MAX_SIDE_CHARS = 600;
const MAX_COMMITS = 30;
const MAX_REFLOG = 5;

function clip(value: string, max: number): { text: string; clipped: boolean } {
  if (value.length <= max) return { text: value, clipped: false };
  return { text: `${value.slice(0, max)}…[${value.length - max} chars truncated]`, clipped: true };
}

function short(oid: string | null | undefined): string {
  return oid ? oid.slice(0, 10) : 'none';
}

export interface BuiltEvidence {
  evidence: EvidenceSnapshot;
  redaction: RedactionReport;
  evidenceHash: string;
  planHash: string;
}

/**
 * Plan identity without volatile fields, so the same deterministic plan for
 * the same state always hashes the same.
 */
export function planFingerprint(plan: RecoveryPlanV1): string {
  const { generatedAt: _generatedAt, ...stable } = plan;
  return hashValue(stable);
}

/**
 * Turn deterministic engine outputs into a numbered, redacted evidence list.
 * Volatile values (timestamps, absolute temp paths) are excluded so the hash
 * identifies the repository state, not the capture moment.
 */
export function buildEvidence(input: {
  snapshot: SnapshotV1;
  signals: RepoSignalsV1;
  plan: RecoveryPlanV1;
}): BuiltEvidence {
  const { snapshot, signals, plan } = input;
  const raw: Array<Omit<EvidenceItem, 'id'>> = [];
  const truncationNotes: string[] = [];
  const add = (kind: EvidenceKind, label: string, text: string, source: string, untrusted = false) => {
    raw.push({ kind, label, text, source, untrusted });
  };

  add(
    'classification',
    'Deterministic classification',
    `state=${signals.state}; secondary=${signals.secondaryStates.join(',') || 'none'}; reasons: ${signals.reasons.join(' | ')}`,
    'signals.state, signals.reasons',
  );

  add(
    'operation',
    'In-progress operation',
    [
      `merge_in_progress=${signals.operations.merge}`,
      `MERGE_HEAD=${short(snapshot.mergeHead)}`,
      `rebase_in_progress=${signals.operations.rebase}`,
      `cherry_pick_in_progress=${signals.operations.cherryPick}`,
      `revert_in_progress=${signals.operations.revert}`,
    ].join('; '),
    'signals.operations, snapshot.mergeHead',
  );

  if (snapshot.mergeMessage) {
    add('operation', 'Prepared merge message', clip(snapshot.mergeMessage, 300).text, 'snapshot.mergeMessage', true);
  }

  add(
    'branch',
    'Current branch',
    `branch=${signals.branch.name ?? '(detached)'}; HEAD=${short(signals.branch.oid)}; upstream=${signals.branch.upstream ?? 'none'}; ahead=${signals.branch.ahead}; behind=${signals.branch.behind}`,
    'signals.branch',
  );

  add(
    'worktree',
    'Working tree counts',
    `conflicted_paths=${signals.worktree.conflicted}; staged=${signals.worktree.staged}; modified=${signals.worktree.modified}; untracked=${signals.worktree.untracked}; conflicted_list=${signals.worktree.conflictedPaths.join(', ') || 'none'}`,
    'signals.worktree',
  );

  const rawUnmerged = (snapshot.rawStatus.match(/^u /gm) ?? []).length;
  const captured = signals.worktree.conflicted;
  if (rawUnmerged > captured) {
    add(
      'worktree',
      'Capture coverage gap',
      `raw_status_unmerged=${rawUnmerged}; captured_conflicted_paths=${captured}; the deterministic plan covers only the captured paths`,
      'snapshot.rawStatus vs signals.worktree',
    );
    truncationNotes.push(
      `git status reports ${rawUnmerged} unmerged paths but only ${captured} were captured; execution is blocked until coverage is complete.`,
    );
  }

  const contentPaths = new Set(snapshot.unmergedFiles.map((file) => file.path));
  for (const path of signals.worktree.conflictedPaths) {
    if (!contentPaths.has(path)) {
      truncationNotes.push(`Conflict content for ${path} was not captured (capture limit or non-text conflict).`);
    }
  }

  for (const file of snapshot.unmergedFiles) {
    if (file.conflictBlocks.length === 0) {
      add(
        'conflict',
        `Conflict in ${file.path}`,
        `path=${file.path}; no conflict-marker blocks found (likely a modify/delete or binary conflict)`,
        `snapshot.unmergedFiles[${file.path}]`,
        true,
      );
      continue;
    }
    file.conflictBlocks.forEach((block, index) => {
      const ours = clip(block.oursContent, MAX_SIDE_CHARS);
      const theirs = clip(block.theirsContent, MAX_SIDE_CHARS);
      if (ours.clipped || theirs.clipped) {
        truncationNotes.push(`Conflict block ${index + 1} in ${file.path} was truncated to ${MAX_SIDE_CHARS} chars per side.`);
      }
      add(
        'conflict',
        `Conflict ${index + 1} in ${file.path}`,
        [
          `path=${file.path}; block=${index + 1}; lines=${block.startLine}-${block.endLine}`,
          'ours (HEAD, current branch):',
          ours.text,
          'theirs (MERGE_HEAD, incoming branch):',
          theirs.text,
        ].join('\n'),
        `snapshot.unmergedFiles[${file.path}].conflictBlocks[${index}]`,
        true,
      );
    });
  }

  const commits = snapshot.recentLog.slice(0, MAX_COMMITS);
  if (snapshot.recentLog.length >= MAX_COMMITS) {
    truncationNotes.push(`Only the ${MAX_COMMITS} most recent commits are included.`);
  }
  commits.forEach((commit, index) => {
    add(
      'commit',
      `Recent commit ${index + 1}`,
      `commit=${short(commit.hash)}; refs=${commit.refs.join(',') || 'none'}; subject=${clip(commit.message, 200).text}`,
      `snapshot.recentLog[${index}]`,
      true,
    );
  });

  snapshot.recentReflog.slice(0, MAX_REFLOG).forEach((entry, index) => {
    add(
      'reflog',
      `Reflog ${entry.selector}`,
      `${entry.selector} ${short(entry.hash)} ${clip(entry.message, 200).text}`,
      `snapshot.recentReflog[${index}]`,
      true,
    );
  });

  add(
    'plan',
    'Deterministic plan summary',
    `incident=${plan.incidentType}; risk=${plan.risk}; summary=${plan.summary}; warnings=${plan.warnings.join(' | ') || 'none'}; generated_by=${plan.generatedBy}`,
    'plan.summary, plan.risk, plan.warnings',
  );

  for (const alt of plan.alternatives) {
    const commands = alt.steps.flatMap((step) => step.commands.map((cmd) => cmd.display));
    add(
      'alternative',
      `Alternative ${alt.id}`,
      `id=${alt.id}; title=${alt.title}; risk=${alt.risk}; recommended_by_engine=${alt.recommended}; tradeoffs=${alt.tradeoffs}; engine_commands=${commands.join(' ; ')}`,
      `plan.alternatives[${alt.id}]`,
    );
  }

  const findings: RedactionReport['findings'] = [];
  const items: EvidenceItem[] = raw.map((item, index) => {
    const id = `E${index + 1}`;
    const label = redactText(item.label);
    const text = redactText(item.text);
    const counts: Record<string, number> = { ...label.counts };
    for (const [type, n] of Object.entries(text.counts)) counts[type] = (counts[type] ?? 0) + n;
    for (const [type, count] of Object.entries(counts)) findings.push({ itemId: id, type, count });
    return { ...item, id, label: label.text, text: text.text };
  });

  const evidence: EvidenceSnapshot = {
    version: 1,
    incidentType: signals.state,
    items,
    truncated: truncationNotes.length > 0,
    truncationNotes,
    coverage: { rawUnmerged, captured },
  };
  const residual = detectSecrets(items.map((item) => `${item.label}\n${item.text}`).join('\n'));
  const redaction: RedactionReport = {
    findings,
    totalRedactions: findings.reduce((sum, f) => sum + f.count, 0),
    verifiedClean: residual.length === 0,
  };

  return { evidence, redaction, evidenceHash: hashValue(evidence), planHash: planFingerprint(plan) };
}

export function evidenceText(items: EvidenceItem[]): string {
  return items.map((item) => `[${item.id}] (${item.kind}) ${item.label}\n${item.text}`).join('\n\n');
}
