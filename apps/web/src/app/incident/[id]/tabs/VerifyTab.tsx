'use client';

import { useState } from 'react';
import { Upload, FileText, PartyPopper, AlertTriangle, X, Loader2 } from 'lucide-react';
import type { IncidentData, VerificationResultV1 } from '../incident-data';

const STATUS_STYLES: Record<string, { border: string; label: string }> = {
  succeeded: { border: 'border-green-500/30 bg-green-500/10', label: 'Succeeded' },
  in_progress: { border: 'border-yellow-500/30 bg-yellow-500/10', label: 'In Progress' },
  not_started: { border: 'border-gray-500/30 bg-gray-500/10', label: 'Not Started' },
  failed: { border: 'border-red-500/30 bg-red-500/10', label: 'Failed' },
  manual_review: { border: 'border-blue-500/30 bg-blue-500/10', label: 'Manual Review' },
};

export default function VerifyTab({ data }: { data: IncidentData }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [altId, setAltId] = useState<string>('');
  const [result, setResult] = useState<VerificationResultV1 | null>(data.verification);
  const [error, setError] = useState<string | null>(null);

  const alternatives = data.plan?.alternatives ?? [];

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const snapshot = JSON.parse(await file.text());
      const res = await fetch(`/api/sessions/${data.id}/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot, selectedAlternativeId: altId || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Verification failed');
      }
      const body = await res.json();
      setResult(body.verification as VerificationResultV1);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to verify snapshot');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div className="bg-bg-secondary border border-border-color rounded-lg p-6">
        <h2 className="text-lg font-semibold mb-2">Verify Your Progress</h2>
        <p className="text-text-secondary">
          After following the recovery plan, capture a fresh snapshot with{' '}
          <code className="px-2 py-1 bg-bg-tertiary rounded">latchops send</code> (or{' '}
          <code className="px-2 py-1 bg-bg-tertiary rounded">latchops snapshot</code>) and upload it.
          Verification compares the before/after signals against the saved plan — deterministically.
        </p>
      </div>

      {alternatives.length > 0 && (
        <div className="bg-bg-secondary border border-border-color rounded-lg p-4">
          <label className="block text-sm font-medium text-text-muted mb-2">
            Which alternative did you follow?
          </label>
          <select
            value={altId}
            onChange={(e) => setAltId(e.target.value)}
            className="w-full bg-bg-primary border border-border-color rounded-md p-2 text-sm"
          >
            <option value="">(not specified)</option>
            {alternatives.map((a) => (
              <option key={a.id} value={a.id}>
                {a.title}
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="border-2 border-dashed border-border-color rounded-lg p-8 text-center">
        {file ? (
          <div className="space-y-4">
            <FileText className="w-12 h-12 text-text-muted mx-auto" />
            <p className="font-medium">{file.name}</p>
            <div className="flex justify-center gap-3">
              <button
                onClick={() => setFile(null)}
                className="px-4 py-2 bg-bg-tertiary border border-border-color rounded-md text-sm font-medium"
              >
                Remove
              </button>
              <button
                onClick={handleUpload}
                disabled={uploading}
                className="px-4 py-2 bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-50 rounded-md text-sm font-medium flex items-center gap-2"
              >
                {uploading && <Loader2 className="w-4 h-4 animate-spin" />}
                {uploading ? 'Verifying...' : 'Verify Snapshot'}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <Upload className="w-12 h-12 text-text-muted mx-auto" />
            <p className="font-medium">Upload a new snapshot JSON</p>
            <input
              type="file"
              accept=".json"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="hidden"
              id="verify-upload"
            />
            <label
              htmlFor="verify-upload"
              className="inline-block px-4 py-2 bg-bg-tertiary border border-border-color rounded-md text-sm font-medium cursor-pointer"
            >
              Select File
            </label>
          </div>
        )}
      </div>

      {error && (
        <div className="border border-red-500/30 bg-red-500/10 rounded-lg p-4 flex items-center gap-3">
          <X className="w-6 h-6 text-red-400" />
          <p className="text-text-secondary">{error}</p>
        </div>
      )}

      {result && <VerificationResultView result={result} />}
    </div>
  );
}

function VerificationResultView({ result }: { result: VerificationResultV1 }) {
  const style = STATUS_STYLES[result.status] ?? STATUS_STYLES.manual_review;
  const succeeded = result.status === 'succeeded';

  return (
    <div className={`border rounded-lg p-6 space-y-4 ${style.border}`}>
      <div className="flex items-center gap-3">
        {succeeded ? (
          <PartyPopper className="w-8 h-8 text-green-500" />
        ) : (
          <AlertTriangle className="w-8 h-8 text-yellow-500" />
        )}
        <div>
          <h3 className="text-lg font-semibold">{style.label}</h3>
          <p className="text-sm text-text-muted capitalize">
            {result.beforeState.replace(/_/g, ' ')} → {result.afterState.replace(/_/g, ' ')}
          </p>
        </div>
      </div>

      {result.reasons.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-text-muted mb-1">Reasons</h4>
          <ul className="space-y-1">
            {result.reasons.map((r, i) => (
              <li key={i} className="text-sm text-text-secondary">• {r}</li>
            ))}
          </ul>
        </div>
      )}

      {result.changedSignals.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-text-muted mb-1">Changed signals</h4>
          <div className="space-y-1 font-mono text-xs">
            {result.changedSignals.map((c, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="text-text-muted">{c.field}</span>
                <span className="text-red-400">{JSON.stringify(c.before)}</span>
                <span className="text-text-muted">→</span>
                <span className="text-green-400">{JSON.stringify(c.after)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {result.remainingIssues.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-text-muted mb-1">Remaining</h4>
          <ul className="space-y-1">
            {result.remainingIssues.map((r, i) => (
              <li key={i} className="flex items-center gap-2 text-sm">
                <AlertTriangle className="w-4 h-4 text-yellow-500" />
                <span>{r}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
