'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2, ShieldAlert } from 'lucide-react';
import type { ReviewDetail } from '@/lib/review/service';
import { ActorSwitcher, api, statusClass, useActorToken, useReviewMeta } from '../shared';
import { AuditPanel, DecisionPanel, EvidencePanel, ExecutionPanel, ExplanationPanel, PlanPanel } from './panels';

const STEPS = [
  { key: 'evidence', label: 'Evidence' },
  { key: 'explanation', label: 'Explanation' },
  { key: 'decision', label: 'Decision' },
  { key: 'run', label: 'Isolated run' },
] as const;

function progress(detail: ReviewDetail): Record<(typeof STEPS)[number]['key'], 'done' | 'current' | 'todo' | 'blocked'> {
  const accepted = detail.explanations.some((e) => e.status === 'accepted');
  const decision = detail.decisions[0];
  const execution = detail.executions[0];
  return {
    evidence: 'done',
    explanation: accepted ? 'done' : decision ? 'todo' : 'current',
    decision: decision ? (decision.decision === 'approve' ? 'done' : 'blocked') : accepted ? 'current' : 'todo',
    run: execution ? (execution.verdict === 'VERIFIED' ? 'done' : 'blocked') : decision?.decision === 'approve' ? 'current' : 'todo',
  };
}

export function ReviewRoom({ id }: { id: string }) {
  const { meta } = useReviewMeta();
  const { token, setToken, actor } = useActorToken(meta?.actors);
  const [detail, setDetail] = useState<ReviewDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!token) return;
    try {
      setDetail(await api<ReviewDetail>(`/api/review/incidents/${id}`, token));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    }
  }, [id, token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const focusEvidence = useCallback((evidenceId: string) => {
    setHighlight(evidenceId);
    document.getElementById(`ev-${evidenceId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, []);

  const call = useCallback(
    async (path: string, body: unknown) => {
      await api(`/api/review/incidents/${id}/${path}`, token, { method: 'POST', body: JSON.stringify(body) });
      await reload();
    },
    [id, token, reload],
  );

  const steps = detail ? progress(detail) : null;

  return (
    <div className="relative">
      <div className="absolute inset-0 bg-grid pointer-events-none" aria-hidden="true" />
      <div className="relative max-w-[1400px] mx-auto px-4 sm:px-6 pt-6 pb-20 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/review" className="text-xs text-text-secondary hover:text-text-primary flex items-center gap-1 no-underline">
            <ArrowLeft className="w-3.5 h-3.5" /> All reviews
          </Link>
          {meta && <ActorSwitcher actors={meta.actors} token={token} onChange={setToken} demo={meta.demoActors} />}
        </div>

        {error && (
          <div className="card !p-4 text-sm text-accent-red flex items-center gap-2" role="alert">
            <ShieldAlert className="w-4 h-4" /> {error}
          </div>
        )}

        {!detail ? (
          <div className="flex items-center gap-2 text-text-secondary text-sm py-20 justify-center">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading review…
          </div>
        ) : (
          <>
            <header className="space-y-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="badge badge-red">{detail.incident.incidentType}</span>
                <span className={`badge ${statusClass(detail.incident.status)}`}>{detail.incident.status}</span>
                <span className="badge badge-blue">{detail.incident.source === 'scenario' ? 'isolated fixture repository' : 'CLI import · read-only'}</span>
                <span className="text-text-muted font-mono">requested by {detail.incident.requestedBy}</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-semibold text-text-primary">{detail.incident.title}</h1>
              {steps && (
                <ol className="flex flex-wrap gap-2" aria-label="Review progress">
                  {STEPS.map((step, index) => {
                    const state = steps[step.key];
                    const style =
                      state === 'done'
                        ? 'border-accent-green/60 text-accent-green'
                        : state === 'current'
                          ? 'border-accent-blue text-text-primary'
                          : state === 'blocked'
                            ? 'border-accent-yellow/60 text-accent-yellow'
                            : 'border-border-color text-text-muted';
                    return (
                      <li key={step.key} className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-mono ${style}`}>
                        <span>{String(index + 1).padStart(2, '0')}</span>
                        {step.label}
                      </li>
                    );
                  })}
                </ol>
              )}
            </header>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
              <div className="space-y-6 xl:sticky xl:top-20 xl:self-start xl:max-h-[calc(100vh-6rem)] xl:overflow-y-auto pr-1">
                <EvidencePanel detail={detail} highlight={highlight} />
              </div>
              <div className="space-y-6">
                <ExplanationPanel detail={detail} actor={actor} meta={meta} onCall={call} onCite={focusEvidence} />
                <PlanPanel detail={detail} />
                <DecisionPanel detail={detail} actor={actor} onCall={call} />
                <ExecutionPanel detail={detail} actor={actor} onCall={call} />
                <AuditPanel detail={detail} />
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
