'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Box,
  CheckCircle2,
  Loader2,
  ShieldCheck,
  Sparkles,
  XCircle,
} from 'lucide-react';
import type { PreviewResult, ProofResult, ProofStageId, SponsorRuntimeStatus } from '@/lib/hacksprint/types';

const STAGES: Array<{ id: ProofStageId; label: string; hint: string }> = [
  { id: 'broken', label: 'BROKEN', hint: 'Initial Git evidence' },
  { id: 'plan', label: 'PLAN', hint: 'Deterministic LatchOps' },
  { id: 'sandbox', label: 'SANDBOX', hint: 'Isolated execution' },
  { id: 'proof', label: 'PROOF', hint: 'Before / after checks' },
  { id: 'explain', label: 'EXPLAIN', hint: 'Nosana, not the judge' },
];

type StageState = 'idle' | 'ready' | 'running' | 'done' | 'error';

function sponsorClass(status: SponsorRuntimeStatus | 'configured' | 'missing'): string {
  if (status === 'live') return 'badge-green';
  if (status === 'configured') return 'badge-blue';
  if (status === 'unavailable' || status === 'error') return 'badge-yellow';
  return 'badge-red';
}

function sponsorLabel(kind: 'Daytona' | 'Nosana', status: SponsorRuntimeStatus | 'configured' | 'missing'): string {
  if (status === 'live') return `${kind} live`;
  if (status === 'configured') return `${kind} configured`;
  if (status === 'unavailable') return `${kind} unavailable`;
  if (status === 'error') return `${kind} error`;
  return `${kind} not configured`;
}

