'use client';

import { useState } from 'react';
import { ClipboardList, CheckCircle, AlertTriangle, AlertOctagon, HelpCircle, Check, Copy, ChevronDown, ChevronRight, Clipboard } from 'lucide-react';

interface PlanStep {
  id: string;
  index: number;
  title: string;
  rationale: string | null;
  commandsJson: string[];
  verifyJson: string[];
  undoJson: string[];
  dangerLevel: string;
  status: string;
}

interface SessionData {
  analysis: {
    planSteps: PlanStep[];
  } | null;
}

interface PlanTabProps {
  sessionData: SessionData;
}

export default function PlanTab({ sessionData }: PlanTabProps) {
  const planSteps = sessionData.analysis?.planSteps || [];
  const [expandedSteps, setExpandedSteps] = useState<Set<string>>(new Set());
  const [copiedCommand, setCopiedCommand] = useState<string | null>(null);

  const toggleStep = (stepId: string) => {
    setExpandedSteps((prev) => {
      const next = new Set(prev);
      if (next.has(stepId)) {
        next.delete(stepId);
      } else {
        next.add(stepId);
      }
      return next;
    });
  };

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedCommand(id);
    setTimeout(() => setCopiedCommand(null), 2000);
  };

  const getDangerStyles = (level: string) => {
    switch (level) {
      case 'safe':
        return {
          bg: 'bg-green-500/10',
          border: 'border-green-500/30',
          text: 'text-green-500',
          badge: 'bg-green-500/20 text-green-400',
          Icon: CheckCircle,
        };
      case 'caution':
        return {
          bg: 'bg-yellow-500/10',
          border: 'border-yellow-500/30',
          text: 'text-yellow-500',
          badge: 'bg-yellow-500/20 text-yellow-400',
          Icon: AlertTriangle,
        };
      case 'dangerous':
        return {
          bg: 'bg-red-500/10',
          border: 'border-red-500/30',
          text: 'text-red-500',
          badge: 'bg-red-500/20 text-red-400',
          Icon: AlertOctagon,
        };
      default:
        return {
          bg: 'bg-gray-500/10',
          border: 'border-gray-500/30',
          text: 'text-gray-500',
          badge: 'bg-gray-500/20 text-gray-400',
          Icon: HelpCircle,
        };
    }
  };

  const getStatusStyles = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-green-500';
      case 'in_progress':
        return 'bg-blue-500';
      case 'skipped':
        return 'bg-gray-500';
      default:
        return 'bg-gray-700';
    }
  };

  if (planSteps.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <ClipboardList className="w-12 h-12 mx-auto mb-4 text-gray-500" />
          <h2 className="text-xl font-semibold mb-2">No Recovery Plan</h2>
          <p className="text-text-secondary">
            No recovery steps have been generated for this session.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      {/* Progress Overview */}
      <div className="bg-bg-secondary border border-border-color rounded-lg p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-text-muted">Recovery Progress</h3>
          <span className="text-sm text-text-secondary">
            {planSteps.filter((s) => s.status === 'completed').length} / {planSteps.length} steps completed
          </span>
        </div>
        <div className="flex gap-1">
          {planSteps.map((step) => (
            <div
              key={step.id}
              className={`flex-1 h-2 rounded-full ${getStatusStyles(step.status)}`}
              title={step.title}
            />
          ))}
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-3">
        {planSteps.map((step, index) => {
          const dangerStyles = getDangerStyles(step.dangerLevel);
          const isExpanded = expandedSteps.has(step.id);
          const commands = Array.isArray(step.commandsJson) ? step.commandsJson : [];
          const verifyCommands = Array.isArray(step.verifyJson) ? step.verifyJson : [];
          const undoCommands = Array.isArray(step.undoJson) ? step.undoJson : [];

          return (
            <div
              key={step.id}
              className={`border rounded-lg overflow-hidden ${dangerStyles.border} ${dangerStyles.bg}`}
            >
              {/* Step Header */}
              <button
                onClick={() => toggleStep(step.id)}
                className="w-full p-4 text-left flex items-center gap-4"
              >
                {/* Step Number */}
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    step.status === 'completed'
                      ? 'bg-green-500 text-white'
                      : step.status === 'in_progress'
                      ? 'bg-blue-500 text-white'
                      : 'bg-bg-tertiary text-text-secondary border border-border-color'
                  }`}
                >
                  {step.status === 'completed' ? <Check className="w-4 h-4" /> : index + 1}
                </div>

                {/* Title and Meta */}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{step.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded ${dangerStyles.badge} flex items-center gap-1`}>
                      <dangerStyles.Icon className="w-3 h-3" /> {step.dangerLevel}
                    </span>
                  </div>
                  {step.rationale && (
                    <p className="text-sm text-text-secondary mt-1">{step.rationale}</p>
                  )}
                </div>

                {/* Expand Indicator */}
                <span className="text-text-muted">{isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</span>
              </button>

              {/* Expanded Content */}
              {isExpanded && (
                <div className="px-4 pb-4 space-y-4">
                  {/* Commands */}
                  {commands.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-text-muted mb-2">Commands</h4>
                      <div className="space-y-2">
                        {commands.map((cmd, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 bg-bg-primary rounded-md p-2 font-mono text-sm group"
                          >
                            <span className="text-text-muted">$</span>
                            <code className="flex-1">{cmd}</code>
                            <button
                              onClick={() => copyToClipboard(cmd, `${step.id}-cmd-${i}`)}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-bg-tertiary rounded transition-all"
                              title="Copy to clipboard"
                            >
                              {copiedCommand === `${step.id}-cmd-${i}` ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Verify Commands */}
                  {verifyCommands.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-text-muted mb-2">Verify With</h4>
                      <div className="space-y-2">
                        {verifyCommands.map((cmd, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 bg-blue-500/10 rounded-md p-2 font-mono text-sm group"
                          >
                            <span className="text-blue-400">$</span>
                            <code className="flex-1 text-blue-300">{cmd}</code>
                            <button
                              onClick={() => copyToClipboard(cmd, `${step.id}-verify-${i}`)}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-bg-tertiary rounded transition-all"
                              title="Copy to clipboard"
                            >
                              {copiedCommand === `${step.id}-verify-${i}` ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Undo Commands */}
                  {undoCommands.length > 0 && (
                    <div>
                      <h4 className="text-xs font-medium text-text-muted mb-2">Undo With</h4>
                      <div className="space-y-2">
                        {undoCommands.map((cmd, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-2 bg-red-500/10 rounded-md p-2 font-mono text-sm group"
                          >
                            <span className="text-red-400">$</span>
                            <code className="flex-1 text-red-300">{cmd}</code>
                            <button
                              onClick={() => copyToClipboard(cmd, `${step.id}-undo-${i}`)}
                              className="opacity-0 group-hover:opacity-100 p-1 hover:bg-bg-tertiary rounded transition-all"
                              title="Copy to clipboard"
                            >
                              {copiedCommand === `${step.id}-undo-${i}` ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Action Buttons */}
                  <div className="flex gap-2 pt-2">
                    {step.status !== 'completed' && (
                      <button className="px-4 py-2 bg-accent-blue hover:bg-accent-blue/80 rounded-md text-sm font-medium transition-colors">
                        Mark as Completed
                      </button>
                    )}
                    {step.status === 'pending' && (
                      <button className="px-4 py-2 bg-bg-tertiary border border-border-color hover:bg-bg-secondary rounded-md text-sm font-medium transition-colors">
                        Skip Step
                      </button>
                    )}
                    {step.status === 'completed' && (
                      <button className="px-4 py-2 bg-red-500/20 border border-red-500/30 text-red-400 hover:bg-red-500/30 rounded-md text-sm font-medium transition-colors">
                        Undo Step
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Copy All Commands */}
      <div className="bg-bg-secondary border border-border-color rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium">Copy All Commands</h3>
            <p className="text-sm text-text-muted">
              Copy all recovery commands to run in your terminal
            </p>
          </div>
          <button
            onClick={() => {
              const allCommands = planSteps
                .flatMap((s) => (Array.isArray(s.commandsJson) ? s.commandsJson : []))
                .join('\n');
              copyToClipboard(allCommands, 'all-commands');
            }}
            className="px-4 py-2 bg-bg-tertiary border border-border-color hover:bg-bg-secondary rounded-md text-sm font-medium transition-colors"
          >
            {copiedCommand === 'all-commands' ? '✓ Copied!' : 'Copy All'}
          </button>
        </div>
      </div>
    </div>
  );
}
