import Link from 'next/link';
import { Header } from '@/components/Header';

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-bg-primary to-bg-secondary">
      <Header />

      <section className="px-6 py-20 max-w-6xl mx-auto text-center">
        <div className="inline-block px-4 py-1.5 mb-6 rounded-full bg-accent-blue/10 border border-accent-blue/20 text-accent-blue text-sm">Deterministic recovery · Explicit undo paths</div>
        <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold mb-6 leading-tight">
          AI Agent Safety Layer for
          <span className="block bg-gradient-to-r from-accent-blue to-accent-purple bg-clip-text text-transparent">
            Git &amp; CI/CD Resilience
          </span>
        </h1>
        <p className="text-lg text-text-secondary max-w-2xl mx-auto mb-10">
          LatchOps detects dangerous repository states—merge conflicts, detached HEAD, failed rebases,
          and risky AI-generated commits—then delivers deterministic recovery plans with explicit undo paths via git reflog.
        </p>
        <div className="flex gap-4 justify-center flex-wrap">
          <Link
            href="/auth/signup"
            className="px-8 py-3 rounded-lg bg-accent-green text-white font-medium hover:bg-accent-green/90 transition-colors shadow-lg shadow-accent-green/20"
          >
            Get started
          </Link>
          <a
            href="#features"
            className="px-8 py-3 rounded-lg border border-border-color text-text-primary hover:bg-bg-tertiary transition-colors"
          >
            Core capabilities
          </a>
        </div>
      </section>

      <section className="px-6 pb-20 max-w-4xl mx-auto">
        <div className="rounded-lg overflow-hidden border border-border-color bg-bg-secondary shadow-2xl">
          <div className="flex items-center gap-2 px-4 py-3 bg-bg-tertiary border-b border-border-color">
            <span className="w-3 h-3 rounded-full bg-accent-red" />
            <span className="w-3 h-3 rounded-full bg-accent-yellow" />
            <span className="w-3 h-3 rounded-full bg-accent-green" />
            <span className="ml-4 text-sm text-text-muted">terminal</span>
          </div>
          <pre className="p-6 text-sm overflow-x-auto text-text-secondary">
            <code>{`$ latchops send --open
Repository state incident: merge_conflict
Recovery tree ready · Safe rollback path available

$ latchops snapshot --pretty > diagnostics.json
Read-only capture for offline review`}</code>
          </pre>
        </div>
      </section>

      <section id="features" className="px-6 py-20 bg-bg-secondary border-y border-border-color">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">DevOps Rollback Infrastructure</h2>
          <p className="text-text-secondary text-center mb-12 max-w-2xl mx-auto">
            Production-branch protection for teams using Cursor, Claude Code, Copilot, and autonomous coding agents
          </p>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { title: 'Repository state incidents', desc: 'Classify merge conflicts, detached HEAD, and rebase-in-progress with deterministic signals.', color: 'accent-yellow' },
              { title: 'AI-generated change risk', desc: 'Surface risky commits and unmerged files before they reach your main branch.', color: 'accent-blue' },
              { title: 'Recovery tree', desc: 'Step-by-step rollback paths grounded in reflog and branch topology.', color: 'accent-purple' },
              { title: 'Safe rollback path', desc: 'Every recovery step ships with explicit undo commands—no destructive defaults.', color: 'accent-green' },
            ].map((feature) => (
              <div key={feature.title} className="p-6 rounded-lg bg-bg-primary border border-border-color hover:border-accent-blue/50 transition-colors">
                <h3 className={`font-semibold text-${feature.color} mb-2`}>{feature.title}</h3>
                <p className="text-sm text-text-secondary">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="px-6 py-20 max-w-4xl mx-auto">
        <h2 className="text-3xl font-bold text-center mb-4">How It Works</h2>
        <p className="text-text-secondary text-center mb-12">Capture, diagnose, and recover—with full traceability</p>
        <div className="flex flex-col md:flex-row gap-8 items-start">
          {[
            { step: '1', title: 'Capture', desc: 'Run latchops snapshot or latchops send in your repository' },
            { step: '2', title: 'Diagnose', desc: 'LatchOps classifies the incident and builds a recovery tree' },
            { step: '3', title: 'Recover', desc: 'Execute the rollback path with deterministic undo at every step' },
          ].map((item, i) => (
            <div key={item.step} className="flex-1 text-center relative">
              <div className="w-14 h-14 rounded-full bg-gradient-to-br from-accent-blue to-accent-purple text-white flex items-center justify-center text-xl font-bold mx-auto mb-4 shadow-lg">
                {item.step}
              </div>
              <h3 className="font-semibold mb-2 text-lg">{item.title}</h3>
              <p className="text-sm text-text-secondary">{item.desc}</p>
              {i < 2 && (
                <div className="hidden md:block absolute top-7 left-[60%] w-[80%] h-0.5 bg-gradient-to-r from-accent-blue/50 to-transparent" />
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="px-6 py-16 bg-bg-tertiary/50 border-y border-border-color">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-block px-3 py-1 mb-4 rounded-full bg-accent-purple/20 text-accent-purple text-sm font-medium">
            State engine
          </div>
          <h2 className="text-2xl font-bold mb-4">Deterministic-first design</h2>
          <p className="text-text-secondary max-w-2xl mx-auto">
            Git diagnostics and repository risk classification run before any LLM step. Recovery plans are structured,
            verifiable, and traceable in the incident room—including pipeline stages for audit and rollback verification.
          </p>
        </div>
      </section>

      <section className="px-6 py-20 text-center bg-gradient-to-r from-accent-blue/10 to-accent-purple/10">
        <h2 className="text-3xl font-bold mb-4">Protect production branches from AI drift</h2>
        <p className="text-text-secondary mb-8 max-w-xl mx-auto">
          LatchOps is rollback infrastructure—not a toy dashboard. Deterministic diagnostics first; LLM guidance only where it adds clarity.
        </p>
        <Link
          href="/auth/signup"
          className="inline-block px-8 py-3 rounded-lg bg-accent-green text-white font-medium hover:bg-accent-green/90 transition-colors shadow-lg shadow-accent-green/20"
        >
          Open incident room
        </Link>
      </section>

      <footer className="px-6 py-8 text-center text-sm text-text-muted border-t border-border-color">
        <p>LatchOps — AI agent safety layer for Git recovery and DevOps resilience</p>
      </footer>
    </main>
  );
}
