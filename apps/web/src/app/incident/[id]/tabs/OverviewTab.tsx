'use client';

import { useMemo } from 'react';
import { AlertTriangle, Link2, RefreshCw, CheckCircle, HelpCircle } from 'lucide-react';

interface RepoGraph {
  nodes: Array<{ id: string; type: string; label: string; sha?: string; isCurrent?: boolean }>;
  edges: Array<{ from: string; to: string; type?: string }>;
}

interface SessionData {
  id: string;
  title: string;
  status: string;
  createdAt: string;
  snapshot: {
    branch: { head: string; oid: string };
    platform: string;
    isDetachedHead: boolean;
    rebaseState: { inProgress: boolean };
  };
  analysis: {
    issueType: string;
    summary: string;
    repoGraphJson: unknown;
    conflictFiles: Array<unknown>;
    planSteps: Array<unknown>;
  } | null;
}

interface OverviewTabProps {
  sessionData: SessionData;
}

export default function OverviewTab({ sessionData }: OverviewTabProps) {
  const repoGraph = sessionData.analysis?.repoGraphJson as RepoGraph | undefined;

  const issueInfo = useMemo(() => {
    const type = sessionData.analysis?.issueType || 'unknown';
    const info: Record<string, { title: string; description: string; color: string }> = {
      merge_conflict: {
        title: 'Merge Conflict',
        description: 'Your repository has conflicting changes that need to be resolved before you can complete the merge.',
        color: 'text-yellow-500',
      },
      detached_head: {
        title: 'Detached HEAD',
        description: 'You are not on any branch. Your commits may be lost if you switch branches without creating a new branch first.',
        color: 'text-orange-500',
      },
      rebase_in_progress: {
        title: 'Rebase in Progress',
        description: 'A rebase operation is currently in progress. You need to continue, skip, or abort it.',
        color: 'text-blue-500',
      },
      clean: {
        title: 'Clean State',
        description: 'Your repository is in a clean state with no issues detected.',
        color: 'text-green-500',
      },
      unknown: {
        title: 'Unknown State',
        description: 'Unable to determine the repository state.',
        color: 'text-gray-500',
      },
    };
    return info[type] || info.unknown;
  }, [sessionData.analysis?.issueType]);

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <div className="bg-bg-secondary border border-border-color rounded-lg p-6">
        <div className="flex items-start gap-4">
          <div className={`${issueInfo.color}`}>
            {sessionData.analysis?.issueType === 'merge_conflict' && <AlertTriangle className="w-8 h-8" />}
            {sessionData.analysis?.issueType === 'detached_head' && <Link2 className="w-8 h-8" />}
            {sessionData.analysis?.issueType === 'rebase_in_progress' && <RefreshCw className="w-8 h-8" />}
            {sessionData.analysis?.issueType === 'clean' && <CheckCircle className="w-8 h-8" />}
            {(!sessionData.analysis?.issueType || sessionData.analysis?.issueType === 'unknown') && <HelpCircle className="w-8 h-8" />}
          </div>
          <div className="flex-1">
            <h2 className={`text-xl font-semibold ${issueInfo.color}`}>{issueInfo.title}</h2>
            <p className="text-text-secondary mt-1">{issueInfo.description}</p>
            {sessionData.analysis?.summary && (
              <p className="text-text-primary mt-3 p-3 bg-bg-tertiary rounded-md">
                {sessionData.analysis.summary}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Repository Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-bg-secondary border border-border-color rounded-lg p-4">
          <h3 className="text-sm font-medium text-text-muted mb-3">Repository State</h3>
          <dl className="space-y-2">
            <div className="flex justify-between">
              <dt className="text-text-secondary">Branch</dt>
              <dd className="font-mono text-sm">{sessionData.snapshot.branch.head}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary">Commit</dt>
              <dd className="font-mono text-sm">{sessionData.snapshot.branch.oid?.slice(0, 7) || 'N/A'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary">Platform</dt>
              <dd className="text-sm">{sessionData.snapshot.platform}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary">Detached HEAD</dt>
              <dd className="text-sm">{sessionData.snapshot.isDetachedHead ? 'Yes' : 'No'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary">Rebase Active</dt>
              <dd className="text-sm">{sessionData.snapshot.rebaseState.inProgress ? 'Yes' : 'No'}</dd>
            </div>
          </dl>
        </div>

        <div className="bg-bg-secondary border border-border-color rounded-lg p-4">
          <h3 className="text-sm font-medium text-text-muted mb-3">Analysis Summary</h3>
          <dl className="space-y-2">
            <div className="flex justify-between">
              <dt className="text-text-secondary">Conflict Files</dt>
              <dd className="font-medium">{sessionData.analysis?.conflictFiles?.length || 0}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary">Plan Steps</dt>
              <dd className="font-medium">{sessionData.analysis?.planSteps?.length || 0}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary">Issue Type</dt>
              <dd className="font-medium capitalize">{sessionData.analysis?.issueType?.replace('_', ' ') || 'Unknown'}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-text-secondary">Session Status</dt>
              <dd className="font-medium capitalize">{sessionData.status}</dd>
            </div>
          </dl>
        </div>
      </div>

      {/* Repo Graph Visualization */}
      {repoGraph && repoGraph.nodes && repoGraph.nodes.length > 0 && (
        <div className="bg-bg-secondary border border-border-color rounded-lg p-4">
          <h3 className="text-sm font-medium text-text-muted mb-4">Repository Graph</h3>
          <div className="overflow-x-auto">
            <div className="min-w-[400px] p-4">
              {/* Simple text-based graph representation */}
              <div className="font-mono text-sm space-y-2">
                {repoGraph.nodes.map((node, index) => (
                  <div key={node.id} className="flex items-center gap-3">
                    <span className={`w-3 h-3 rounded-full ${
                      node.isCurrent ? 'bg-accent-blue' :
                      node.type === 'branch' ? 'bg-green-500' :
                      node.type === 'tag' ? 'bg-yellow-500' : 'bg-gray-500'
                    }`} />
                    <span className={node.isCurrent ? 'text-accent-blue font-bold' : 'text-text-primary'}>
                      {node.label}
                    </span>
                    {node.sha && (
                      <span className="text-text-muted text-xs">{node.sha.slice(0, 7)}</span>
                    )}
                    {node.isCurrent && (
                      <span className="text-xs bg-accent-blue/20 text-accent-blue px-2 py-0.5 rounded">HEAD</span>
                    )}
                    {index < repoGraph.nodes.length - 1 && (
                      <span className="text-text-muted ml-auto">│</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quick Actions */}
      <div className="bg-bg-secondary border border-border-color rounded-lg p-4">
        <h3 className="text-sm font-medium text-text-muted mb-3">Quick Actions</h3>
        <div className="flex flex-wrap gap-2">
          {sessionData.analysis?.issueType === 'merge_conflict' && (
            <button className="px-4 py-2 bg-accent-blue hover:bg-accent-blue/80 rounded-md text-sm font-medium transition-colors">
              View Conflicts
            </button>
          )}
          <button className="px-4 py-2 bg-bg-tertiary hover:bg-bg-tertiary/80 border border-border-color rounded-md text-sm font-medium transition-colors">
            View Recovery Plan
          </button>
          <button className="px-4 py-2 bg-bg-tertiary hover:bg-bg-tertiary/80 border border-border-color rounded-md text-sm font-medium transition-colors">
            Upload New Snapshot
          </button>
        </div>
      </div>
    </div>
  );
}
