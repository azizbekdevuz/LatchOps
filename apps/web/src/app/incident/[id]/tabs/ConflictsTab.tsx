'use client';

import { useState } from 'react';
import { CheckCircle, AlertTriangle, Bot, Check } from 'lucide-react';

interface ConflictHunk {
  id: string;
  index: number;
  baseText: string;
  oursText: string;
  theirsText: string;
  explanation: string | null;
  suggestedChoice: string | null;
  userChoice: string | null;
}

interface ConflictFile {
  id: string;
  path: string;
  highLevelSummary: string | null;
  hunks: ConflictHunk[];
}

interface SessionData {
  analysis: {
    issueType: string;
    conflictFiles: ConflictFile[];
  } | null;
}

interface ConflictsTabProps {
  sessionData: SessionData;
}

type Choice = 'ours' | 'theirs' | 'base' | 'manual';

export default function ConflictsTab({ sessionData }: ConflictsTabProps) {
  const conflictFiles = sessionData.analysis?.conflictFiles || [];
  const [selectedFileId, setSelectedFileId] = useState<string | null>(
    conflictFiles[0]?.id || null
  );
  const [hunkChoices, setHunkChoices] = useState<Record<string, Choice>>({});
  const [expandedHunks, setExpandedHunks] = useState<Set<string>>(new Set());

  const selectedFile = conflictFiles.find((f) => f.id === selectedFileId);

  const handleChoiceChange = (hunkId: string, choice: Choice) => {
    setHunkChoices((prev) => ({ ...prev, [hunkId]: choice }));
  };

  const toggleHunkExpanded = (hunkId: string) => {
    setExpandedHunks((prev) => {
      const next = new Set(prev);
      if (next.has(hunkId)) {
        next.delete(hunkId);
      } else {
        next.add(hunkId);
      }
      return next;
    });
  };

  if (conflictFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <CheckCircle className="w-12 h-12 mx-auto mb-4 text-green-500" />
          <h2 className="text-xl font-semibold mb-2">No Conflicts Found</h2>
          <p className="text-text-secondary">
            There are no merge conflicts to resolve in this session.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-4 h-[calc(100vh-280px)]">
      {/* File List Sidebar */}
      <div className="w-64 flex-shrink-0 bg-bg-secondary border border-border-color rounded-lg overflow-hidden">
        <div className="p-3 border-b border-border-color">
          <h3 className="text-sm font-medium text-text-muted">
            Conflict Files ({conflictFiles.length})
          </h3>
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

      {/* Conflict Detail View */}
      <div className="flex-1 bg-bg-secondary border border-border-color rounded-lg overflow-hidden flex flex-col">
        {selectedFile ? (
          <>
            {/* File Header */}
            <div className="p-4 border-b border-border-color">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-mono text-lg">{selectedFile.path}</h2>
                  {selectedFile.highLevelSummary && (
                    <p className="text-sm text-text-secondary mt-1">
                      {selectedFile.highLevelSummary}
                    </p>
                  )}
                </div>
                <div className="text-sm text-text-muted">
                  {selectedFile.hunks.length} hunk{selectedFile.hunks.length !== 1 ? 's' : ''}
                </div>
              </div>
            </div>

            {/* Hunks */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {selectedFile.hunks.map((hunk) => (
                <div
                  key={hunk.id}
                  className="border border-border-color rounded-lg overflow-hidden"
                >
                  {/* Hunk Header */}
                  <div className="p-3 bg-bg-tertiary border-b border-border-color flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium">Conflict #{hunk.index + 1}</span>
                      {hunk.suggestedChoice && (
                        <span className="text-xs bg-accent-blue/20 text-accent-blue px-2 py-0.5 rounded">
                          Suggested: {hunk.suggestedChoice}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => toggleHunkExpanded(hunk.id)}
                      className="text-sm text-text-muted hover:text-text-primary"
                    >
                      {expandedHunks.has(hunk.id) ? 'Collapse' : 'Expand'}
                    </button>
                  </div>

                  {/* AI Explanation */}
                  {hunk.explanation && (
                    <div className="p-3 bg-accent-purple/10 border-b border-border-color">
                      <div className="flex items-start gap-2">
                        <Bot className="w-4 h-4 text-accent-purple flex-shrink-0 mt-0.5" />
                        <p className="text-sm text-text-secondary">{hunk.explanation}</p>
                      </div>
                    </div>
                  )}

                  {/* 3-Panel Diff View */}
                  <div className="grid grid-cols-3 divide-x divide-border-color">
                    {/* BASE */}
                    <div className="flex flex-col">
                      <div className="p-2 bg-gray-500/10 text-center text-xs font-medium text-gray-400 border-b border-border-color">
                        BASE
                      </div>
                      <div className="p-3 font-mono text-xs overflow-x-auto bg-bg-primary">
                        <pre className={`whitespace-pre-wrap ${!expandedHunks.has(hunk.id) ? 'max-h-32 overflow-hidden' : ''}`}>
                          {hunk.baseText || '(empty)'}
                        </pre>
                      </div>
                    </div>

                    {/* OURS */}
                    <div className="flex flex-col">
                      <div className="p-2 bg-green-500/10 text-center text-xs font-medium text-green-400 border-b border-border-color">
                        OURS (Current Branch)
                      </div>
                      <div className="p-3 font-mono text-xs overflow-x-auto bg-bg-primary">
                        <pre className={`whitespace-pre-wrap ${!expandedHunks.has(hunk.id) ? 'max-h-32 overflow-hidden' : ''}`}>
                          {hunk.oursText || '(empty)'}
                        </pre>
                      </div>
                    </div>

                    {/* THEIRS */}
                    <div className="flex flex-col">
                      <div className="p-2 bg-blue-500/10 text-center text-xs font-medium text-blue-400 border-b border-border-color">
                        THEIRS (Incoming)
                      </div>
                      <div className="p-3 font-mono text-xs overflow-x-auto bg-bg-primary">
                        <pre className={`whitespace-pre-wrap ${!expandedHunks.has(hunk.id) ? 'max-h-32 overflow-hidden' : ''}`}>
                          {hunk.theirsText || '(empty)'}
                        </pre>
                      </div>
                    </div>
                  </div>

                  {/* Choice Buttons */}
                  <div className="p-3 bg-bg-tertiary border-t border-border-color">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text-muted mr-2">Resolution:</span>
                      <button
                        onClick={() => handleChoiceChange(hunk.id, 'ours')}
                        className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                          hunkChoices[hunk.id] === 'ours'
                            ? 'bg-green-500 text-white'
                            : 'bg-bg-secondary border border-border-color hover:bg-green-500/20'
                        }`}
                      >
                        Take Ours
                      </button>
                      <button
                        onClick={() => handleChoiceChange(hunk.id, 'theirs')}
                        className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                          hunkChoices[hunk.id] === 'theirs'
                            ? 'bg-blue-500 text-white'
                            : 'bg-bg-secondary border border-border-color hover:bg-blue-500/20'
                        }`}
                      >
                        Take Theirs
                      </button>
                      <button
                        onClick={() => handleChoiceChange(hunk.id, 'base')}
                        className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                          hunkChoices[hunk.id] === 'base'
                            ? 'bg-gray-500 text-white'
                            : 'bg-bg-secondary border border-border-color hover:bg-gray-500/20'
                        }`}
                      >
                        Keep Base
                      </button>
                      <button
                        onClick={() => handleChoiceChange(hunk.id, 'manual')}
                        className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
                          hunkChoices[hunk.id] === 'manual'
                            ? 'bg-accent-purple text-white'
                            : 'bg-bg-secondary border border-border-color hover:bg-accent-purple/20'
                        }`}
                      >
                        Manual Edit
                      </button>
                      {hunkChoices[hunk.id] && (
                        <span className="ml-auto text-xs text-green-500 flex items-center gap-1">
                          <Check className="w-3 h-3" /> Selected
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-border-color bg-bg-tertiary">
              <div className="flex items-center justify-between">
                <div className="text-sm text-text-muted">
                  {Object.keys(hunkChoices).length} of {selectedFile.hunks.length} hunks resolved
                </div>
                <div className="flex gap-2">
                  <button className="px-4 py-2 bg-bg-secondary border border-border-color rounded-md text-sm font-medium hover:bg-bg-tertiary transition-colors">
                    Reset Choices
                  </button>
                  <button
                    disabled={Object.keys(hunkChoices).length !== selectedFile.hunks.length}
                    className="px-4 py-2 bg-accent-blue hover:bg-accent-blue/80 disabled:opacity-50 disabled:cursor-not-allowed rounded-md text-sm font-medium transition-colors"
                  >
                    Apply Resolutions
                  </button>
                </div>
              </div>
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
