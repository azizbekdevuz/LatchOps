'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import Link from 'next/link';
import { AlertTriangle, Link2, RefreshCw, CheckCircle, HelpCircle, XCircle } from 'lucide-react';

// Tab components
import OverviewTab from './tabs/OverviewTab';
import ConflictsTab from './tabs/ConflictsTab';
import PlanTab from './tabs/PlanTab';
import VerifyTab from './tabs/VerifyTab';
import TraceTab from './tabs/TraceTab';

type TabId = 'overview' | 'conflicts' | 'plan' | 'verify' | 'trace';

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
    conflictFiles: Array<{
      id: string;
      path: string;
      highLevelSummary: string | null;
      hunks: Array<{
        id: string;
        index: number;
        baseText: string;
        oursText: string;
        theirsText: string;
        explanation: string | null;
        suggestedChoice: string | null;
        userChoice: string | null;
      }>;
    }>;
    planSteps: Array<{
      id: string;
      index: number;
      title: string;
      rationale: string | null;
      commandsJson: string[];
      verifyJson: string[];
      undoJson: string[];
      dangerLevel: string;
      status: string;
    }>;
  } | null;
  traces: Array<{
    id: string;
    stage: string;
    inputJson: unknown;
    outputJson: unknown;
    durationMs: number | null;
    success: boolean;
    createdAt: string;
  }>;
}

export default function IncidentRoomPage() {
  const params = useParams();
  const sessionId = params.id as string;
  const { data: authSession } = useSession();

  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [sessionData, setSessionData] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchSession() {
      try {
        const res = await fetch(`/api/incident/${sessionId}`);
        if (!res.ok) {
          throw new Error('Failed to load session');
        }
        const data = await res.json();
        setSessionData(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load session');
      } finally {
        setLoading(false);
      }
    }

    fetchSession();
  }, [sessionId]);

  const tabs: { id: TabId; label: string; disabled?: boolean }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'conflicts', label: 'Conflicts', disabled: sessionData?.analysis?.issueType !== 'merge_conflict' },
    { id: 'plan', label: 'Plan & Undo' },
    { id: 'verify', label: 'Verify' },
    { id: 'trace', label: 'Trace' },
  ];

  const getIssueIcon = (issueType: string) => {
    switch (issueType) {
      case 'merge_conflict':
        return <AlertTriangle className="w-6 h-6 text-yellow-500" />;
      case 'detached_head':
        return <Link2 className="w-6 h-6 text-orange-500" />;
      case 'rebase_in_progress':
        return <RefreshCw className="w-6 h-6 text-blue-500" />;
      case 'clean':
        return <CheckCircle className="w-6 h-6 text-green-500" />;
      default:
        return <HelpCircle className="w-6 h-6 text-gray-500" />;
    }
  };

  const getStatusBadge = (status: string) => {
    const styles: Record<string, string> = {
      pending: 'bg-yellow-500/20 text-yellow-500',
      analyzing: 'bg-blue-500/20 text-blue-500',
      ready: 'bg-green-500/20 text-green-500',
      error: 'bg-red-500/20 text-red-500',
    };
    return styles[status] || 'bg-gray-500/20 text-gray-500';
  };

  if (loading) {
    return (
      <main className="min-h-screen bg-bg-primary">
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <div className="animate-spin w-8 h-8 border-2 border-accent-blue border-t-transparent rounded-full mx-auto mb-4"></div>
            <p className="text-text-secondary">Loading incident room...</p>
          </div>
        </div>
      </main>
    );
  }

  if (error || !sessionData) {
    return (
      <main className="min-h-screen bg-bg-primary">
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <XCircle className="w-12 h-12 mx-auto mb-4 text-red-500" />
            <h1 className="text-xl font-bold mb-2">Error Loading Session</h1>
            <p className="text-text-secondary mb-4">{error || 'Session not found'}</p>
            <Link href="/dashboard" className="text-accent-blue hover:underline">
              Back to Dashboard
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-bg-primary">
      {/* Header */}
      <header className="border-b border-border-color bg-bg-secondary sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Link
                href="/dashboard"
                className="text-xl font-bold bg-gradient-to-r from-accent-blue to-accent-purple bg-clip-text text-transparent"
              >
                LatchOps
              </Link>
              <span className="text-text-muted">/</span>
              <span className="text-text-secondary">Incident Room</span>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-text-muted">
                {authSession?.user?.name || authSession?.user?.email}
              </span>
              <button
                onClick={() => signOut({ callbackUrl: '/' })}
                className="px-3 py-1.5 text-sm rounded-md border border-border-color hover:bg-bg-tertiary"
              >
                Sign Out
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Session Info Bar */}
      <div className="border-b border-border-color bg-bg-secondary/50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-2xl">{getIssueIcon(sessionData.analysis?.issueType || 'unknown')}</span>
              <div>
                <h1 className="text-xl font-semibold">{sessionData.title}</h1>
                <p className="text-sm text-text-secondary">
                  {sessionData.snapshot.branch.head} • {sessionData.snapshot.platform} •{' '}
                  {new Date(sessionData.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusBadge(sessionData.status)}`}>
                {sessionData.status.charAt(0).toUpperCase() + sessionData.status.slice(1)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-border-color bg-bg-secondary/30">
        <div className="max-w-7xl mx-auto px-4">
          <nav className="flex gap-1">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => !tab.disabled && setActiveTab(tab.id)}
                disabled={tab.disabled}
                className={`px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-accent-blue text-accent-blue'
                    : tab.disabled
                    ? 'border-transparent text-text-muted cursor-not-allowed'
                    : 'border-transparent text-text-secondary hover:text-text-primary hover:border-border-color'
                }`}
              >
                {tab.label}
                {tab.id === 'conflicts' && sessionData.analysis?.conflictFiles?.length ? (
                  <span className="ml-2 px-1.5 py-0.5 text-xs bg-accent-red/20 text-accent-red rounded">
                    {sessionData.analysis.conflictFiles.length}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        </div>
      </div>

      {/* Tab Content */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'overview' && <OverviewTab sessionData={sessionData} />}
        {activeTab === 'conflicts' && <ConflictsTab sessionData={sessionData} />}
        {activeTab === 'plan' && <PlanTab sessionData={sessionData} />}
        {activeTab === 'verify' && <VerifyTab sessionData={sessionData} />}
        {activeTab === 'trace' && <TraceTab sessionData={sessionData} />}
      </div>
    </main>
  );
}
