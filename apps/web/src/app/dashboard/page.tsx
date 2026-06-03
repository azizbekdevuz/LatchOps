'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Header } from '@/components/Header';
import {
  Upload,
  Terminal,
  GitBranch,
  RotateCcw,
  Shield,
  CheckCircle2,
  AlertCircle,
  FileJson,
  Cpu,
  Activity,
  GitMerge,
  Sparkles,
  ArrowRight,
  Copy,
  Check
} from 'lucide-react';

type AnalysisStage = 'idle' | 'uploading' | 'parsing' | 'analyzing' | 'generating' | 'complete' | 'error';

interface AnalysisResult {
  sessionId: string;
  issueType: string;
  conflictCount: number;
  riskLevel: string;
}

export default function DashboardPage() {
  const [file, setFile] = useState<File | null>(null);
  const [stage, setStage] = useState<AnalysisStage>('idle');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const router = useRouter();

  // Simulate progress animation
  useEffect(() => {
    if (stage === 'uploading') {
      const interval = setInterval(() => {
        setProgress(p => Math.min(p + Math.random() * 15, 25));
      }, 100);
      return () => clearInterval(interval);
    }
    if (stage === 'parsing') {
      const interval = setInterval(() => {
        setProgress(p => Math.min(p + Math.random() * 10, 50));
      }, 100);
      return () => clearInterval(interval);
    }
    if (stage === 'analyzing') {
      const interval = setInterval(() => {
        setProgress(p => Math.min(p + Math.random() * 8, 75));
      }, 100);
      return () => clearInterval(interval);
    }
    if (stage === 'generating') {
      const interval = setInterval(() => {
        setProgress(p => Math.min(p + Math.random() * 5, 95));
      }, 100);
      return () => clearInterval(interval);
    }
    if (stage === 'complete') {
      setProgress(100);
    }
  }, [stage]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (selectedFile) {
      setFile(selectedFile);
      setError(null);
      setStage('idle');
    }
  };

  const handleDrag = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true);
    } else if (e.type === 'dragleave') {
      setDragActive(false);
    }
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const droppedFile = e.dataTransfer.files[0];
      if (droppedFile.name.endsWith('.json')) {
        setFile(droppedFile);
        setError(null);
        setStage('idle');
      } else {
        setError('Please upload a JSON file');
      }
    }
  }, []);

  const copyCommand = async () => {
    setCopyError(null);
    try {
      await navigator.clipboard.writeText('latchops snapshot --pretty > snapshot.json');
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopyError('Unable to copy command. Please copy it manually.');
    }
  };

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!file) return;

    setStage('uploading');
    setProgress(0);
    setError(null);

    try {
      // Stage 1: Parse file
      await new Promise(r => setTimeout(r, 300));
      setStage('parsing');
      const content = await file.text();
      const snapshot = JSON.parse(content);

      // Stage 2: Upload and analyze
      await new Promise(r => setTimeout(r, 400));
      setStage('analyzing');

      const response = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ snapshot }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error || 'Failed to create session');
      }

      // Stage 3: Generate plan
      setStage('generating');
      const { sessionId } = await response.json();

      // Validate sessionId
      if (!sessionId || typeof sessionId !== 'string') {
        throw new Error('Failed to retrieve a valid session ID');
      }

      // Trigger plan generation
      const planResponse = await fetch(`/api/sessions/${sessionId}/plan`, {
        method: 'POST',
      });

      if (!planResponse.ok) {
        let message = 'Failed to generate recovery plan';
        try {
          const data = await planResponse.json();
          message = data.error || message;
        } catch {
          // Keep fallback message if body is not JSON
        }
        throw new Error(message);
      }

      await new Promise(r => setTimeout(r, 500));
      setStage('complete');

      // Extract analysis info
      setResult({
        sessionId,
        issueType: snapshot.unmergedFiles?.length > 0 ? 'merge_conflict' :
                   snapshot.isDetachedHead ? 'detached_head' :
                   snapshot.rebaseState?.inProgress ? 'rebase_in_progress' : 'clean',
        conflictCount: snapshot.unmergedFiles?.length || 0,
        riskLevel: snapshot.unmergedFiles?.length > 3 ? 'high' :
                   snapshot.unmergedFiles?.length > 0 ? 'medium' : 'low',
      });

      // Navigate after brief delay
      setTimeout(() => {
        router.push(`/session/${sessionId}`);
      }, 1500);

    } catch (err) {
      setStage('error');
      setError(err instanceof Error ? err.message : 'Failed to process snapshot');
    }
  };

  const getStageInfo = () => {
    switch (stage) {
      case 'uploading':
        return { label: 'Uploading snapshot…', icon: Upload };
      case 'parsing':
        return { label: 'Parsing git state…', icon: FileJson };
      case 'analyzing':
        return { label: 'Analyzing repository signals…', icon: Cpu };
      case 'generating':
        return { label: 'Building recovery tree…', icon: Sparkles };
      case 'complete':
        return { label: 'Diagnosis complete', icon: CheckCircle2 };
      case 'error':
        return { label: 'Diagnosis failed', icon: AlertCircle };
      default:
        return { label: 'Ready to analyze', icon: Activity };
    }
  };

  const stageInfo = getStageInfo();
  const isProcessing = ['uploading', 'parsing', 'analyzing', 'generating'].includes(stage);

  return (
    <main className="min-h-screen bg-bg-primary relative">
      <div className="absolute inset-x-0 top-0 h-[480px] overflow-hidden pointer-events-none" aria-hidden="true">
        <div className="aurora" />
        <div className="absolute inset-0 bg-grid" />
      </div>

      <Header />

      <div className="relative max-w-6xl mx-auto px-6 py-12">
        {/* Page heading */}
        <div className="mb-12">
          <p className="font-mono text-xs uppercase tracking-[0.25em] text-accent-green mb-4 flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent-green pulse-dot" />
            Incident intake
          </p>
          <h1 className="font-display text-3xl md:text-4xl font-bold tracking-tight text-text-primary">
            Diagnose a repository state
          </h1>
          <p className="mt-3 text-text-secondary text-lg max-w-2xl">
            Send a snapshot for deterministic diagnosis, a recovery tree, and a safe rollback
            path with explicit undo at every step.
          </p>
        </div>

        <div className="grid lg:grid-cols-5 gap-8">
          {/* Main Upload Panel */}
          <div className="lg:col-span-3">
            <div className="relative rounded-xl border border-border-color bg-bg-secondary/90 backdrop-blur overflow-hidden">
              <div className="p-8">
                {/* CLI Command Section */}
                <div className="mb-8">
                  <div className="flex items-center gap-2 mb-3">
                    <Terminal className="w-4 h-4 text-accent-green" />
                    <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-text-muted">
                      Capture from your repo
                    </span>
                  </div>
                  <div className="flex items-center gap-3 bg-bg-primary border border-border-color rounded-lg p-4 font-mono text-sm">
                    <span className="text-text-muted select-none">$</span>
                    <code className="text-text-primary flex-1 !bg-transparent">
                      latchops snapshot --pretty &gt; snapshot.json
                    </code>
                    <button
                      type="button"
                      onClick={copyCommand}
                      aria-label="Copy command"
                      className="p-2 rounded-md border border-border-color bg-bg-tertiary hover:border-border-strong transition-colors"
                    >
                      {copied ? (
                        <Check className="w-4 h-4 text-accent-green" />
                      ) : (
                        <Copy className="w-4 h-4 text-text-muted" />
                      )}
                    </button>
                  </div>
                  {copyError && (
                    <p className="mt-2 text-xs text-accent-yellow" role="status">
                      {copyError}
                    </p>
                  )}
                </div>

                {/* Upload Area */}
                <form onSubmit={handleSubmit}>
                  <label
                    className={`relative block cursor-pointer transition-transform duration-300 ease-out-soft ${dragActive ? 'scale-[1.01]' : ''}`}
                    onDragEnter={handleDrag}
                    onDragLeave={handleDrag}
                    onDragOver={handleDrag}
                    onDrop={handleDrop}
                  >
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleFileChange}
                      className="hidden"
                      disabled={isProcessing}
                    />
                    <div className={`relative border border-dashed rounded-xl p-12 text-center transition-colors duration-300 ${
                      dragActive
                        ? 'border-accent-green bg-accent-green/5'
                        : file && stage !== 'error'
                        ? 'border-accent-green/50 bg-accent-green/5'
                        : stage === 'error'
                        ? 'border-accent-red/50 bg-accent-red/5'
                        : 'border-border-strong hover:border-accent-green/40 hover:bg-bg-tertiary/40'
                    }`}>
                      {/* Processing progress fill */}
                      {isProcessing && (
                        <div className="absolute inset-0 overflow-hidden rounded-xl" aria-hidden="true">
                          <div
                            className="absolute inset-y-0 left-0 bg-gradient-to-r from-accent-green/10 to-accent-blue/10 transition-all duration-300"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      )}

                      <div className="relative z-10">
                        {isProcessing ? (
                          <div className="flex flex-col items-center gap-4">
                            <div className="relative">
                              <div className="w-14 h-14 rounded-xl border border-accent-green/30 bg-accent-green/10 flex items-center justify-center">
                                <stageInfo.icon className="w-7 h-7 text-accent-green" />
                              </div>
                              <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-bg-secondary rounded-full flex items-center justify-center border border-accent-green/50">
                                <div className="w-2.5 h-2.5 border-2 border-accent-green border-t-transparent rounded-full animate-spin" />
                              </div>
                            </div>
                            <div>
                              <p className="font-medium text-text-primary">{stageInfo.label}</p>
                              <p className="font-mono text-xs text-text-muted mt-1">{Math.round(progress)}%</p>
                            </div>
                          </div>
                        ) : stage === 'complete' && result ? (
                          <div className="flex flex-col items-center gap-4">
                            <div className="w-14 h-14 rounded-xl border border-accent-green/40 bg-accent-green/10 flex items-center justify-center">
                              <CheckCircle2 className="w-7 h-7 text-accent-green" />
                            </div>
                            <div>
                              <p className="font-medium text-accent-green">Diagnosis complete</p>
                              <p className="text-sm text-text-muted mt-1">
                                {result.conflictCount > 0
                                  ? `${result.conflictCount} conflict${result.conflictCount > 1 ? 's' : ''} detected`
                                  : 'No conflicts found'}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-accent-blue">
                              <span>Opening incident room</span>
                              <ArrowRight className="w-4 h-4" />
                            </div>
                          </div>
                        ) : stage === 'error' ? (
                          <div className="flex flex-col items-center gap-4">
                            <div className="w-14 h-14 rounded-xl border border-accent-red/40 bg-accent-red/10 flex items-center justify-center">
                              <AlertCircle className="w-7 h-7 text-accent-red" />
                            </div>
                            <div>
                              <p className="font-medium text-accent-red">Diagnosis failed</p>
                              <p className="text-sm text-text-muted mt-1">{error}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => { setStage('idle'); setError(null); }}
                              className="btn text-sm"
                            >
                              Try again
                            </button>
                          </div>
                        ) : file ? (
                          <div className="flex flex-col items-center gap-4">
                            <div className="w-14 h-14 rounded-xl border border-accent-green/30 bg-accent-green/5 flex items-center justify-center">
                              <FileJson className="w-7 h-7 text-accent-green" />
                            </div>
                            <div>
                              <p className="font-medium text-text-primary">{file.name}</p>
                              <p className="font-mono text-xs text-text-muted mt-1">
                                {(file.size / 1024).toFixed(1)} KB · ready for diagnosis
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-4">
                            <div className="w-14 h-14 rounded-xl border border-border-strong bg-bg-tertiary flex items-center justify-center">
                              <Upload className="w-7 h-7 text-text-muted" />
                            </div>
                            <div>
                              <p className="font-medium text-text-primary">Drop your snapshot here</p>
                              <p className="text-sm text-text-muted mt-1">or click to browse files</p>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </label>
                </form>

                {/* Submit Button - Outside form to avoid label interference */}
                {file && stage === 'idle' && (
                  <button
                    type="button"
                    onClick={() => handleSubmit()}
                    className="btn btn-primary relative z-20 w-full mt-6 !py-3.5 text-base group"
                  >
                    <Sparkles className="w-5 h-5" />
                    Run diagnosis
                    <ArrowRight className="w-5 h-5 transition-transform duration-200 group-hover:translate-x-1" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Side Panel - Capabilities */}
          <div className="lg:col-span-2">
            <div className="rounded-xl border border-border-color divide-y divide-border-color overflow-hidden bg-bg-secondary/60">
              <SideItem
                icon={GitMerge}
                title="Merge conflicts"
                description="Conflict blocks with per-hunk explanations and resolution choices"
                tone="text-accent-yellow"
              />
              <SideItem
                icon={GitBranch}
                title="Detached HEAD"
                description="Navigate commit history and recover branch position safely"
                tone="text-accent-blue"
              />
              <SideItem
                icon={RotateCcw}
                title="Stuck rebases"
                description="Step-by-step recovery with full undo support at every stage"
                tone="text-accent-purple"
              />
              <SideItem
                icon={Shield}
                title="Reversible by design"
                description="Every action includes explicit undo paths using git reflog"
                tone="text-accent-green"
              />
            </div>
          </div>
        </div>

        {/* Guarantees strip */}
        <div className="mt-14 grid grid-cols-2 md:grid-cols-4 divide-x divide-border-color rounded-xl border border-border-color overflow-hidden">
          <StatCell value="100%" label="reversible actions" />
          <StatCell value="read-only" label="snapshot capture" />
          <StatCell value="schema" label="validated plans" />
          <StatCell value="reflog" label="safety fallback" />
        </div>
      </div>
    </main>
  );
}

function SideItem({
  icon: Icon,
  title,
  description,
  tone,
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  tone: string;
}) {
  return (
    <div className="group flex items-start gap-4 p-5 transition-colors duration-200 hover:bg-bg-tertiary/60">
      <div className={`p-2 rounded-lg border border-border-color bg-bg-primary ${tone}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-display text-sm font-semibold text-text-primary mb-1">{title}</h3>
        <p className="text-[13px] text-text-secondary leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

function StatCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="p-6 text-center bg-bg-secondary/40">
      <div className="font-display text-xl md:text-2xl font-bold text-accent-green">{value}</div>
      <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-text-muted mt-1.5">{label}</div>
    </div>
  );
}
