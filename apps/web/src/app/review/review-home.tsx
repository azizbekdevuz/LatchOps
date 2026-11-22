'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Cpu, FileJson, FlaskConical, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { ActorSwitcher, api, statusClass, useActorToken, useReviewMeta, verdictClass } from './shared';

const FLOW = [
  { n: '01', title: 'Evidence', text: 'Deterministic snapshot, numbered items, secrets redacted, hashed.' },
  { n: '02', title: 'Grounded explanation', text: 'Local model, only with consent. Every claim cites evidence or is rejected.' },
  { n: '03', title: 'Explicit approval', text: 'A second person approves one engine alternative with a written reason.' },
  { n: '04', title: 'Isolated run', text: 'Plan commands only, in a throwaway repository. Never pushes.' },
];

export function ReviewHome() {
  const router = useRouter();
  const { meta, error } = useReviewMeta();
  const { token, setToken, actor } = useActorToken(meta?.actors);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [snapshotText, setSnapshotText] = useState('');

  async function create(body: Record<string, unknown>, key: string) {
    setBusy(key);
    setActionError(null);
    try {
      const { id } = await api<{ id: string }>('/api/review/incidents', token, { method: 'POST', body: JSON.stringify(body) });
      router.push(`/review/${id}`);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Failed');
      setBusy(null);
    }
  }

  async function importSnapshot() {
    try {
      await create({ snapshot: JSON.parse(snapshotText), title: 'CLI snapshot import' }, 'import');
    } catch (e) {
      if (e instanceof SyntaxError) setActionError('That is not valid JSON. Paste the output of `pnpm cli snapshot --pretty`.');
    }
  }

  const canCreate = actor?.role === 'requester' || actor?.role === 'approver';
  const repoScenarios = meta?.scenarios.filter((s) => s.category === 'repository') ?? [];
  const controlScenarios = meta?.scenarios.filter((s) => s.category === 'control') ?? [];

  return (
    <div className="relative overflow-hidden">
      <div className="aurora" aria-hidden="true" />
      <div className="absolute inset-0 bg-grid pointer-events-none" aria-hidden="true" />
      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-10 pb-20 space-y-10">
        <section className="space-y-5">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent-green flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-green pulse-dot" />
            Recovery Review · merge_conflict · local only
          </p>
          <h1 className="text-3xl sm:text-5xl font-semibold text-text-primary max-w-3xl leading-tight">
            Review the evidence before anyone touches the merge.
          </h1>
          <p className="text-text-secondary max-w-2xl">
            LatchOps captures a deterministic snapshot, a local model explains it only from cited evidence, and a second
            person approves one engine-generated alternative. Execution happens only in an isolated throwaway repository.
          </p>
          <div className="flex flex-wrap items-center gap-4 pt-2">
            {meta && <ActorSwitcher actors={meta.actors} token={token} onChange={setToken} demo={meta.demoActors} />}
          </div>
          {meta && (
            <div className="flex flex-wrap gap-2 text-xs">
              <span className={`badge ${meta.provider.reachable && meta.provider.modelPresent ? 'badge-green' : 'badge-yellow'} flex items-center gap-1.5`}>
                <Cpu className="w-3 h-3" />
                {meta.provider.reachable
                  ? meta.provider.modelPresent
                    ? `Ollama ${meta.provider.model} ready`
                    : `Ollama up, ${meta.provider.model} not pulled`
                  : 'Local model offline — explanations unavailable, review still works'}
              </span>
              <span className="badge badge-blue">{meta.provider.local ? 'model endpoint on this machine' : 'remote model endpoint'}</span>
            </div>
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FLOW.map((step) => (
            <div key={step.n} className="card !p-4 lift">
              <p className="font-mono text-[11px] text-accent-green">{step.n}</p>
              <h2 className="text-sm font-semibold text-text-primary mt-1">{step.title}</h2>
              <p className="text-xs text-text-secondary mt-1 leading-relaxed">{step.text}</p>
            </div>
          ))}
        </section>

        {(error || actionError) && (
          <div className="card !p-4 border-accent-red/40 text-sm text-accent-red flex items-center gap-2" role="alert">
            <ShieldAlert className="w-4 h-4" /> {error ?? actionError}
          </div>
        )}

        <section className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-text-primary flex items-center gap-2">
                <FlaskConical className="w-5 h-5 text-accent-blue" /> Reproducible scenarios
              </h2>
              <p className="text-xs text-text-secondary mt-1">
                Each scenario rebuilds a real conflicted Git repository in a temporary directory with fixed commit dates.
              </p>
            </div>
            {!canCreate && meta && <span className="text-xs text-accent-yellow">Switch to a requester or approver to open a review.</span>}
          </div>
          <ScenarioGrid scenarios={repoScenarios} busy={busy} disabled={!canCreate} onOpen={(id) => create({ scenarioId: id }, id)} />
          <h3 className="text-sm font-semibold text-text-secondary pt-2">Safety controls (approval, consent, tampering)</h3>
          <ScenarioGrid scenarios={controlScenarios} busy={busy} disabled={!canCreate} onOpen={(id) => create({ scenarioId: id }, id)} />
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="card space-y-3">
            <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <FileJson className="w-5 h-5 text-accent-purple" /> Import a CLI snapshot
            </h2>
            <p className="text-xs text-text-secondary">
              Run <code className="text-accent-green">pnpm cli snapshot --pretty --output snap.json</code> inside your own repository
              during a merge conflict and paste the file. Imported reviews are read-only: evidence, explanation and approval work, but
              nothing is ever executed against your repository.
            </p>
            <textarea
              value={snapshotText}
              onChange={(e) => setSnapshotText(e.target.value)}
              rows={6}
              placeholder='{"version":1, ...}'
              aria-label="Snapshot JSON"
              className="w-full bg-bg-tertiary border border-border-color rounded-lg p-3 font-mono text-xs text-text-primary"
            />
            <div className="flex items-center gap-3">
              <button type="button" className="btn" disabled={!canCreate || !snapshotText.trim() || busy !== null} onClick={importSnapshot}>
                {busy === 'import' ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileJson className="w-4 h-4" />}
                Import snapshot
              </button>
              <label className="text-xs text-text-secondary cursor-pointer hover:text-text-primary">
                or choose file
                <input
                  type="file"
                  accept="application/json,.json"
                  className="sr-only"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) setSnapshotText(await file.text());
                  }}
                />
              </label>
            </div>
          </div>

          <div className="card space-y-3">
            <h2 className="text-lg font-semibold text-text-primary flex items-center gap-2">
              <ShieldCheck className="w-5 h-5 text-accent-green" /> Recent reviews
            </h2>
            {meta?.reviews.length ? (
              <ul className="divide-y divide-border-color">
                {meta.reviews.map((review) => (
                  <li key={review.id}>
                    <Link
                      href={`/review/${review.id}`}
                      className="flex items-center justify-between gap-3 py-2.5 no-underline hover:no-underline group"
                    >
                      <span className="min-w-0">
                        <span className="block text-sm text-text-primary truncate group-hover:text-accent-green">{review.title}</span>
                        <span className="block text-[11px] text-text-muted font-mono">
                          {new Date(review.createdAt).toLocaleString()} · by {review.requestedBy} · {review.source}
                        </span>
                      </span>
                      <span className={`badge ${statusClass(review.status)} shrink-0`}>{review.status}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-text-muted">No reviews yet. Open a scenario above.</p>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function ScenarioGrid({
  scenarios,
  busy,
  disabled,
  onOpen,
}: {
  scenarios: Array<{ id: string; title: string; description: string; expectedVerdict: string; selectedAlternativeId: string }>;
  busy: string | null;
  disabled: boolean;
  onOpen: (id: string) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {scenarios.map((s) => (
        <button
          key={s.id}
          type="button"
          disabled={disabled || busy !== null}
          onClick={() => onOpen(s.id)}
          className="card !p-4 text-left lift disabled:opacity-60 disabled:cursor-not-allowed group"
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-xs text-accent-green">{s.id}</span>
            <span className={`badge ${verdictClass(s.expectedVerdict)} !text-[10px]`}>expected {s.expectedVerdict}</span>
          </div>
          <h4 className="text-sm font-semibold text-text-primary mt-2">{s.title}</h4>
          <p className="text-xs text-text-secondary mt-1 line-clamp-3">{s.description}</p>
          <div className="flex items-center justify-between mt-3 text-[11px] text-text-muted font-mono">
            <span>reviewer picks {s.selectedAlternativeId}</span>
            {busy === s.id ? (
              <Loader2 className="w-4 h-4 animate-spin text-accent-green" />
            ) : (
              <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
