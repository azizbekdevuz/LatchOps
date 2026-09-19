'use client';

import { useState } from 'react';
import {
  ClipboardList,
  AlertOctagon,
  ShieldCheck,
  ShieldAlert,
  Copy,
  Check,
  Undo2,
  Eye,
} from 'lucide-react';
import type { IncidentData, RecoveryPlanV1 } from '../incident-data';

type RecoveryStep = RecoveryPlanV1['steps'][number];
type RecoveryCommand = RecoveryStep['commands'][number];
type RecoveryAlternative = RecoveryPlanV1['alternatives'][number];

const RISK_BADGE: Record<string, string> = {
  none: 'bg-gray-500/20 text-gray-300',
  low: 'bg-green-500/20 text-green-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  high: 'bg-orange-500/20 text-orange-400',
  critical: 'bg-red-500/20 text-red-400',
};

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(id);
    setTimeout(() => setCopied(null), 2000);
  };
  return { copied, copy };
}

function CommandList({
  commands,
  copied,
  copy,
  idPrefix,
  tone = 'default',
}: {
  commands: RecoveryCommand[];
  copied: string | null;
  copy: (t: string, id: string) => void;
  idPrefix: string;
  tone?: 'default' | 'verify' | 'undo';
}) {
  if (commands.length === 0) return null;
  const toneClasses =
    tone === 'verify'
      ? 'bg-blue-500/10 text-blue-300'
      : tone === 'undo'
      ? 'bg-red-500/10 text-red-300'
      : 'bg-bg-primary';
  return (
    <div className="space-y-2">
      {commands.map((cmd, i) => (
        <div key={i} className={`flex items-center gap-2 rounded-md p-2 font-mono text-sm group ${toneClasses}`}>
          <span className="text-text-muted">$</span>
          <code className="flex-1 break-all">{cmd.display}</code>
          {cmd.readOnly && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 flex items-center gap-1">
              <Eye className="w-3 h-3" /> read-only
            </span>
          )}
          {cmd.containsPlaceholder && (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400">
              edit first
            </span>
          )}
          <button
            onClick={() => copy(cmd.display, `${idPrefix}-${i}`)}
            className="opacity-0 group-hover:opacity-100 p-1 hover:bg-bg-tertiary rounded transition-all"
            title="Copy"
          >
            {copied === `${idPrefix}-${i}` ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </button>
        </div>
      ))}
    </div>
  );
}

function StepCard({
  step,
  copied,
  copy,
  idPrefix,
}: {
  step: RecoveryStep;
  copied: string | null;
  copy: (t: string, id: string) => void;
  idPrefix: string;
}) {
  const borderTone = step.destructive
    ? 'border-red-500/40'
    : step.risk === 'high' || step.risk === 'critical'
    ? 'border-orange-500/40'
    : 'border-border-color';

  return (
    <div className={`border rounded-lg overflow-hidden ${borderTone} bg-bg-secondary`}>
      <div className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-7 h-7 rounded-full bg-bg-tertiary border border-border-color flex items-center justify-center text-sm font-bold flex-shrink-0">
            {step.order}
          </div>
          <div className="flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{step.title}</span>
              <span className={`text-xs px-2 py-0.5 rounded capitalize ${RISK_BADGE[step.risk] ?? RISK_BADGE.none}`}>
                {step.risk}
              </span>
              {step.destructive && (
                <span className="text-xs px-2 py-0.5 rounded bg-red-500/20 text-red-400 flex items-center gap-1">
                  <AlertOctagon className="w-3 h-3" /> destructive
                </span>
              )}
              {step.requiresConfirmation && (
                <span className="text-xs px-2 py-0.5 rounded bg-yellow-500/20 text-yellow-400 flex items-center gap-1">
                  <ShieldAlert className="w-3 h-3" /> confirmation required
                </span>
              )}
            </div>
            {step.description && <p className="text-sm text-text-secondary mt-1">{step.description}</p>}
          </div>
        </div>

        {step.prerequisites.length > 0 && (
          <div className="text-xs text-text-muted">
            <span className="font-medium">Prerequisites: </span>
            {step.prerequisites.join('; ')}
          </div>
        )}

        <CommandList commands={step.commands} copied={copied} copy={copy} idPrefix={`${idPrefix}-cmd`} />

        {step.expectedOutcome && (
          <p className="text-xs text-text-secondary">
            <span className="font-medium text-text-muted">Expected: </span>
            {step.expectedOutcome}
          </p>
        )}

        {/* Undo strategy */}
        <div className="rounded-md border border-border-color bg-bg-primary/40 p-3">
          <div className="flex items-center gap-2 text-xs font-medium text-text-muted mb-1">
            <Undo2 className="w-3.5 h-3.5" /> Undo — {step.undoStrategy.reversibility}
            {step.undoStrategy.guaranteed ? (
              <ShieldCheck className="w-3.5 h-3.5 text-green-400" />
            ) : (
              <ShieldAlert className="w-3.5 h-3.5 text-yellow-400" />
            )}
          </div>
          <p className="text-xs text-text-secondary">{step.undoStrategy.description}</p>
          {step.undoStrategy.notes && (
            <p className="text-xs text-yellow-400/80 mt-1">{step.undoStrategy.notes}</p>
          )}
          <div className="mt-2">
            <CommandList commands={step.undoStrategy.commands} copied={copied} copy={copy} idPrefix={`${idPrefix}-undo`} tone="undo" />
          </div>
        </div>

        {/* Verification */}
        {(step.verification.commands.length > 0 || step.verification.description) && (
          <div className="rounded-md border border-border-color bg-bg-primary/40 p-3">
            <div className="text-xs font-medium text-text-muted mb-1">Verify</div>
            {step.verification.description && (
              <p className="text-xs text-text-secondary mb-2">{step.verification.description}</p>
            )}
            <CommandList commands={step.verification.commands} copied={copied} copy={copy} idPrefix={`${idPrefix}-verify`} tone="verify" />
          </div>
        )}
      </div>
    </div>
  );
}

