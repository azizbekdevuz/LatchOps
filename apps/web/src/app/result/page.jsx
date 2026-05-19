'use client';
import Link from 'next/link'
import { useState } from 'react';

const LatchOpsResult = () => {

    const [expandedSteps, setExpandedSteps] = useState({});
    const [copiedCommand, setCopiedCommand] = useState(null);

    const toggleStep = (index) => {
        setExpandedSteps(prev => ({
            ...prev,
            [index]: !prev[index]
        }));
    };

    const copyToClipboard = (text, id) => {
        navigator.clipboard.writeText(text);
        setCopiedCommand(id);
        setTimeout(() => setCopiedCommand(null), 2000);
    };

    const exportToTxt = () => {
        if (!analysisResult) return;

        const content = `
Issue: ${analysisResult.issue}
Risk Level: ${analysisResult.riskLevel}

Steps:
${analysisResult.steps.map(
            (step, i) =>
                `${i + 1}. ${step.step}\n   Command: ${step.command}\n   Undo: ${step.undo}`
        ).join('\n')}
`;

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'latchops_result.txt';
        a.click();
        URL.revokeObjectURL(url);
    };

    const analysisResult = {
        issue: "Merge Conflict",
        riskLevel: "high",
        steps: [
            {
                step: "Create a temporary branch to save your work",
                command: "git checkout -b temp-recovery-branch",
                undo: "git branch -D temp-recovery-branch"
            },
            {
                step: "Stage all uncommitted changes",
                command: "git add .",
                undo: "git reset HEAD"
            },
            {
                step: "Commit the staged changes",
                command: "git commit -m \"Recovery: saved detached HEAD changes\"",
                undo: "git reset --soft HEAD~1"
            },
            {
                step: "Return to your main branch",
                command: "git checkout main",
                undo: "git checkout temp-recovery-branch"
            }
        ]
    };

    const riskStyles = {
        high: { badge: 'bg-red-500/10 border-red-500/30 text-red-500', dot: 'bg-red-500 shadow-red-500/50' },
        medium: { badge: 'bg-amber-500/10 border-amber-500/30 text-amber-500', dot: 'bg-amber-500 shadow-amber-500/50' },
        low: { badge: 'bg-green-500/10 border-green-500/30 text-green-500', dot: 'bg-green-500 shadow-green-500/50' }
    };

    const risk = riskStyles[analysisResult.riskLevel] || riskStyles.low;

    return (
        <div className="min-h-screen bg-neutral-950 text-neutral-200 font-sans"
            style={{
                backgroundImage: `
          linear-gradient(rgba(34, 197, 94, 0.03) 1px, transparent 1px),
          linear-gradient(90deg, rgba(34, 197, 94, 0.03) 1px, transparent 1px)
        `,
                backgroundSize: '50px 50px'
            }}>
           
            {/* Main Content */}
            <main className="max-w-3xl mx-auto px-6 py-12">

                {/* Back Button */}
                <Link href="../" className="flex items-center gap-2 text-neutral-400 text-sm mb-8 hover:text-neutral-200 transition-colors">
                    <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M19 12H5M12 19l-7-7 7-7" />
                    </svg>
                    Back to Upload
                </Link>

                {/* Analysis Complete Header */}
                <div className="mb-8">
                    <div className="flex items-center gap-3 mb-2">
                        <div className="w-6 h-6 rounded-full bg-green-500/15 flex items-center justify-center">
                            <svg className="w-3.5 h-3.5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                <polyline points="20 6 9 17 4 12" />
                            </svg>
                        </div>
                        <span className="text-green-500 text-sm font-medium">Analysis Complete</span>
                    </div>
                    <h1 className="text-2xl font-bold text-white mb-2 tracking-tight">Recovery Plan Ready</h1>
                    <p className="text-neutral-500 text-sm">
                        We've analyzed your repository and prepared a safe recovery plan.
                    </p>
                </div>

                {/* Issue Card */}
                <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6 mb-6">
                    {/* Issue Header */}
                    <div className="mb-5">
                        <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-semibold uppercase tracking-widest text-neutral-500">
                                Issue Detected
                            </span>
                            <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${risk.badge}`}>
                                <div className={`w-2 h-2 rounded-full shadow-lg ${risk.dot}`} />
                                <span className="text-xs font-semibold uppercase">
                                    {analysisResult.riskLevel} Risk
                                </span>
                            </div>
                        </div>
                        <h2 className="text-lg font-semibold text-white mb-2">{analysisResult.issue}</h2>
                    </div>

                    {/* Affected Files */}
                </div>

                {/* Resolution Steps */}
                <div className="bg-white/[0.02] border border-white/[0.08] rounded-2xl p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div>
                            <h3 className="text-base font-semibold text-white mb-1">Resolution Steps</h3>
                            <p className="text-xs text-neutral-500">
                                Execute each step in order. All commands are verified safe.
                            </p>
                        </div>
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20">
                            <svg className="w-3.5 h-3.5 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                            </svg>
                            <span className="text-xs font-medium text-green-500">Safe Commands</span>
                        </div>
                    </div>

                    {/* Steps */}
                    <div className="flex flex-col gap-3">
                        {analysisResult.steps.map((step, index) => (
                            <div key={index} className="bg-black/30 rounded-xl border border-white/[0.06] overflow-hidden">
                                {/* Step Header */}
                                <button
                                    onClick={() => toggleStep(index)}
                                    className="w-full flex items-center gap-4 p-4 text-left hover:bg-white/[0.02] transition-colors"
                                >
                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm shrink-0 transition-all duration-200 ${expandedSteps[index]
                                        ? 'bg-green-500 text-neutral-950'
                                        : 'bg-white/[0.08] text-neutral-400'
                                        }`}>
                                        {index + 1}
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm font-medium text-white mb-0.5">{step.step}</div>
                                    </div>
                                    <svg
                                        className={`w-5 h-5 text-neutral-500 transition-transform duration-200 ${expandedSteps[index] ? 'rotate-180' : ''
                                            }`}
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                    >
                                        <polyline points="6 9 12 15 18 9" />
                                    </svg>
                                </button>

                                {/* Step Details */}
                                {expandedSteps[index] && (
                                    <div className="px-4 pb-4 flex flex-col gap-3">
                                        {/* Command */}
                                        <div>
                                            <div className="text-[11px] font-semibold uppercase tracking-widest text-green-500 mb-2">
                                                Command
                                            </div>
                                            <div className="flex items-center gap-3 bg-black/40 rounded-lg px-4 py-3 border border-green-500/20">
                                                <code className="flex-1 font-mono text-sm text-green-500 break-all">
                                                    {step.command}
                                                </code>
                                                <button
                                                    onClick={() => copyToClipboard(step.command, `cmd-${index}`)}
                                                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-all duration-200 shrink-0 ${copiedCommand === `cmd-${index}`
                                                        ? 'bg-green-500 text-neutral-950'
                                                        : 'bg-white/10 text-neutral-400 hover:bg-white/15'
                                                        }`}
                                                >
                                                    {copiedCommand === `cmd-${index}` ? (
                                                        <>
                                                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                                                <polyline points="20 6 9 17 4 12" />
                                                            </svg>
                                                            Copied
                                                        </>
                                                    ) : (
                                                        <>
                                                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                                            </svg>
                                                            Copy
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </div>

                                        {/* Undo */}
                                        <div>
                                            <div className="text-[11px] font-semibold uppercase tracking-widest text-neutral-500 mb-2">
                                                Undo
                                            </div>
                                            <div className="flex items-center gap-3 bg-black/40 rounded-lg px-4 py-3 border border-white/[0.06]">
                                                <code className="flex-1 font-mono text-sm text-neutral-400 break-all">
                                                    {step.undo}
                                                </code>
                                                <button
                                                    onClick={() => copyToClipboard(step.undo, `undo-${index}`)}
                                                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs transition-all duration-200 shrink-0 ${copiedCommand === `undo-${index}`
                                                        ? 'bg-green-500 text-neutral-950'
                                                        : 'bg-white/10 text-neutral-400 hover:bg-white/15'
                                                        }`}
                                                >
                                                    {copiedCommand === `undo-${index}` ? (
                                                        <>
                                                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                                                                <polyline points="20 6 9 17 4 12" />
                                                            </svg>
                                                            Copied
                                                        </>
                                                    ) : (
                                                        <>
                                                            <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                                            </svg>
                                                            Copy
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>

                {/* Footer Actions */}
                <div className="flex justify-between items-center mt-6 pt-6 border-t border-white/[0.06]">
                    <div className="flex items-center gap-2 text-xs text-neutral-500">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                        </svg>
                        All commands verified safe before execution
                    </div>
                    <button
                        onClick={exportToTxt}
                        className="flex items-center gap-2 px-6 py-3 bg-green-500 rounded-xl text-sm font-semibold text-neutral-950 hover:bg-green-400 transition-colors">
                        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                            <polyline points="7 10 12 15 17 10" />
                            <line x1="12" y1="15" x2="12" y2="3" />
                        </svg>
                        Export Plan
                    </button>
                </div>
            </main>
        </div>
    );
};

export default LatchOpsResult;
