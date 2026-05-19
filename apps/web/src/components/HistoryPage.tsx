'use client';

import { useState, useEffect } from 'react';
import { Search, ChevronRight, CheckCircle, XCircle, GitBranch, Calendar, Clock, AlertCircle } from 'lucide-react';
import { Badge } from './ui/badge';
import { Header } from './Header';

interface SessionLog {
  id: string;
  createdAt: string;
  title: string | null;
  status: string;
  analysis: {
    issueType: string;
    summary: string | null;
  } | null;
  traces: Array<{
    stage: string;
    outputJson: unknown;
    createdAt: string;
    success: boolean;
  }>;
}

interface HistoryPageProps {
  onNavigateToSession: (id: string) => void;
}

export function HistoryPage({ onNavigateToSession }: HistoryPageProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLog, setSelectedLog] = useState<SessionLog | null>(null);
  const [sessions, setSessions] = useState<SessionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const response = await fetch('/api/sessions');
      if (!response.ok) {
        throw new Error('Failed to load sessions');
      }
      const data = await response.json();
      setSessions(data.sessions || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  };

  const filteredSessions = sessions.filter(session =>
    (session.title?.toLowerCase().includes(searchQuery.toLowerCase()) || false) ||
    (session.analysis?.issueType?.toLowerCase().includes(searchQuery.toLowerCase()) || false) ||
    session.createdAt.includes(searchQuery)
  );

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getIssueTypeLabel = (issueType: string | undefined) => {
    switch (issueType) {
      case 'merge_conflict': return 'Merge Conflict';
      case 'detached_head': return 'Detached HEAD';
      case 'rebase_in_progress': return 'Rebase';
      case 'clean': return 'Clean';
      default: return issueType || 'Unknown';
    }
  };

  const getIssueTypeVariant = (issueType: string | undefined): 'warning' | 'info' | 'purple' | 'success' | 'secondary' => {
    switch (issueType) {
      case 'merge_conflict': return 'warning';
      case 'detached_head': return 'info';
      case 'rebase_in_progress': return 'purple';
      case 'clean': return 'success';
      default: return 'secondary';
    }
  };

  const getStatusVariant = (status: string): 'success' | 'error' | 'warning' | 'info' => {
    switch (status) {
      case 'resolved': return 'success';
      case 'ready': return 'success';
      case 'error': return 'error';
      case 'analyzing': return 'warning';
      default: return 'info';
    }
  };

  const getTraceSteps = (traces: SessionLog['traces']) => {
    const stageOrder = ['collector', 'classifier', 'visual_explainer', 'planner', 'verifier'];
    const stageLabels: Record<string, string> = {
      collector: 'Collector',
      classifier: 'Classifier',
      visual_explainer: 'Explainer',
      planner: 'Planner',
      verifier: 'Verifier',
    };
    const stageColors: Record<string, string> = {
      collector: 'var(--accent-blue)',
      classifier: 'var(--accent-purple)',
      visual_explainer: 'var(--accent-yellow)',
      planner: 'var(--accent-green)',
      verifier: 'var(--accent-blue)',
    };

    return stageOrder.map(stage => ({
      stage,
      label: stageLabels[stage] || stage,
      color: stageColors[stage] || 'var(--text-muted)',
      trace: traces.find(t => t.stage === stage),
    }));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[var(--bg-primary)]">
        <Header />
        <div className="flex items-center justify-center py-20">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-[var(--accent-blue)] border-t-transparent rounded-full animate-spin" />
            <p className="text-[var(--text-secondary)]">Loading sessions...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      <Header />

      <div className="max-w-6xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-[var(--text-primary)] mb-2">Recovery History</h1>
          <p className="text-[var(--text-secondary)]">
            View past recovery sessions and agent decision traces
          </p>
        </div>

        {/* Search Bar */}
        <div className="mb-6 relative max-w-md">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
          <input
            type="text"
            placeholder="Search by title, issue type..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg pl-11 pr-4 py-2.5 text-[var(--text-primary)] placeholder-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-blue)] transition-colors text-sm"
          />
        </div>

        {error && (
          <div className="mb-6 p-4 bg-[rgba(248,81,73,0.1)] border border-[var(--accent-red)] rounded-lg text-[var(--accent-red)] flex items-center gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}

        {/* Sessions List */}
        {filteredSessions.length === 0 ? (
          <div className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-12 text-center">
            <GitBranch className="w-12 h-12 text-[var(--text-muted)] mx-auto mb-4" />
            <h3 className="text-lg font-medium text-[var(--text-primary)] mb-2">
              {sessions.length === 0 ? 'No recovery sessions yet' : 'No sessions match your search'}
            </h3>
            <p className="text-[var(--text-secondary)] text-sm">
              {sessions.length === 0
                ? 'Upload a snapshot from the dashboard to start your first recovery session.'
                : 'Try adjusting your search terms.'}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredSessions.map((session) => (
              <div
                key={session.id}
                className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-lg p-4 hover:border-[var(--accent-blue)]/50 transition-colors cursor-pointer group"
                onClick={() => setSelectedLog(session)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-[var(--text-muted)] text-sm">
                      <Calendar className="w-4 h-4" />
                      <span>{formatDate(session.createdAt)}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <GitBranch className="w-4 h-4 text-[var(--text-muted)]" />
                      <span className="text-[var(--accent-blue)] font-medium">
                        {session.title || session.id.slice(0, 12)}
                      </span>
                    </div>
                    {session.analysis && (
                      <Badge variant={getIssueTypeVariant(session.analysis.issueType)}>
                        {getIssueTypeLabel(session.analysis.issueType)}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <Badge variant={getStatusVariant(session.status)}>
                      {session.status === 'resolved' || session.status === 'ready' ? (
                        <CheckCircle className="w-3 h-3" />
                      ) : session.status === 'error' ? (
                        <XCircle className="w-3 h-3" />
                      ) : (
                        <Clock className="w-3 h-3" />
                      )}
                      {session.status.charAt(0).toUpperCase() + session.status.slice(1)}
                    </Badge>
                    <ChevronRight className="w-4 h-4 text-[var(--text-muted)] group-hover:text-[var(--accent-blue)] transition-colors" />
                  </div>
                </div>
                {session.analysis?.summary && (
                  <p className="mt-2 text-sm text-[var(--text-secondary)] line-clamp-1">
                    {session.analysis.summary}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {selectedLog && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedLog(null)}
        >
          <div
            className="bg-[var(--bg-secondary)] border border-[var(--border-color)] rounded-xl max-w-2xl w-full max-h-[85vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="border-b border-[var(--border-color)] p-6">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="text-lg font-semibold text-[var(--text-primary)]">
                    {selectedLog.title || 'Recovery Session'}
                  </h2>
                  <p className="text-sm text-[var(--text-secondary)] mt-1">
                    {selectedLog.analysis?.summary || 'No summary available'}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedLog(null)}
                  className="text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors p-1"
                >
                  <XCircle className="w-5 h-5" />
                </button>
              </div>

              <div className="flex items-center gap-3 flex-wrap">
                <div className="flex items-center gap-1.5 text-sm text-[var(--text-muted)]">
                  <Calendar className="w-3.5 h-3.5" />
                  {formatDate(selectedLog.createdAt)}
                </div>
                {selectedLog.analysis && (
                  <Badge variant={getIssueTypeVariant(selectedLog.analysis.issueType)}>
                    {getIssueTypeLabel(selectedLog.analysis.issueType)}
                  </Badge>
                )}
                <Badge variant={getStatusVariant(selectedLog.status)}>
                  {selectedLog.status.charAt(0).toUpperCase() + selectedLog.status.slice(1)}
                </Badge>
              </div>
            </div>

            {/* Trace Pipeline */}
            <div className="flex-1 overflow-y-auto p-6">
              <h3 className="text-sm font-medium text-[var(--text-muted)] uppercase tracking-wide mb-4">
                Agent Pipeline Trace
              </h3>
              <div className="space-y-4">
                {getTraceSteps(selectedLog.traces).map((step, index) => (
                  <div key={step.stage} className="flex gap-4">
                    <div className="flex flex-col items-center">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                          step.trace
                            ? 'bg-[var(--accent-green)]/20 text-[var(--accent-green)]'
                            : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)]'
                        }`}
                      >
                        {index + 1}
                      </div>
                      {index < 4 && (
                        <div className={`w-0.5 h-full mt-2 ${
                          step.trace ? 'bg-[var(--accent-green)]/30' : 'bg-[var(--border-color)]'
                        }`} />
                      )}
                    </div>
                    <div className="flex-1 pb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="font-medium text-[var(--text-primary)]">{step.label}</span>
                        {step.trace && (
                          <Badge variant="success" className="text-xs">Done</Badge>
                        )}
                      </div>
                      {step.trace ? (
                        <div className="bg-[var(--bg-primary)] border border-[var(--border-color)] rounded-lg p-3 overflow-hidden">
                          <pre className="text-xs text-[var(--text-secondary)] overflow-auto max-h-32">
                            {JSON.stringify(step.trace.outputJson, null, 2).slice(0, 500)}
                            {JSON.stringify(step.trace.outputJson, null, 2).length > 500 && '...'}
                          </pre>
                        </div>
                      ) : (
                        <p className="text-sm text-[var(--text-muted)]">Not executed</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Modal Footer */}
            <div className="border-t border-[var(--border-color)] p-4 flex justify-end gap-3">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  setSelectedLog(null);
                  onNavigateToSession(selectedLog.id);
                }}
                className="px-4 py-2 text-sm bg-[var(--accent-green)] text-white rounded-lg hover:bg-[var(--accent-green)]/90 transition-colors"
              >
                Open Session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
