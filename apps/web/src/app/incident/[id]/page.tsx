'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { signOut, useSession } from 'next-auth/react';
import Link from 'next/link';
import { AlertTriangle, Link2, RefreshCw, CheckCircle, HelpCircle, XCircle, FileEdit } from 'lucide-react';

import OverviewTab from './tabs/OverviewTab';
import ConflictsTab from './tabs/ConflictsTab';
import PlanTab from './tabs/PlanTab';
import VerifyTab from './tabs/VerifyTab';
import TraceTab from './tabs/TraceTab';
import type { IncidentData } from './incident-data';

type TabId = 'overview' | 'conflicts' | 'plan' | 'verify' | 'trace';

export default function IncidentRoomPage() {
  const params = useParams();
  const sessionId = params.id as string;
  const { data: authSession } = useSession();

  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [data, setData] = useState<IncidentData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchIncident() {
      try {
        const res = await fetch(`/api/incident/${sessionId}`);
        if (!res.ok) throw new Error('Failed to load incident');
        setData(await res.json());
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load incident');
      } finally {
        setLoading(false);
      }
    }
    fetchIncident();
  }, [sessionId]);

  const hasConflicts = (data?.conflicts?.length ?? 0) > 0;

  const tabs: { id: TabId; label: string; disabled?: boolean }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'conflicts', label: 'Conflicts', disabled: !hasConflicts },
    { id: 'plan', label: 'Recovery Plan' },
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
      case 'dirty_worktree':
        return <FileEdit className="w-6 h-6 text-amber-500" />;
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
      detected: 'bg-yellow-500/20 text-yellow-500',
      triaged: 'bg-blue-500/20 text-blue-500',
      plan_ready: 'bg-green-500/20 text-green-500',
      recovery_in_progress: 'bg-blue-500/20 text-blue-500',
      verification_pending: 'bg-amber-500/20 text-amber-500',
      resolved: 'bg-green-500/20 text-green-500',
      dismissed: 'bg-gray-500/20 text-gray-500',
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

  if (error || !data) {
    return (
      <main className="min-h-screen bg-bg-primary">
        <div className="flex items-center justify-center h-screen">
          <div className="text-center">
            <XCircle className="w-12 h-12 mx-auto mb-4 text-red-500" />
            <h1 className="text-xl font-bold mb-2">Error Loading Incident</h1>
            <p className="text-text-secondary mb-4">{error || 'Incident not found'}</p>
            <Link href="/dashboard" className="text-accent-blue hover:underline">
              Back to Dashboard
            </Link>
          </div>
        </div>
      </main>
    );
  }

  const incidentLabel = data.incidentType.replace(/_/g, ' ');

  return (
    <main className="min-h-screen bg-bg-primary">
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

      <div className="border-b border-border-color bg-bg-secondary/50">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="text-2xl">{getIssueIcon(data.incidentType)}</span>
              <div>
                <h1 className="text-xl font-semibold">{data.title || 'Git Incident'}</h1>
                <p className="text-sm text-text-secondary capitalize">
                  {incidentLabel}
                  {data.branch.name ? ` • ${data.branch.name}` : data.branch.isDetached ? ' • detached HEAD' : ''}
                  {' • '}
                  {new Date(data.createdAt).toLocaleString()}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {data.risk && (
                <span className="px-3 py-1 rounded-full text-xs font-medium bg-bg-tertiary border border-border-color capitalize">
                  Risk: {data.risk}
                </span>
              )}
              <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusBadge(data.status)}`}>
                {data.status.charAt(0).toUpperCase() + data.status.slice(1)}
              </span>
            </div>
          </div>
        </div>
      </div>

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
                {tab.id === 'conflicts' && data.conflicts.length ? (
                  <span className="ml-2 px-1.5 py-0.5 text-xs bg-accent-red/20 text-accent-red rounded">
                    {data.conflicts.length}
                  </span>
                ) : null}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {activeTab === 'overview' && <OverviewTab data={data} />}
        {activeTab === 'conflicts' && <ConflictsTab data={data} />}
        {activeTab === 'plan' && <PlanTab data={data} />}
        {activeTab === 'verify' && <VerifyTab data={data} />}
        {activeTab === 'trace' && <TraceTab data={data} />}
      </div>
    </main>
  );
}