export function HacksprintClient() {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [result, setResult] = useState<ProofResult | null>(null);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [active, setActive] = useState<ProofStageId>('broken');

  useEffect(() => {
    const access = readDemoAccess();
    let cancelled = false;
    fetch('/api/hacksprint/preview', {
      headers: access ? { 'x-hacksprint-access': access } : undefined,
    })
      .then(async (response) => {
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || 'Preview failed');
        if (!cancelled) setPreview(json as PreviewResult);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setPreviewError(error instanceof Error ? error.message : 'Preview failed');
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function prove() {
    setRunning(true);
    setRunError(null);
    setResult(null);
    setActive('sandbox');
    try {
      const access = readDemoAccess();
      const response = await fetch('/api/hacksprint/prove', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(access ? { 'x-hacksprint-access': access } : {}),
        },
        body: JSON.stringify({ scenarioId: 'merge_conflict_demo' }),
      });
      const json = await response.json();
      if (!response.ok) throw new Error(json.error || 'Proof failed');
      setResult(json as ProofResult);
      setActive('proof');
    } catch (error) {
      setRunError(error instanceof Error ? error.message : 'Proof failed');
    } finally {
      setRunning(false);
    }
  }

  const broken = result?.broken ?? preview?.broken ?? null;
  const plan = result?.plan ?? preview?.plan ?? null;
  const recommended = plan?.alternatives.find((alt) => alt.recommended) ?? plan?.alternatives[0];

  const stageState = useMemo(() => {
    const map: Record<ProofStageId, StageState> = {
      broken: broken ? 'ready' : previewError ? 'error' : 'running',
      plan: plan ? 'ready' : previewError ? 'error' : 'running',
      sandbox: result ? 'done' : running ? 'running' : 'idle',
      proof: result ? 'done' : running ? 'running' : 'idle',
      explain: result ? 'done' : running ? 'running' : 'idle',
    };
    return map;
  }, [broken, plan, previewError, result, running]);

  const daytonaStatus = result?.daytona.status ?? preview?.daytona.status ?? 'missing';
  const nosanaStatus = result?.nosana.status ?? preview?.nosana.status ?? 'missing';

  return (
    <div className="relative overflow-hidden">
      <div className="aurora" aria-hidden="true" />
      <div className="absolute inset-0 bg-grid pointer-events-none" aria-hidden="true" />

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-20">
        <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent-green mb-4 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent-green pulse-dot" />
          Daytona HackSprint Seoul · Recovery Proof
        </p>
        <div className="flex flex-col lg:flex-row lg:items-end gap-6 justify-between">
          <div className="max-w-3xl">
            <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-text-primary leading-tight">
              Prove the recovery
              <br />
              <span className="text-accent-green">before it touches the repo.</span>
            </h1>
            <p className="mt-5 text-text-secondary leading-relaxed max-w-2xl">
              Nosana explains. Daytona isolates. LatchOps proves. The plan and the
              VERIFIED / FAILED verdict are deterministic — an LLM never authors Git
              commands or decides the result.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className={`badge ${sponsorClass(daytonaStatus)}`}>
              {sponsorLabel('Daytona', daytonaStatus)}
            </span>
            <span className={`badge ${sponsorClass(nosanaStatus)}`}>
              {sponsorLabel('Nosana', nosanaStatus)}
            </span>
          </div>
        </div>

        <ol className="mt-10 grid grid-cols-2 lg:grid-cols-5 gap-px bg-border-color rounded-xl overflow-hidden border border-border-color">
          {STAGES.map((stage) => {
            const state = stageState[stage.id];
            const selected = active === stage.id;
            return (
              <li key={stage.id}>
                <button
                  type="button"
                  onClick={() => setActive(stage.id)}
                  className={`w-full h-full text-left bg-bg-secondary px-4 py-4 transition-colors ${
                    selected ? 'bg-bg-tertiary' : 'hover:bg-bg-tertiary/70'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-[11px] tracking-[0.18em] text-text-muted">
                      {stage.label}
                    </span>
                    <StageDot state={state} />
                  </div>
                  <p className="mt-2 text-sm text-text-secondary">{stage.hint}</p>
                </button>
              </li>
            );
          })}
        </ol>

        <div className="mt-8 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={prove}
            disabled={running || !plan}
            className="btn btn-primary px-6 py-3 text-base disabled:opacity-60"
          >
            {running ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Proving in isolation…
              </>
            ) : (
              <>
                <ShieldCheck className="w-4 h-4" />
                Prove recovery
              </>
            )}
          </button>
          {result && (
            <VerdictStamp verdict={result.verdict} />
          )}
          {runError && <p className="text-sm text-accent-red">{runError}</p>}
        </div>

        <div className="mt-8 grid lg:grid-cols-12 gap-6">
          <section className="lg:col-span-7 min-w-0 space-y-6">
            {active === 'broken' && (
              <BrokenPanel broken={broken} loading={!broken && !previewError} error={previewError} />
            )}
            {active === 'plan' && <PlanPanel plan={plan} recommendedTitle={recommended?.title} />}
            {active === 'sandbox' && <SandboxPanel result={result} running={running} isolationHint={preview} />}
            {active === 'proof' && <ProofPanel result={result} running={running} />}
            {active === 'explain' && <ExplainPanel result={result} running={running} />}
          </section>

          <aside className="lg:col-span-5 min-w-0 space-y-6">
            <div className="card min-w-0">
              <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
                Reproducible demo incident
              </p>
              <h2 className="font-display text-lg font-semibold mt-2">Incident brief</h2>
              <h3 className="font-display text-base font-semibold mt-2 min-w-0 break-words">
                {preview?.title ??
                  'Checkout service — release blocked by deployment configuration conflict.'}
              </h3>
              <p className="mt-3 text-sm text-text-secondary leading-relaxed">
                {preview?.description ??
                  'A fictional engineering team is merging a release branch into main before deploying its checkout API. Two branches independently changed deploy.env. Not a production incident.'}
              </p>
              {preview?.previewNote && (
                <p className="mt-3 text-xs text-text-muted leading-relaxed">{preview.previewNote}</p>
              )}
            </div>
            {result && (
              <div className="card">
                <h2 className="font-display text-lg font-semibold">Sponsor proof</h2>
                <dl className="mt-4 space-y-3 text-sm">
                  <div>
                    <dt className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">Daytona</dt>
                    <dd className="text-text-secondary mt-1">
                      {result.daytona.sandboxId
                        ? `Sandbox ${result.daytona.sandboxId}`
                        : result.daytona.message}
                      {result.daytona.cleanedUp ? ' · cleaned up' : ''}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">Nosana</dt>
                    <dd className="text-text-secondary mt-1">
                      {result.nosana.model
                        ? `Model ${result.nosana.model}`
                        : result.nosana.message}
                    </dd>
                  </div>
                  <div>
                    <dt className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">Isolation</dt>
                    <dd className="text-text-secondary mt-1">{result.isolation}</dd>
                  </div>
                </dl>
              </div>
            )}
          </aside>
        </div>
      </div>
    </div>
  );
}

function readDemoAccess(): string {
  if (typeof window === 'undefined') return '';
  const url = new URL(window.location.href);
  const fromQuery = url.searchParams.get('access')?.trim();
  if (fromQuery) {
    sessionStorage.setItem('hacksprint-access', fromQuery);
    url.searchParams.delete('access');
    const next = `${url.pathname}${url.search}${url.hash}`;
    window.history.replaceState({}, '', next);
    return fromQuery;
  }
  return sessionStorage.getItem('hacksprint-access')?.trim() ?? '';
}

function StageDot({ state }: { state: StageState }) {
  if (state === 'running') return <Loader2 className="w-3.5 h-3.5 text-accent-blue animate-spin" />;
  if (state === 'ready' || state === 'done') return <CheckCircle2 className="w-3.5 h-3.5 text-accent-green" />;
  if (state === 'error') return <XCircle className="w-3.5 h-3.5 text-accent-red" />;
  return <span className="w-2 h-2 rounded-full bg-border-strong inline-block" />;
}

function VerdictStamp({ verdict }: { verdict: 'VERIFIED' | 'FAILED' }) {
  const ok = verdict === 'VERIFIED';
  return (
    <div
      className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2 font-display text-xl tracking-wide ${
        ok
          ? 'border-accent-green/40 text-accent-green bg-accent-green/10'
          : 'border-accent-red/40 text-accent-red bg-accent-red/10'
      }`}
    >
      {ok ? <CheckCircle2 className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
      {verdict}
    </div>
  );
}

function BrokenPanel({
  broken,
  loading,
  error,
}: {
  broken: PreviewResult['broken'] | null;
  loading: boolean;
  error: string | null;
}) {
  if (loading) return <PanelLoading label="Capturing broken Git state…" />;
  if (error) return <p className="text-accent-red">{error}</p>;
  if (!broken) return null;
  return (
    <div className="card space-y-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-6 h-6 text-accent-yellow mt-0.5" />
        <div>
          <h2 className="font-display text-2xl font-semibold text-accent-yellow">Broken</h2>
          <p className="text-sm text-text-secondary mt-1">
            {broken.incidentType} on {broken.branch ?? 'unknown branch'}
            {broken.mergeActive ? ' · MERGE_HEAD present' : ''}
          </p>
        </div>
      </div>
      <ul className="text-sm text-text-secondary space-y-1">
        {broken.reasons.map((reason) => (
          <li key={reason}>· {reason}</li>
        ))}
        <li>· conflicted: {broken.conflictedPaths.join(', ') || 'none'}</li>
      </ul>
      {broken.conflict && (
        <div className="grid sm:grid-cols-2 gap-3">
          <ConflictBlock title="ours (main)" text={broken.conflict.ours} />
          <ConflictBlock title="theirs (release)" text={broken.conflict.theirs} />
        </div>
      )}
      <pre className="text-xs max-h-48 overflow-auto">{broken.rawStatus}</pre>
    </div>
  );
}

function ConflictBlock({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-lg border border-border-color bg-bg-primary p-3">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted mb-2">{title}</p>
      <pre className="text-xs !border-0 !bg-transparent p-0 min-w-0 whitespace-pre-wrap break-words">{text}</pre>
    </div>
  );
}

function PlanPanel({
  plan,
  recommendedTitle,
}: {
  plan: PreviewResult['plan'] | null;
  recommendedTitle?: string;
}) {
  if (!plan) return <PanelLoading label="Generating deterministic recovery plan…" />;
  const alternative = plan.alternatives.find((alt) => alt.recommended) ?? plan.alternatives[0];
  const steps = [...plan.steps, ...(alternative?.steps ?? [])];
  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-display text-2xl font-semibold">LatchOps plan</h2>
        <p className="text-sm text-text-secondary mt-1">{plan.summary}</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <span className="badge badge-green">generatedBy {plan.generatedBy}</span>
          <span className="badge badge-blue">risk {plan.risk}</span>
          {recommendedTitle && <span className="badge badge-yellow">recommended {recommendedTitle}</span>}
        </div>
      </div>
      <ol className="space-y-3">
        {steps.map((step) => (
          <li key={step.id} className="rounded-lg border border-border-color p-3">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium">{step.title}</p>
              <span className="font-mono text-[10px] uppercase text-text-muted">
                {step.destructive ? 'destructive' : step.commands.every((cmd) => cmd.readOnly) ? 'read-only' : 'action'}
              </span>
            </div>
            <p className="text-sm text-text-secondary mt-1">{step.description}</p>
            <div className="mt-2 space-y-1">
              {step.commands.map((cmd) => (
                <code key={cmd.display} className="block text-xs text-accent-green">
                  {cmd.display}
                </code>
              ))}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function SandboxPanel({
  result,
  running,
  isolationHint,
}: {
  result: ProofResult | null;
  running: boolean;
  isolationHint: PreviewResult | null;
}) {
  if (!result && running) {
    return (
      <PanelLoading
        label={
          isolationHint?.daytona.status === 'configured'
            ? 'Creating disposable Daytona sandbox…'
            : 'Creating isolated local workspace…'
        }
      />
    );
  }
  if (!result) {
    return (
      <div className="card text-text-secondary text-sm">
        Click <strong className="text-text-primary">Prove recovery</strong> to execute the plan in
        isolation. Daytona is used only when a real sandbox is created.
      </div>
    );
  }
  return (
    <div className="card space-y-4">
      <div className="flex items-start gap-3">
        <Box className="w-6 h-6 text-accent-blue mt-0.5" />
        <div>
          <h2 className="font-display text-2xl font-semibold">Sandbox</h2>
          <p className="text-sm text-text-secondary mt-1">{result.daytona.message}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-text-muted font-mono text-[11px] uppercase tracking-[0.14em]">
              <th className="pb-2">Command</th>
              <th className="pb-2">Exit</th>
              <th className="pb-2">ms</th>
              <th className="pb-2">Source</th>
            </tr>
          </thead>
          <tbody>
            {result.execution.map((row, index) => (
              <tr key={`${row.display}-${index}`} className="border-t border-border-color">
                <td className="py-2 pr-3 font-mono text-xs">{row.display}</td>
                <td className={row.exitCode === 0 ? 'text-accent-green' : 'text-accent-red'}>{row.exitCode}</td>
                <td className="text-text-muted">{row.durationMs}</td>
                <td className="text-text-muted">{row.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ProofPanel({ result, running }: { result: ProofResult | null; running: boolean }) {
  if (!result && running) return <PanelLoading label="Running deterministic verification…" />;
  if (!result) return <div className="card text-sm text-text-secondary">Proof appears after isolated execution.</div>;
  return (
    <div className="card space-y-4 min-w-0 overflow-hidden">
      <div className="flex items-center justify-between gap-4">
        <h2 className="font-display text-2xl font-semibold">Proof</h2>
        <VerdictStamp verdict={result.verdict} />
      </div>
      <p className="text-sm text-text-secondary">{result.verdictReasons.join(' ')}</p>
      <div className="grid sm:grid-cols-2 gap-3 text-sm min-w-0">
        <div className="rounded-lg border border-border-color p-3 min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">Before</p>
          <p className="mt-2">{result.signalsBefore.state}</p>
          <p className="text-text-secondary">merge: {String(result.signalsBefore.operations.merge)}</p>
          <p className="text-text-secondary">conflicted: {result.signalsBefore.worktree.conflicted}</p>
        </div>
        <div className="rounded-lg border border-border-color p-3 min-w-0">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">After</p>
          <p className="mt-2">{result.signalsAfter?.state ?? 'n/a'}</p>
          <p className="text-text-secondary">merge: {String(result.signalsAfter?.operations.merge ?? 'n/a')}</p>
          <p className="text-text-secondary">conflicted: {result.signalsAfter?.worktree.conflicted ?? 'n/a'}</p>
        </div>
      </div>
      {result.changedSignals.length > 0 && (
        <div className="min-w-0 overflow-x-auto">
          <table className="w-full table-fixed text-sm">
            <colgroup>
              <col className="w-[28%]" />
              <col className="w-[36%]" />
              <col className="w-[36%]" />
            </colgroup>
            <thead>
              <tr className="text-left text-text-muted font-mono text-[11px] uppercase">
                <th className="pb-2 pr-2">Signal</th>
                <th className="pb-2 pr-2">Before</th>
                <th className="pb-2">After</th>
              </tr>
            </thead>
            <tbody>
              {result.changedSignals.map((change) => (
                <tr key={change.field} className="border-t border-border-color">
                  <td className="max-w-0 overflow-hidden py-2 pr-2 font-mono text-xs">
                    <HashCell value={change.field} />
                  </td>
                  <td className="max-w-0 overflow-hidden py-2 pr-2 text-text-secondary">
                    <HashCell value={change.before} />
                  </td>
                  <td className="max-w-0 overflow-hidden py-2 text-accent-green">
                    <HashCell value={change.after} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExplainPanel({ result, running }: { result: ProofResult | null; running: boolean }) {
  if (!result && running) return <PanelLoading label="Asking Nosana to explain evidence…" />;
  if (!result) return <div className="card text-sm text-text-secondary">Explanation is optional and never authoritative.</div>;
  if (!result.explanation) {
    return (
      <div className="card space-y-3">
        <h2 className="font-display text-2xl font-semibold">Nosana unavailable</h2>
        <p className="text-sm text-text-secondary">{result.nosana.message}</p>
        <p className="text-sm text-text-muted">
          The deterministic proof above is still the source of truth.
        </p>
      </div>
    );
  }
  return (
    <div className="card space-y-4">
      <div className="flex items-start gap-3">
        <Sparkles className="w-6 h-6 text-accent-purple mt-0.5" />
        <div>
          <h2 className="font-display text-2xl font-semibold">Explanation</h2>
          <p className="text-sm text-text-muted mt-1">
            Nosana · {result.nosana.model} · does not control the verdict
          </p>
        </div>
      </div>
      <p className="text-sm"><span className="text-text-muted">Broken · </span>{result.explanation.whatWasBroken}</p>
      <p className="text-sm"><span className="text-text-muted">Attempted · </span>{result.explanation.whatWasAttempted}</p>
      <p className="text-sm"><span className="text-text-muted">Why it matters · </span>{result.explanation.whyItMatters}</p>
      {result.explanation.checksPassed.length > 0 && (
        <ul className="text-sm text-accent-green space-y-1">
          {result.explanation.checksPassed.map((item) => (
            <li key={item}>✓ {item}</li>
          ))}
        </ul>
      )}
      {result.explanation.checksFailed.length > 0 && (
        <ul className="text-sm text-accent-red space-y-1">
          {result.explanation.checksFailed.map((item) => (
            <li key={item}>✕ {item}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function HashCell({ value }: { value: unknown }) {
  const text = value === null || value === undefined ? '—' : String(value);
  return (
    <span className="block overflow-hidden text-ellipsis whitespace-nowrap font-mono text-xs" title={text}>
      {text}
    </span>
  );
}

function PanelLoading({ label }: { label: string }) {
  return (
    <div className="card flex items-center gap-3 text-text-secondary">
      <Loader2 className="w-4 h-4 animate-spin text-accent-green" />
      {label}
    </div>
  );
}
