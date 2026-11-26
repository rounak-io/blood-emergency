import React from 'react';
import {
  Activity,
  AlertTriangle,
  Bot,
  Clock,
  Droplet,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  SkipForward,
  Sparkles,
  Truck,
  Users,
} from 'lucide-react';
import { SEASON_PROFILES } from '../engine/constants';
import { EngineMode } from '../engine/apiClient';
import { NetworkState, SeasonRegime } from '../types/network';

interface TopCommandBarProps {
  state: NetworkState;
  engineMode: EngineMode;
  geminiEnabled: boolean;
  isPlaying: boolean;
  simSpeed: 1 | 6 | 24;
  onTogglePlay: () => void;
  onChangeSpeed: (s: 1 | 6 | 24) => void;
  onStepHours: (h: number) => void;
  onReset: () => void;
  onChangeSeason: (season: SeasonRegime) => void;
  onOpenCopilot: () => void;
}

export const TopCommandBar: React.FC<TopCommandBarProps> = ({
  state,
  engineMode,
  geminiEnabled,
  isPlaying,
  simSpeed,
  onTogglePlay,
  onChangeSpeed,
  onStepHours,
  onReset,
  onChangeSeason,
  onOpenCopilot,
}) => {
  const totalUnits = state.facilities.reduce(
    (acc, f) =>
      acc +
      Object.values(f.inventory).reduce(
        (sAcc, slot) => sAcc + slot.batches.reduce((bAcc, b) => bAcc + b.units, 0),
        0
      ),
    0
  );
  const criticalSlots = state.facility_risks.reduce((acc, f) => acc + f.critical_slots, 0);
  const expiring24h = state.regions.reduce((acc, r) => acc + r.expiring_24h, 0);
  const activeDispatches = state.transfers.filter((t) => t.status === 'IN_TRANSIT').length;
  const mobilizedDonors = state.donors.filter((d) => d.mobilized).length;

  return (
    <header className="border-b border-slate-800/80 bg-[#0A101B]/95 backdrop-blur-md sticky top-0 z-30">
      <div className="max-w-[1600px] mx-auto px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        {/* Brand + Engine Badge */}
        <div className="flex items-center gap-3">
          <div className="relative flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500/25 to-red-700/25 border border-rose-500/40 shadow-lg shadow-rose-950/30">
            <Droplet className="h-5 w-5 text-rose-400 fill-rose-500/30" />
            <span className="absolute -top-1 -right-1 flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-500" />
            </span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-base font-bold tracking-tight text-white">
                HemoPulse <span className="text-rose-400">AI</span>
              </h1>
              <span
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium border ${
                  engineMode === 'PYTHON_BACKEND'
                    ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
                    : 'bg-sky-500/10 text-sky-300 border-sky-500/30'
                }`}
              >
                <Activity className="h-2.5 w-2.5" />
                {engineMode === 'PYTHON_BACKEND' ? 'PYTHON AI ENGINE' : 'IN-BROWSER ENGINE'}
              </span>
              {geminiEnabled && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono bg-violet-500/15 text-violet-300 border border-violet-500/30">
                  <Sparkles className="h-2.5 w-2.5" /> GEMINI READY
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-400">
              Predictive Emergency Blood Shortage &amp; Cold-Chain Coordination Network
            </p>
          </div>
        </div>

        {/* Live Telemetry KPI Strip */}
        <div className="hidden xl:flex items-center gap-2">
          <div className="px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Network Stock</div>
              <div className="text-xs font-bold font-mono tabular-nums text-white">{totalUnits} units</div>
            </div>
          </div>
          <div
            className={`px-3 py-1.5 rounded-lg border flex items-center gap-2 ${
              criticalSlots > 0
                ? 'bg-rose-950/40 border-rose-500/40'
                : 'bg-slate-900/90 border-slate-800'
            }`}
          >
            <AlertTriangle
              className={`h-4 w-4 ${criticalSlots > 0 ? 'text-rose-400 animate-pulse' : 'text-slate-400'}`}
            />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Critical (&lt;12h)</div>
              <div
                className={`text-xs font-bold font-mono tabular-nums ${
                  criticalSlots > 0 ? 'text-rose-300' : 'text-emerald-300'
                }`}
              >
                {criticalSlots} slots
              </div>
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Expiring &lt;24h</div>
              <div className="text-xs font-bold font-mono tabular-nums text-amber-300">{expiring24h} units</div>
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center gap-2">
            <Truck className="h-4 w-4 text-sky-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Cold-Chain</div>
              <div className="text-xs font-bold font-mono tabular-nums text-sky-300">{activeDispatches} active</div>
            </div>
          </div>
          <div className="px-3 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center gap-2">
            <Users className="h-4 w-4 text-violet-400" />
            <div>
              <div className="text-[10px] uppercase tracking-wider text-slate-400">Donors Alerted</div>
              <div className="text-xs font-bold font-mono tabular-nums text-violet-300">{mobilizedDonors}</div>
            </div>
          </div>
        </div>

        {/* Simulation Controls, Season Regime & AI Copilot */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Seasonal Demand Regime"
            value={state.season}
            onChange={(e) => onChangeSeason(e.target.value as SeasonRegime)}
            className="bg-slate-900 border border-slate-700/80 text-slate-200 text-xs rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-rose-500"
          >
            {(Object.keys(SEASON_PROFILES) as SeasonRegime[]).map((key) => (
              <option key={key} value={key}>
                {SEASON_PROFILES[key].label}
              </option>
            ))}
          </select>

          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg p-0.5 gap-0.5">
            <span className="px-2 text-[11px] font-mono tabular-nums text-slate-300">
              T+{state.sim_hour.toFixed(1)}h
            </span>
            <button
              onClick={onTogglePlay}
              title={isPlaying ? 'Pause simulation' : 'Run live simulation'}
              className={`p-1.5 rounded-md transition ${
                isPlaying
                  ? 'bg-amber-500/20 text-amber-300'
                  : 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
              }`}
            >
              {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            {([1, 6, 24] as const).map((spd) => (
              <button
                key={spd}
                onClick={() => onChangeSpeed(spd)}
                className={`px-1.5 py-1 text-[10px] font-mono rounded ${
                  simSpeed === spd
                    ? 'bg-slate-700 text-white font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {spd}x
              </button>
            ))}
            <button
              onClick={() => onStepHours(4)}
              title="Advance +4 hours"
              className="px-2 py-1 text-[10px] font-mono text-sky-300 hover:bg-slate-800 rounded flex items-center gap-0.5"
            >
              <SkipForward className="h-3 w-3" /> +4h
            </button>
            <button
              onClick={onReset}
              title="Reset network simulation"
              className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          </div>

          <button
            onClick={onOpenCopilot}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-gradient-to-r from-rose-600 to-violet-600 hover:from-rose-500 hover:to-violet-500 text-white text-xs font-semibold shadow-md shadow-rose-950/40 transition"
          >
            <Bot className="h-3.5 w-3.5" />
            AI Crisis Copilot
          </button>
        </div>
      </div>
    </header>
  );
};
