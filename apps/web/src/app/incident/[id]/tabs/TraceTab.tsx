'use client';

import { useState } from 'react';
import { FileCheck2, Activity, Tags, ClipboardList, CheckCheck, Settings, BarChart3 } from 'lucide-react';
import type { IncidentData } from '../incident-data';

type Trace = IncidentData['traces'][number];

const STAGE_META: Record<string, { label: string; icon: typeof Activity; color: string }> = {
  snapshot_validated: { label: 'Snapshot validated', icon: FileCheck2, color: 'border-blue-500/30 bg-blue-500/10' },
  signals_computed: { label: 'Signals computed', icon: Activity, color: 'border-purple-500/30 bg-purple-500/10' },
  incident_classified: { label: 'Incident classified', icon: Tags, color: 'border-yellow-500/30 bg-yellow-500/10' },
  plan_generated: { label: 'Plan generated', icon: ClipboardList, color: 'border-green-500/30 bg-green-500/10' },
  verification_completed: { label: 'Verification completed', icon: CheckCheck, color: 'border-teal-500/30 bg-teal-500/10' },
};

function meta(stage: string) {
  return STAGE_META[stage] ?? { label: stage, icon: Settings, color: 'border-gray-500/30 bg-gray-500/10' };
}

export default function TraceTab({ data }: { data: IncidentData }) {
  const traces = data.traces || [];
  const [selected, setSelected] = useState<Trace | null>(traces[0] || null);

  const formatDuration = (ms: number | null) => (ms === null ? 'N/A' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`);
  const formatJson = (json: unknown) => {
    try {
      return JSON.stringify(json, null, 2);
    } catch {
      return String(json);
    }
  };

  if (traces.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <BarChart3 className="w-12 h-12 text-text-muted mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">No Traces Available</h2>
          <p className="text-text-secondary">Deterministic pipeline stages will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-280px)]">
      <div className="w-72 flex-shrink-0 bg-bg-secondary border border-border-color rounded-lg overflow-hidden">
        <div className="p-3 border-b border-border-color">
          <h3 className="text-sm font-medium text-text-muted">Deterministic Pipeline</h3>
        </div>
        <div className="overflow-y-auto max-h-full">
          {traces.map((trace, index) => {
            const m = meta(trace.stage);
            const Icon = m.icon;
            return (
              <button
                key={trace.id}
                onClick={() => setSelected(trace)}
                className={`w-full text-left p-4 border-b border-border-color hover:bg-bg-tertiary transition-colors ${
                  selected?.id === trace.id ? 'bg-bg-tertiary' : ''
                }`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center ${trace.success ? 'bg-bg-tertiary' : 'bg-red-500/20'}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                    {index < traces.length - 1 && <div className="w-0.5 h-8 bg-border-color mt-1" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-sm">{m.label}</span>
                      <span className={`text-xs px-2 py-0.5 rounded ${trace.success ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
                        {trace.success ? 'OK' : 'FAIL'}
                      </span>
                    </div>
                    <div className="text-xs text-text-muted mt-1">
                      {formatDuration(trace.durationMs)} • {new Date(trace.createdAt).toLocaleTimeString()}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex-1 bg-bg-secondary border border-border-color rounded-lg overflow-hidden flex flex-col">
        {selected ? (
          <>
            <div className={`p-4 border-b ${meta(selected.stage).color}`}>
              <h2 className="text-lg font-semibold">{meta(selected.stage).label}</h2>
              <p className="text-sm text-text-secondary">
                {new Date(selected.createdAt).toLocaleString()} • {formatDuration(selected.durationMs)}
              </p>
            </div>
            <div className="flex-1 overflow-auto p-4">
              <pre className="font-mono text-sm whitespace-pre-wrap bg-bg-primary p-4 rounded-lg border border-border-color">
                {formatJson(selected.outputJson)}
              </pre>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-muted">Select a stage to view its output</p>
          </div>
        )}
      </div>
    </div>
  );
}
