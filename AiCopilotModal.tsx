import React, { useEffect, useState } from 'react';
import { Bot, Download, Send, Sparkles, Terminal, X } from 'lucide-react';
import { EngineMode, requestAiBriefing } from '../engine/apiClient';
import { AiBriefingResponse, NetworkState } from '../types/network';

interface AiCopilotModalProps {
  open: boolean;
  onClose: () => void;
  state: NetworkState;
  engineMode: EngineMode;
}

const PRESET_QUESTIONS = [
  'Which region and hospital face the highest O- shortage risk right now?',
  'How can we prevent near-expiry wastage using FEFO transfers?',
  'Recommend a 12-hour disaster surge readiness plan for Central Metro.',
];

export const AiCopilotModal: React.FC<AiCopilotModalProps> = ({
  open,
  onClose,
  state,
  engineMode,
}) => {
  const [question, setQuestion] = useState('');
  const [loading, setLoading] = useState(false);
  const [brief, setBrief] = useState<AiBriefingResponse | null>(null);

  const runBrief = async (q?: string) => {
    setLoading(true);
    const res = await requestAiBriefing(engineMode, state, q);
    setBrief(res);
    setLoading(false);
  };

  useEffect(() => {
    if (open) {
      runBrief();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const exportSnapshot = () => {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hemopulse-network-T+${state.sim_hour.toFixed(1)}h.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0B1220] border border-slate-700/80 rounded-2xl max-w-4xl w-full max-h-[88vh] flex flex-col overflow-hidden shadow-2xl">
        {/* Header */}
        <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between bg-slate-900/60">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-gradient-to-br from-rose-500/20 to-violet-500/20 border border-violet-500/40">
              <Bot className="h-5 w-5 text-violet-300" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                HemoPulse AI Crisis Copilot &amp; Audit Console
                {brief && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-violet-500/15 text-violet-300 border border-violet-500/30 flex items-center gap-1">
                    <Sparkles className="h-2.5 w-2.5" /> {brief.provider}
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-slate-400">
                Real-time clinical logistics synthesis powered by live network telemetry
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportSnapshot}
              className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium flex items-center gap-1.5"
            >
              <Download className="h-3.5 w-3.5" /> Export JSON
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* AI Briefing Pane */}
          <div className="lg:col-span-7 space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {PRESET_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => {
                    setQuestion(q);
                    runBrief(q);
                  }}
                  className="text-left px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-700/80 text-[11px] text-slate-300 transition"
                >
                  {q}
                </button>
              ))}
            </div>

            <div className="rounded-xl bg-slate-950/70 border border-slate-800 p-4 min-h-[260px] text-xs text-slate-200 whitespace-pre-wrap leading-relaxed font-sans">
              {loading ? (
                <div className="text-violet-300 animate-pulse font-mono">
                  Synthesizing predictive telemetry &amp; FEFO optimization routes...
                </div>
              ) : (
                brief?.briefing ?? 'Ready.'
              )}
            </div>

            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (question.trim()) runBrief(question.trim());
              }}
              className="flex gap-2"
            >
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Ask AI Commander about shortages, FEFO swaps, or surge response..."
                className="flex-1 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold flex items-center gap-1.5"
              >
                <Send className="h-3.5 w-3.5" /> Ask
              </button>
            </form>
          </div>

          {/* Live Audit Log */}
          <div className="lg:col-span-5 bg-slate-950/60 border border-slate-800 rounded-xl p-3 flex flex-col">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-300 flex items-center gap-1.5 mb-2">
              <Terminal className="h-3.5 w-3.5 text-emerald-400" />
              Immutable Network Audit Log
            </div>
            <div className="flex-1 max-h-[340px] overflow-y-auto space-y-1.5 pr-1 font-mono text-[11px]">
              {state.audit_log.map((entry) => (
                <div
                  key={entry.id}
                  className="p-2 rounded-lg bg-slate-900/70 border border-slate-800/80"
                >
                  <div className="flex justify-between text-[10px] text-slate-400 mb-0.5">
                    <span className="text-sky-300 font-semibold">[{entry.category}]</span>
                    <span>T+{entry.sim_hour.toFixed(1)}h</span>
                  </div>
                  <div className="text-slate-200">{entry.message}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
