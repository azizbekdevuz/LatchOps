import Link from 'next/link';
import { Header } from '@/components/Header';
import { Reveal } from '@/components/Reveal';

const CAPABILITIES = [
  {
    index: '01',
    title: 'Repository state incidents',
    body: 'Merge conflicts, detached HEAD, and rebase-in-progress classified from deterministic signals — porcelain status, reflog, branch topology.',
    signal: 'classifier',
  },
  {
    index: '02',
    title: 'AI-generated change risk',
    body: 'Risky commits and unmerged files surfaced before they reach a protected branch, with issue type and risk level attached.',
    signal: 'risk engine',
  },
  {
    index: '03',
    title: 'Recovery tree',
    body: 'A step-by-step rollback path grounded in reflog history. Every node is a concrete git command, not a vague suggestion.',
    signal: 'planner',
  },
  {
    index: '04',
    title: 'Safe rollback path',
    body: 'No destructive defaults. reset --hard and force-push stay gated; each step ships with its explicit undo command.',
    signal: 'verifier',
  },
];

const STEPS = [
  {
    step: '1',
    title: 'Capture',
    body: 'Run the CLI in your repository. Read-only diagnostics — status, reflog, conflicts — become a validated snapshot.',
    code: 'latchops send --open',
  },
  {
    step: '2',
    title: 'Diagnose',
    body: 'The state engine classifies the incident and builds a recovery tree from the snapshot signals.',
    code: 'incident: merge_conflict',
  },
  {
    step: '3',
    title: 'Recover',
    body: 'Execute the rollback path in the incident room. Verify progress with a fresh snapshot at any point.',
    code: 'undo: git reflog → reset',
  },
];

