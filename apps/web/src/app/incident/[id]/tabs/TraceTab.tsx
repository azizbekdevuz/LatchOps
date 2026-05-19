'use client';

import { useState } from 'react';
import { Inbox, Search, Lightbulb, Clipboard, Check, Settings, BarChart3 } from 'lucide-react';

interface Trace {
  id: string;
  stage: string;
  inputJson: unknown;
  outputJson: unknown;
  durationMs: number | null;
  success: boolean;
  createdAt: string;
}

interface SessionData {
  traces: Trace[];
}

interface TraceTabProps {
  sessionData: SessionData;
}

export default function TraceTab({ sessionData }: TraceTabProps) {
  const traces = sessionData.traces || [];
  const [selectedTrace, setSelectedTrace] = useState<Trace | null>(traces[0] || null);
  const [showInput, setShowInput] = useState(true);

  const getStageIcon = (stage: string) => {
    switch (stage) {
      case 'ingest':
        return Inbox;
      case 'analyze':
        return Search;
      case 'explain':
        return Lightbulb;
      case 'plan':
        return Clipboard;
      case 'verify':
        return Check;
      default:
        return Settings;
    }
  };

  const getStageColor = (stage: string, success: boolean) => {
    if (!success) return 'border-red-500/30 bg-red-500/10';
    switch (stage) {
      case 'ingest':
        return 'border-blue-500/30 bg-blue-500/10';
      case 'analyze':
        return 'border-purple-500/30 bg-purple-500/10';
      case 'explain':
        return 'border-yellow-500/30 bg-yellow-500/10';
      case 'plan':
        return 'border-green-500/30 bg-green-500/10';
      case 'verify':
        return 'border-teal-500/30 bg-teal-500/10';
      default:
        return 'border-gray-500/30 bg-gray-500/10';
    }
  };

  const formatDuration = (ms: number | null) => {
    if (ms === null) return 'N/A';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

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
          <div className="mb-4 flex justify-center"><BarChart3 className="w-12 h-12 text-text-muted" /></div>
          <h2 className="text-xl font-semibold mb-2">No Traces Available</h2>
          <p className="text-text-secondary">
            Pipeline traces will appear here as the system processes your snapshot.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-280px)]">
      {/* Timeline Sidebar */}
      <div className="w-72 flex-shrink-0 bg-bg-secondary border border-border-color rounded-lg overflow-hidden">
        <div className="p-3 border-b border-border-color">
          <h3 className="text-sm font-medium text-text-muted">Pipeline Trace</h3>
        </div>
        <div className="overflow-y-auto max-h-full">
          {traces.map((trace, index) => (
            <button
              key={trace.id}
              onClick={() => setSelectedTrace(trace)}
              className={`w-full text-left p-4 border-b border-border-color hover:bg-bg-tertiary transition-colors ${
                selectedTrace?.id === trace.id ? 'bg-bg-tertiary' : ''
              }`}
            >
              <div className="flex items-start gap-3">
                {/* Timeline Connector */}
                <div className="flex flex-col items-center">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      trace.success ? 'bg-bg-tertiary' : 'bg-red-500/20'
                    }`}
                  >
                    {(() => {
                      const IconComponent = getStageIcon(trace.stage);
                      return <IconComponent className="w-4 h-4" />;
                    })()}
                  </div>
                  {index < traces.length - 1 && (
                    <div className="w-0.5 h-8 bg-border-color mt-1" />
                  )}
                </div>

                {/* Stage Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="font-medium capitalize">{trace.stage}</span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${
                        trace.success
                          ? 'bg-green-500/20 text-green-400'
                          : 'bg-red-500/20 text-red-400'
                      }`}
                    >
                      {trace.success ? 'OK' : 'FAIL'}
                    </span>
                  </div>
                  <div className="text-xs text-text-muted mt-1">
                    {formatDuration(trace.durationMs)} •{' '}
                    {new Date(trace.createdAt).toLocaleTimeString()}
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Trace Detail View */}
      <div className="flex-1 bg-bg-secondary border border-border-color rounded-lg overflow-hidden flex flex-col">
        {selectedTrace ? (
          <>
            {/* Header */}
            <div
              className={`p-4 border-b ${getStageColor(selectedTrace.stage, selectedTrace.success)}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {(() => {
                    const IconComponent = getStageIcon(selectedTrace.stage);
                    return <IconComponent className="w-6 h-6" />;
                  })()}
                  <div>
                    <h2 className="text-lg font-semibold capitalize">{selectedTrace.stage} Stage</h2>
                    <p className="text-sm text-text-secondary">
                      Executed at {new Date(selectedTrace.createdAt).toLocaleString()}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className={`px-3 py-1 rounded-full text-sm font-medium ${
                      selectedTrace.success
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-red-500/20 text-red-400'
                    }`}
                  >
                    {selectedTrace.success ? 'Success' : 'Failed'}
                  </span>
                  <span className="text-sm text-text-muted">
                    {formatDuration(selectedTrace.durationMs)}
                  </span>
                </div>
              </div>
            </div>

            {/* Toggle */}
            <div className="p-3 border-b border-border-color flex gap-2">
              <button
                onClick={() => setShowInput(true)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  showInput
                    ? 'bg-accent-blue text-white'
                    : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                }`}
              >
                Input
              </button>
              <button
                onClick={() => setShowInput(false)}
                className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  !showInput
                    ? 'bg-accent-blue text-white'
                    : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
                }`}
              >
                Output
              </button>
            </div>

            {/* JSON Content */}
            <div className="flex-1 overflow-auto p-4">
              <pre className="font-mono text-sm whitespace-pre-wrap bg-bg-primary p-4 rounded-lg border border-border-color">
                {formatJson(showInput ? selectedTrace.inputJson : selectedTrace.outputJson)}
              </pre>
            </div>

            {/* Copy Button */}
            <div className="p-3 border-t border-border-color bg-bg-tertiary">
              <button
                onClick={() => {
                  const content = formatJson(
                    showInput ? selectedTrace.inputJson : selectedTrace.outputJson
                  );
                  navigator.clipboard.writeText(content);
                }}
                className="px-4 py-2 bg-bg-secondary border border-border-color rounded-md text-sm font-medium hover:bg-bg-tertiary transition-colors"
              >
                Copy {showInput ? 'Input' : 'Output'} JSON
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-muted">Select a trace to view details</p>
          </div>
        )}
      </div>
    </div>
  );
}