function AlternativeCard({
  alt,
  copied,
  copy,
}: {
  alt: RecoveryAlternative;
  copied: string | null;
  copy: (t: string, id: string) => void;
}) {
  return (
    <div className={`border rounded-lg ${alt.recommended ? 'border-accent-blue/50' : 'border-border-color'} bg-bg-secondary/60`}>
      <div className="p-4 border-b border-border-color">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{alt.title}</h3>
          <span className={`text-xs px-2 py-0.5 rounded capitalize ${RISK_BADGE[alt.risk] ?? RISK_BADGE.none}`}>{alt.risk}</span>
          {alt.recommended && (
            <span className="text-xs px-2 py-0.5 rounded bg-accent-blue/20 text-accent-blue">recommended</span>
          )}
        </div>
        <p className="text-sm text-text-secondary mt-1">{alt.description}</p>
        <p className="text-xs text-text-muted mt-2">
          <span className="font-medium">Trade-offs: </span>
          {alt.tradeoffs}
        </p>
      </div>
      <div className="p-4 space-y-3">
        {alt.steps.map((step) => (
          <StepCard key={step.id} step={step} copied={copied} copy={copy} idPrefix={`${alt.id}-${step.id}`} />
        ))}
      </div>
    </div>
  );
}

export default function PlanTab({ data }: { data: IncidentData }) {
  const { copied, copy } = useCopy();
  const plan = data.plan;

  if (!plan) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <ClipboardList className="w-12 h-12 mx-auto mb-4 text-gray-500" />
          <h2 className="text-xl font-semibold mb-2">No Recovery Plan</h2>
          <p className="text-text-secondary">No canonical recovery plan is available for this incident.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-bg-secondary border border-border-color rounded-lg p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">{plan.summary}</h2>
            <p className="text-xs text-text-muted mt-1">
              Deterministic engine v{plan.engineVersion} • generated {new Date(plan.generatedAt).toLocaleString()}
            </p>
          </div>
          <span className={`text-xs px-2 py-0.5 rounded capitalize ${RISK_BADGE[plan.risk] ?? RISK_BADGE.none}`}>
            {plan.risk} risk
          </span>
        </div>
        {plan.incomplete && (
          <p className="mt-2 text-xs text-yellow-400">
            This plan is incomplete: evidence was insufficient to produce a full plan. Use the read-only diagnostics.
          </p>
        )}
      </div>

      {plan.steps.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-text-muted">Steps</h3>
          {plan.steps.map((step) => (
            <StepCard key={step.id} step={step} copied={copied} copy={copy} idPrefix={`step-${step.id}`} />
          ))}
        </div>
      )}

      {plan.alternatives.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-text-muted">
            Alternatives {plan.alternatives.length > 1 ? '(choose one)' : ''}
          </h3>
          {plan.alternatives.map((alt) => (
            <AlternativeCard key={alt.id} alt={alt} copied={copied} copy={copy} />
          ))}
        </div>
      )}
    </div>
  );
}
