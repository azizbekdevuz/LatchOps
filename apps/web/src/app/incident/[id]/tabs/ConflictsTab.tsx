'use client';

import { useState } from 'react';
import { CheckCircle, AlertTriangle } from 'lucide-react';
import type { IncidentData } from '../incident-data';

export default function ConflictsTab({ data }: { data: IncidentData }) {
  const conflictFiles = data.conflicts;
  const [selectedFileId, setSelectedFileId] = useState<string | null>(conflictFiles[0]?.id || null);
  const selectedFile = conflictFiles.find((f) => f.id === selectedFileId);

  if (conflictFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
          <h2 className="text-xl font-semibold mb-2">No Conflicts Found</h2>
          <p className="text-text-secondary">There are no unmerged files captured in this snapshot.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-280px)]">
      <div className="w-64 flex-shrink-0 bg-bg-secondary border border-border-color rounded-lg overflow-hidden">
        <div className="p-3 border-b border-border-color">
          <h3 className="text-sm font-medium text-text-muted">Conflict Files ({conflictFiles.length})</h3>
        </div>
        <div className="overflow-y-auto max-h-full">
          {conflictFiles.map((file) => (
            <button
              key={file.id}
              onClick={() => setSelectedFileId(file.id)}
              className={`w-full text-left p-3 border-b border-border-color hover:bg-bg-tertiary transition-colors ${
                selectedFileId === file.id ? 'bg-bg-tertiary' : ''
              }`}
            >
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-yellow-500 flex-shrink-0" />
                <span className="font-mono text-sm truncate flex-1">{file.path}</span>
              </div>
              <div className="mt-1 text-xs text-text-muted">
                {file.hunks.length} conflict{file.hunks.length !== 1 ? 's' : ''}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 bg-bg-secondary border border-border-color rounded-lg overflow-hidden flex flex-col">
        {selectedFile ? (
          <>
            <div className="p-4 border-b border-border-color">
              <h2 className="font-mono text-lg">{selectedFile.path}</h2>
              <p className="text-sm text-text-muted mt-1">
                {selectedFile.hunks.length} hunk{selectedFile.hunks.length !== 1 ? 's' : ''} — read-only three-way view
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {selectedFile.hunks.map((hunk) => (
                <div key={hunk.id} className="border border-border-color rounded-lg overflow-hidden">
                  <div className="p-3 bg-bg-tertiary border-b border-border-color">
                    <span className="text-sm font-medium">Conflict #{hunk.index + 1}</span>
                  </div>
                  <div className="grid grid-cols-3 divide-x divide-border-color">
                    <ThreeWayPane title="BASE" tone="text-gray-400" bg="bg-gray-500/10" text={hunk.baseText} />
                    <ThreeWayPane title="OURS (current)" tone="text-green-400" bg="bg-green-500/10" text={hunk.oursText} />
                    <ThreeWayPane title="THEIRS (incoming)" tone="text-blue-400" bg="bg-blue-500/10" text={hunk.theirsText} />
                  </div>
                </div>
              ))}
            </div>

            <div className="p-3 border-t border-border-color bg-bg-tertiary text-xs text-text-muted">
              Resolve conflicts in your editor, then run the recovery plan and re-run
              <code className="mx-1 px-1.5 py-0.5 bg-bg-primary rounded">latchops send</code>
              to verify.
            </div>
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-text-muted">Select a file to view conflicts</p>
          </div>
        )}
      </div>
    </div>
  );
}

function ThreeWayPane({ title, tone, bg, text }: { title: string; tone: string; bg: string; text: string }) {
  return (
    <div className="flex flex-col">
      <div className={`p-2 text-center text-xs font-medium ${tone} ${bg} border-b border-border-color`}>{title}</div>
      <div className="p-3 font-mono text-xs overflow-x-auto bg-bg-primary">
        <pre className="whitespace-pre-wrap">{text || '(empty)'}</pre>
      </div>
    </div>
  );
}
