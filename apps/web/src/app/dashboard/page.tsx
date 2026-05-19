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
  Zap,
  CheckCircle2,
  AlertCircle,
  FileJson,
  Cpu,
  Activity,
  GitMerge,
  GitPullRequest,
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
    await navigator.clipboard.writeText('latchops snapshot --pretty > snapshot.json');
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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

      // Trigger plan generation
      await fetch(`/api/sessions/${sessionId}/plan`, {
        method: 'POST',
      });

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
        return { label: 'Uploading snapshot...', icon: Upload };
      case 'parsing':
        return { label: 'Parsing git state...', icon: FileJson };
      case 'analyzing':
        return { label: 'Analyzing conflicts...', icon: Cpu };
      case 'generating':
        return { label: 'Generating recovery plan...', icon: Sparkles };
      case 'complete':
        return { label: 'Analysis complete!', icon: CheckCircle2 };
      case 'error':
        return { label: 'Analysis failed', icon: AlertCircle };
      default:
        return { label: 'Ready to analyze', icon: Activity };
    }
  };

  const stageInfo = getStageInfo();
  const isProcessing = ['uploading', 'parsing', 'analyzing', 'generating'].includes(stage);

  return (
    <main className="min-h-screen bg-bg-primary relative overflow-hidden">
      {/* Animated Background */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/2 -left-1/2 w-full h-full bg-gradient-radial from-accent-blue/5 via-transparent to-transparent animate-pulse" style={{ animationDuration: '4s' }} />
        <div className="absolute -bottom-1/2 -right-1/2 w-full h-full bg-gradient-radial from-accent-purple/5 via-transparent to-transparent animate-pulse" style={{ animationDuration: '5s', animationDelay: '1s' }} />
        <div className="absolute top-1/4 right-1/4 w-96 h-96 bg-accent-green/3 rounded-full blur-3xl animate-float" />
        <div className="absolute bottom-1/4 left-1/4 w-64 h-64 bg-accent-blue/3 rounded-full blur-3xl animate-float" style={{ animationDelay: '2s' }} />
      </div>

      <Header />

      <div className="relative max-w-6xl mx-auto px-6 py-12">
        {/* Hero Section */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-accent-green/10 border border-accent-green/20 text-accent-green text-sm font-medium mb-6">
            <Zap className="w-4 h-4" />
            AI-Powered Git Recovery
          </div>
          <h1 className="text-4xl md:text-5xl font-bold mb-4 bg-gradient-to-r from-text-primary via-accent-blue to-accent-purple bg-clip-text text-transparent">
            Git Recovery Command Center
          </h1>
          <p className="text-text-secondary text-lg max-w-2xl mx-auto">
            Upload your repository snapshot for intelligent conflict analysis,
            step-by-step recovery plans, and safe resolution guidance.
          </p>
        </div>

        <div className="grid lg:grid-cols-5 gap-8">
          {/* Main Upload Panel */}
          <div className="lg:col-span-3">
            <div className="relative bg-gradient-to-b from-bg-secondary to-bg-secondary/50 border border-border-color rounded-2xl overflow-hidden backdrop-blur-sm">
              {/* Glow effect */}
              <div className="absolute inset-0 bg-gradient-to-b from-accent-blue/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

              <div className="p-8">
                {/* CLI Command Section */}
                <div className="mb-8">
                  <div className="flex items-center gap-2 mb-3">
                    <Terminal className="w-5 h-5 text-accent-green" />
                    <span className="text-sm font-medium text-text-secondary">Generate snapshot with CLI</span>
                  </div>
                  <div className="relative group">
                    <div className="flex items-center gap-3 bg-bg-primary/80 border border-border-color rounded-xl p-4 font-mono text-sm">
                      <span className="text-accent-purple">$</span>
                      <code className="text-accent-green flex-1">latchops snapshot --pretty &gt; snapshot.json</code>
                      <button
                        onClick={copyCommand}
                        className="p-2 rounded-lg bg-bg-tertiary hover:bg-border-color transition-colors"
                      >
                        {copied ? (
                          <Check className="w-4 h-4 text-accent-green" />
                        ) : (
                          <Copy className="w-4 h-4 text-text-muted" />
                        )}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Upload Area */}
                <form onSubmit={handleSubmit}>
                  <label
                    className={`relative block cursor-pointer transition-all duration-300 ${dragActive ? 'scale-[1.02]' : ''}`}
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
                    <div className={`relative border-2 border-dashed rounded-2xl p-12 text-center transition-all duration-300 ${
                      dragActive
                        ? 'border-accent-blue bg-accent-blue/5 shadow-lg shadow-accent-blue/10'
                        : file && stage !== 'error'
                        ? 'border-accent-green/50 bg-accent-green/5'
                        : stage === 'error'
                        ? 'border-accent-red/50 bg-accent-red/5'
                        : 'border-border-color hover:border-accent-blue/50 hover:bg-bg-tertiary/30'
                    }`}>
                      {/* Processing Animation */}
                      {isProcessing && (
                        <div className="absolute inset-0 overflow-hidden rounded-2xl">
                          <div
                            className="absolute inset-y-0 left-0 bg-gradient-to-r from-accent-blue/20 via-accent-purple/20 to-accent-blue/20 transition-all duration-300"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      )}

                      <div className="relative z-10">
                        {isProcessing ? (
                          <div className="flex flex-col items-center gap-4">
                            <div className="relative">
                              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-blue to-accent-purple flex items-center justify-center animate-pulse">
                                <stageInfo.icon className="w-8 h-8 text-white" />
                              </div>
                              <div className="absolute -bottom-1 -right-1 w-6 h-6 bg-bg-secondary rounded-full flex items-center justify-center border-2 border-accent-blue">
                                <div className="w-3 h-3 border-2 border-accent-blue border-t-transparent rounded-full animate-spin" />
                              </div>
                            </div>
                            <div>
                              <p className="text-lg font-medium text-text-primary">{stageInfo.label}</p>
                              <p className="text-sm text-text-muted mt-1">{Math.round(progress)}% complete</p>
                            </div>
                          </div>
                        ) : stage === 'complete' && result ? (
                          <div className="flex flex-col items-center gap-4">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-green to-accent-blue flex items-center justify-center">
                              <CheckCircle2 className="w-8 h-8 text-white" />
                            </div>
                            <div>
                              <p className="text-lg font-medium text-accent-green">Analysis Complete!</p>
                              <p className="text-sm text-text-muted mt-1">
                                {result.conflictCount > 0
                                  ? `${result.conflictCount} conflict${result.conflictCount > 1 ? 's' : ''} detected`
                                  : 'No conflicts found'}
                              </p>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-accent-blue">
                              <span>Redirecting to recovery room</span>
                              <ArrowRight className="w-4 h-4 animate-pulse" />
                            </div>
                          </div>
                        ) : stage === 'error' ? (
                          <div className="flex flex-col items-center gap-4">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-red to-accent-yellow flex items-center justify-center">
                              <AlertCircle className="w-8 h-8 text-white" />
                            </div>
                            <div>
                              <p className="text-lg font-medium text-accent-red">Analysis Failed</p>
                              <p className="text-sm text-text-muted mt-1">{error}</p>
                            </div>
                            <button
                              type="button"
                              onClick={() => { setStage('idle'); setError(null); }}
                              className="px-4 py-2 text-sm bg-bg-tertiary rounded-lg hover:bg-border-color transition-colors"
                            >
                              Try Again
                            </button>
                          </div>
                        ) : file ? (
                          <div className="flex flex-col items-center gap-4">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent-green/20 to-accent-blue/20 border border-accent-green/30 flex items-center justify-center">
                              <FileJson className="w-8 h-8 text-accent-green" />
                            </div>
                            <div>
                              <p className="text-lg font-medium text-accent-green">{file.name}</p>
                              <p className="text-sm text-text-muted mt-1">
                                {(file.size / 1024).toFixed(1)} KB - Ready for analysis
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="flex flex-col items-center gap-4">
                            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-bg-tertiary to-bg-secondary border border-border-color flex items-center justify-center group-hover:border-accent-blue/50 transition-colors">
                              <Upload className="w-8 h-8 text-text-muted" />
                            </div>
                            <div>
                              <p className="text-lg font-medium text-text-primary">Drop your snapshot here</p>
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
                    className="relative z-20 w-full mt-6 py-4 rounded-xl bg-gradient-to-r from-accent-green to-accent-blue text-white font-semibold text-lg hover:shadow-lg hover:shadow-accent-green/20 transition-all duration-300 flex items-center justify-center gap-3 group cursor-pointer"
                  >
                    <Sparkles className="w-5 h-5 group-hover:animate-pulse" />
                    Start AI Analysis
                    <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-transform" />
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* Side Panel - Features */}
          <div className="lg:col-span-2 space-y-4">
            {/* Feature Cards */}
            <FeatureCard
              icon={GitMerge}
              title="Merge Conflicts"
              description="Visual diff viewer with AI-powered conflict explanations and resolution suggestions"
              color="yellow"
            />
            <FeatureCard
              icon={GitBranch}
              title="Detached HEAD"
              description="Safely navigate commit history and recover your branch position"
              color="blue"
            />
            <FeatureCard
              icon={RotateCcw}
              title="Stuck Rebases"
              description="Step-by-step recovery with full undo support at every stage"
              color="purple"
            />
            <FeatureCard
              icon={Shield}
              title="Reversible by Design"
              description="Every action includes explicit undo paths using git reflog"
              color="green"
            />
          </div>
        </div>

        {/* Stats Section */}
        <div className="mt-16 grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard value="100%" label="Reversible Actions" />
          <StatCard value="< 30s" label="Analysis Time" />
          <StatCard value="AI" label="Powered Recovery" />
          <StatCard value="Reflog" label="Safety Fallback" />
        </div>
      </div>

      <style jsx>{`
        @keyframes float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-20px); }
        }
        .animate-float {
          animation: float 6s ease-in-out infinite;
        }
      `}</style>
    </main>
  );
}

function FeatureCard({
  icon: Icon,
  title,
  description,
  color
}: {
  icon: React.ElementType;
  title: string;
  description: string;
  color: 'yellow' | 'blue' | 'purple' | 'green';
}) {
  const colorClasses = {
    yellow: 'from-accent-yellow/20 to-accent-yellow/5 border-accent-yellow/30 hover:border-accent-yellow/50',
    blue: 'from-accent-blue/20 to-accent-blue/5 border-accent-blue/30 hover:border-accent-blue/50',
    purple: 'from-accent-purple/20 to-accent-purple/5 border-accent-purple/30 hover:border-accent-purple/50',
    green: 'from-accent-green/20 to-accent-green/5 border-accent-green/30 hover:border-accent-green/50',
  };

  const iconColors = {
    yellow: 'text-accent-yellow',
    blue: 'text-accent-blue',
    purple: 'text-accent-purple',
    green: 'text-accent-green',
  };

  return (
    <div className={`group p-5 rounded-xl bg-gradient-to-br ${colorClasses[color]} border transition-all duration-300 hover:shadow-lg cursor-default`}>
      <div className="flex items-start gap-4">
        <div className={`p-2.5 rounded-lg bg-bg-primary/50 ${iconColors[color]}`}>
          <Icon className="w-5 h-5" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className={`font-semibold ${iconColors[color]} mb-1`}>{title}</h3>
          <p className="text-sm text-text-secondary leading-relaxed">{description}</p>
        </div>
      </div>
    </div>
  );
}

function StatCard({ value, label }: { value: string; label: string }) {
  return (
    <div className="p-6 rounded-xl bg-bg-secondary/50 border border-border-color text-center hover:border-accent-blue/30 transition-colors">
      <div className="text-2xl md:text-3xl font-bold bg-gradient-to-r from-accent-blue to-accent-purple bg-clip-text text-transparent">
        {value}
      </div>
      <div className="text-sm text-text-muted mt-1">{label}</div>
    </div>
  );
}
