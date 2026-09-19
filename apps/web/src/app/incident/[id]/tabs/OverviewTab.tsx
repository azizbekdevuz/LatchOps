'use client';

import { AlertTriangle, Link2, RefreshCw, CheckCircle, HelpCircle, FileEdit, ShieldAlert } from 'lucide-react';
import type { IncidentData } from '../incident-data';

const INCIDENT_INFO: Record<string, { title: string; description: string; color: string }> = {
  merge_conflict: {
    title: 'Merge Conflict',
    description: 'Conflicting changes must be resolved before the operation can complete.',
    color: 'text-yellow-500',
  },
  detached_head: {
    title: 'Detached HEAD',
    description: 'HEAD points at a commit rather than a branch. New commits can be lost if you switch away without saving them.',
    color: 'text-orange-500',
  },
  rebase_in_progress: {
    title: 'Rebase in Progress',
    description: 'A rebase is underway. Continue, skip, or abort it.',
    color: 'text-blue-500',
  },
  dirty_worktree: {
    title: 'Uncommitted Changes',
    description: 'The working tree has pending changes that can be preserved before any recovery.',
    color: 'text-amber-500',
  },
  clean: {
    title: 'Clean State',
    description: 'No issues detected. The repository is in a clean state.',
    color: 'text-green-500',
  },
  unknown: {
    title: 'Needs Manual Review',
    description: 'The repository state could not be classified into a first-class incident; proceed with read-only diagnostics.',
    color: 'text-gray-400',
  },
};

function icon(type: string, cls: string) {
  switch (type) {
    case 'merge_conflict':
      return <AlertTriangle className={cls} />;
    case 'detached_head':
      return <Link2 className={cls} />;
    case 'rebase_in_progress':
      return <RefreshCw className={cls} />;
    case 'dirty_worktree':
      return <FileEdit className={cls} />;
    case 'clean':
      return <CheckCircle className={cls} />;
    default:
      return <HelpCircle className={cls} />;
  }
}

export default function OverviewTab({ data }: { data: IncidentData }) {
  const info = INCIDENT_INFO[data.incidentType] ?? INCIDENT_INFO.unknown;
  const plan = data.plan;
  const w = data.signals?.worktree;

  return (
    <div className="space-y-6">
      <div className="bg-bg-secondary border border-border-color rounded-lg p-6">
        <div className="flex items-start gap-4">
          <div className={info.color}>{icon(data.incidentType, 'w-8 h-8')}</div>
          <div className="flex-1">
            <div className="flex items-center gap-3">
              <h2 className={`text-xl font-semibold ${info.color}`}>{info.title}</h2>
              {data.risk && (
                <span className="text-xs px-2 py-0.5 rounded bg-bg-tertiary border border-border-color capitalize">
                  {data.risk} risk
                </span>
              )}
              {plan?.manualReviewRequired && (
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3" /> Manual review
                </span>
              )}
            </div>
            <p className="text-text-secondary mt-1">{info.description}</p>
            {data.summary && (
              <p className="text-text-primary mt-3 p-3 bg-bg-tertiary rounded-md">{data.summary}</p>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-bg-secondary border border-border-color rounded-lg p-4">
          <h3 className="text-sm font-medium text-text-muted mb-3">Repository State</h3>
          <dl className="space-y-2">
            <Row label="Branch" value={data.branch.name ?? (data.branch.isDetached ? '(detached)' : 'unknown')} mono />
            <Row label="Commit" value={data.branch.oid?.slice(0, 8) ?? 'N/A'} mono />
            <Row label="Detached HEAD" value={data.branch.isDetached ? 'Yes' : 'No'} />
            <Row label="Staged" value={String(w?.staged ?? 0)} />
            <Row label="Modified" value={String(w?.modified ?? 0)} />
            <Row label="Untracked" value={String(w?.untracked ?? 0)} />
            <Row label="Conflicted" value={String(w?.conflicted ?? 0)} />
          </dl>
        </div>

        <div className="bg-bg-secondary border border-border-color rounded-lg p-4">
          <h3 className="text-sm font-medium text-text-muted mb-3">Why this classification</h3>
          {data.reasons.length > 0 ? (
            <ul className="space-y-2">
              {data.reasons.map((r, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-text-secondary">
                  <span className="text-accent-blue mt-1">•</span>
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-text-muted">No classification reasons recorded.</p>
          )}
        </div>
      </div>

      {plan && plan.preconditions.length > 0 && (
        <div className="bg-bg-secondary border border-border-color rounded-lg p-4">
          <h3 className="text-sm font-medium text-text-muted mb-3">Preconditions</h3>
          <ul className="space-y-1">
            {plan.preconditions.map((p, i) => (
              <li key={i} className="text-sm text-text-secondary flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-accent-green mt-0.5 flex-shrink-0" />
                <span>{p}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan && plan.warnings.length > 0 && (
        <div className="bg-yellow-500/5 border border-yellow-500/30 rounded-lg p-4">
          <h3 className="text-sm font-medium text-yellow-500 mb-3 flex items-center gap-2">
            <AlertTriangle className="w-4 h-4" /> Warnings
          </h3>
          <ul className="space-y-1">
            {plan.warnings.map((warning, i) => (
              <li key={i} className="text-sm text-text-secondary">{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between">
      <dt className="text-text-secondary">{label}</dt>
      <dd className={mono ? 'font-mono text-sm' : 'text-sm'}>{value}</dd>
    </div>
  );
}