const DESIGN_ROWS = [
  { layer: 'Snapshot schema', deterministic: 'Zod validation', llm: '—' },
  { layer: 'Signal extraction', deterministic: 'Rules on status, reflog, conflicts', llm: '—' },
  { layer: 'Classification', deterministic: 'Rule-based + schema', llm: 'Optional tie-break' },
  { layer: 'Plan structure', deterministic: 'Fixed step / undo schema', llm: 'Wording only' },
  { layer: 'Verification', deterministic: 'Signal diff vs plan', llm: 'Progress narrative' },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-bg-primary">
      <Header />

      {/* ============ Hero ============ */}
      <section className="relative overflow-hidden">
        <div className="aurora" aria-hidden="true" />
        <div className="absolute inset-0 bg-grid pointer-events-none" aria-hidden="true" />

        <div className="relative max-w-7xl mx-auto px-6 pt-20 pb-24 lg:pt-28 lg:pb-32">
          <div className="grid lg:grid-cols-12 gap-12 items-center">
            {/* Copy */}
            <div className="lg:col-span-6">
              <Reveal>
                <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent-green mb-6 flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-accent-green pulse-dot" />
                  Deterministic recovery · Explicit undo paths
                </p>
              </Reveal>

              <Reveal delay={80}>
                <h1 className="font-display text-[2.6rem] leading-[1.05] sm:text-6xl lg:text-[4.2rem] font-bold tracking-tight text-text-primary">
                  When AI breaks
                  <br />
                  your repo,
                  <br />
                  <span className="text-accent-green">latch back.</span>
                </h1>
              </Reveal>

              <Reveal delay={160}>
                <p className="mt-7 text-lg text-text-secondary max-w-xl leading-relaxed">
                  LatchOps is the safety layer for teams shipping with Cursor, Claude Code,
                  Copilot, and autonomous agents. It detects dangerous repository states and
                  produces deterministic recovery plans — every step reversible via{' '}
                  <code className="text-accent-green text-[0.95em] bg-transparent">git reflog</code>.
                </p>
              </Reveal>

              <Reveal delay={240}>
                <div className="mt-9 flex flex-wrap items-center gap-4">
                  <Link
                    href="/auth/signup"
                    className="btn btn-primary px-7 py-3 text-base no-underline hover:no-underline"
                  >
                    Open incident room
                  </Link>
                  <a
                    href="#how-it-works"
                    className="btn px-7 py-3 text-base no-underline hover:no-underline"
                  >
                    See the workflow
                  </a>
                </div>
              </Reveal>
            </div>

            {/* Terminal */}
            <div className="lg:col-span-6">
              <Reveal delay={200}>
                <div className="lift relative rounded-xl border border-border-color bg-bg-secondary/90 backdrop-blur shadow-[0_30px_80px_-30px_rgba(0,0,0,0.8)]">
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-border-color">
                    <span className="w-2.5 h-2.5 rounded-full bg-accent-red/70" />
                    <span className="w-2.5 h-2.5 rounded-full bg-accent-yellow/70" />
                    <span className="w-2.5 h-2.5 rounded-full bg-accent-green/70" />
                    <span className="ml-3 font-mono text-xs text-text-muted">latchops — zsh</span>
                  </div>
                  <pre className="!bg-transparent !border-0 p-6 text-[13px] leading-relaxed overflow-x-auto">
                    <code>
                      <span className="text-text-muted">$</span>{' '}
                      <span className="text-text-primary">latchops send --open</span>
                      {'\n'}
                      <span className="text-text-muted">→ capturing read-only diagnostics…</span>
                      {'\n\n'}
                      <span className="text-accent-yellow">incident</span>
                      <span className="text-text-muted">  merge_conflict · 3 files unmerged</span>
                      {'\n'}
                      <span className="text-accent-green">recovery</span>
                      <span className="text-text-muted">  tree ready · 5 steps · all reversible</span>
                      {'\n'}
                      <span className="text-accent-blue">room</span>
                      <span className="text-text-muted">      http://localhost:3000/incident/…</span>
                      {'\n\n'}
                      <span className="text-text-muted">$</span> <span className="caret" />
                    </code>
                  </pre>
                </div>
              </Reveal>
            </div>
          </div>
        </div>
      </section>

      <div className="hairline" />

      {/* ============ Capabilities — editorial ledger ============ */}
      <section id="capabilities" className="relative">
        <div className="max-w-7xl mx-auto px-6 py-24">
          <div className="grid lg:grid-cols-12 gap-12">
            <div className="lg:col-span-4">
              <Reveal>
                <p className="font-mono text-xs uppercase tracking-[0.25em] text-text-muted mb-4">
                  Capabilities
                </p>
                <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-text-primary leading-tight">
                  Rollback
                  <br />
                  infrastructure,
                  <br />
                  not a Git GUI.
                </h2>
                <p className="mt-5 text-text-secondary leading-relaxed">
                  Production-branch protection for AI-assisted development. Each capability maps
                  to a stage in the state engine.
                </p>
              </Reveal>
            </div>

            <div className="lg:col-span-8">
              <ul className="divide-y divide-border-color border-y border-border-color">
                {CAPABILITIES.map((cap, i) => (
                  <Reveal key={cap.index} delay={i * 90} as="li">
                    <div className="group grid sm:grid-cols-12 gap-3 sm:gap-6 py-7 px-2 sm:items-baseline transition-colors duration-300 hover:bg-bg-secondary/60 rounded-lg">
                      <span className="sm:col-span-1 font-mono text-sm text-accent-green/70 group-hover:text-accent-green transition-colors">
                        {cap.index}
                      </span>
                      <div className="sm:col-span-8">
                        <h3 className="font-display text-lg font-semibold text-text-primary mb-1.5">
                          {cap.title}
                        </h3>
                        <p className="text-sm text-text-secondary leading-relaxed">{cap.body}</p>
                      </div>
                      <span className="sm:col-span-3 sm:text-right font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted group-hover:text-accent-blue transition-colors">
                        {cap.signal}
                      </span>
                    </div>
                  </Reveal>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <div className="hairline" />

      {/* ============ How it works — rail ============ */}
      <section id="how-it-works" className="relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-6 py-24">
          <Reveal>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-text-muted mb-4 text-center">
              Workflow
            </p>
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-text-primary text-center">
              Capture → Diagnose → Recover
            </h2>
            <p className="mt-4 text-text-secondary text-center max-w-xl mx-auto">
              Full traceability from terminal to incident room.
            </p>
          </Reveal>

          <div className="mt-16 grid md:grid-cols-3 gap-px bg-border-color rounded-xl overflow-hidden border border-border-color">
            {STEPS.map((s, i) => (
              <Reveal key={s.step} delay={i * 120}>
                <div className="h-full bg-bg-secondary p-8 flex flex-col gap-4 transition-colors duration-300 hover:bg-bg-tertiary/70">
                  <div className="flex items-center justify-between">
                    <span className="font-display text-5xl font-bold text-border-strong select-none">
                      {s.step}
                    </span>
                    <span className="font-mono text-[11px] text-accent-green border border-accent-green/25 rounded-full px-3 py-1 bg-accent-green/5">
                      {s.code}
                    </span>
                  </div>
                  <h3 className="font-display text-xl font-semibold text-text-primary">{s.title}</h3>
                  <p className="text-sm text-text-secondary leading-relaxed">{s.body}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      <div className="hairline" />

      {/* ============ Deterministic-first ============ */}
      <section className="relative">
        <div className="max-w-5xl mx-auto px-6 py-24">
          <Reveal>
            <p className="font-mono text-xs uppercase tracking-[0.25em] text-text-muted mb-4">
              State engine
            </p>
            <h2 className="font-display text-3xl sm:text-4xl font-bold tracking-tight text-text-primary">
              Deterministic first. LLM where it adds clarity.
            </h2>
            <p className="mt-4 text-text-secondary max-w-2xl leading-relaxed">
              Git diagnostics and risk classification run before any model call. Plans are
              structured, schema-validated, and auditable in the incident room.
            </p>
          </Reveal>

          <Reveal delay={140}>
            <div className="mt-10 overflow-x-auto rounded-xl border border-border-color">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-bg-secondary text-left">
                    <th className="px-5 py-3.5 font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted font-medium">Layer</th>
                    <th className="px-5 py-3.5 font-mono text-[11px] uppercase tracking-[0.18em] text-accent-green font-medium">Deterministic</th>
                    <th className="px-5 py-3.5 font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted font-medium">LLM role</th>
                  </tr>
                </thead>
                <tbody>
                  {DESIGN_ROWS.map((row) => (
                    <tr
                      key={row.layer}
                      className="border-t border-border-color transition-colors hover:bg-bg-secondary/60"
                    >
                      <td className="px-5 py-3.5 text-text-primary font-medium">{row.layer}</td>
                      <td className="px-5 py-3.5 text-text-secondary">{row.deterministic}</td>
                      <td className="px-5 py-3.5 text-text-muted">{row.llm}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============ CTA ============ */}
      <section className="relative overflow-hidden">
        <div className="aurora" aria-hidden="true" />
        <div className="relative max-w-3xl mx-auto px-6 py-28 text-center">
          <Reveal>
            <h2 className="font-display text-3xl sm:text-5xl font-bold tracking-tight text-text-primary leading-tight">
              Protect production branches
              <br />
              from <span className="text-accent-green">AI drift.</span>
            </h2>
          </Reveal>
          <Reveal delay={120}>
            <p className="mt-6 text-text-secondary max-w-xl mx-auto leading-relaxed">
              Deterministic diagnostics first. Structured recovery always. Run it locally from
              the monorepo today.
            </p>
          </Reveal>
          <Reveal delay={220}>
            <div className="mt-9">
              <Link
                href="/auth/signup"
                className="btn btn-primary px-8 py-3.5 text-base no-underline hover:no-underline"
              >
                Get started
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* ============ Footer ============ */}
      <footer className="border-t border-border-color">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="font-mono text-xs text-text-muted">
            LatchOps — AI agent safety layer for Git recovery and DevOps resilience
          </p>
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
            reversible by design
          </p>
        </div>
      </footer>
    </main>
  );
}
