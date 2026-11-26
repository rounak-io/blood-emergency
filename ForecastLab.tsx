import React, { useEffect, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BrainCircuit,
  Calendar,
  Flame,
  TrendingUp,
} from 'lucide-react';
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { EngineMode, fetchForecast } from '../engine/apiClient';
import { SEASON_PROFILES } from '../engine/constants';
import {
  BLOOD_TYPES,
  BloodType,
  ForecastPayload,
  NetworkState,
} from '../types/network';

interface ForecastLabProps {
  state: NetworkState;
  engineMode: EngineMode;
  facilityId: string;
  bloodType: BloodType;
  onSelectTarget: (facilityId: string, bloodType: BloodType) => void;
  onInjectCustomSurge: (payload: {
    facility_id: string;
    blood_type: BloodType;
    multiplier: number;
    duration_hours: number;
    label: string;
  }) => void;
}

export const ForecastLab: React.FC<ForecastLabProps> = ({
  state,
  engineMode,
  facilityId,
  bloodType,
  onSelectTarget,
  onInjectCustomSurge,
}) => {
  const [payload, setPayload] = useState<ForecastPayload | null>(null);
  const [surgeMult, setSurgeMult] = useState(2.0);
  const [surgeLabel, setSurgeLabel] = useState('Mass Casualty / Highway Pileup');

  useEffect(() => {
    let active = true;
    fetchForecast(engineMode, state, facilityId, bloodType).then((res) => {
      if (active) setPayload(res);
    });
    return () => {
      active = false;
    };
  }, [engineMode, state, facilityId, bloodType]);

  const combinedDemandSeries = React.useMemo(() => {
    if (!payload) return [];
    const histTail = payload.history_30d_daily.slice(-14).map((val, idx) => ({
      label: `D-${14 - idx}`,
      historical: val,
      predicted: null as number | null,
      band95: null as [number, number] | null,
      band80: null as [number, number] | null,
    }));
    const future = payload.forecast.daily_forecast.map((d) => ({
      label: d.day,
      historical: null as number | null,
      predicted: d.predicted_demand,
      band95: [d.lower_95, d.upper_95] as [number, number],
      band80: [d.lower_80, d.upper_80] as [number, number],
    }));
    return [...histTail, ...future];
  }, [payload]);

  const weeklyBars = React.useMemo(() => {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return (payload?.forecast.weekly_seasonality_indices ?? []).map((val, i) => ({
      day: days[i] ?? `D${i}`,
      index: Number((val * 100).toFixed(0)),
    }));
  }, [payload]);

  return (
    <div className="space-y-4">
      {/* Top Controls */}
      <div className="bg-[#0B1220] border border-slate-800/90 rounded-2xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-sky-500/15 border border-sky-500/30">
            <BrainCircuit className="h-5 w-5 text-sky-400" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-white">
              AI Predictive Demand &amp; Stockout Forecasting Lab
            </h2>
            <p className="text-xs text-slate-400">
              {payload?.forecast.model ?? 'Holt-Winters Damped Trend + 7d Seasonal Decomposition'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={facilityId}
            onChange={(e) => onSelectTarget(e.target.value, bloodType)}
            className="bg-slate-900 border border-slate-700 text-slate-100 text-xs rounded-xl px-3 py-2"
          >
            {state.facilities.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} — {f.name}
              </option>
            ))}
          </select>
          <div className="flex bg-slate-900 border border-slate-800 rounded-xl p-0.5">
            {BLOOD_TYPES.map((bt) => (
              <button
                key={bt}
                onClick={() => onSelectTarget(facilityId, bt)}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-mono font-semibold transition ${
                  bt === bloodType
                    ? 'bg-rose-600 text-white'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {bt}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Metrics Summary Strip */}
      {payload && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-[#0B1220] border border-slate-800 rounded-xl p-3">
            <div className="text-[10px] uppercase text-slate-400">Current Inventory</div>
            <div className="text-xl font-bold font-mono text-white mt-0.5 tabular-nums">
              {payload.metrics.total_units} units
            </div>
          </div>
          <div className="bg-[#0B1220] border border-slate-800 rounded-xl p-3">
            <div className="text-[10px] uppercase text-slate-400">Effective Burn Rate</div>
            <div className="text-xl font-bold font-mono text-sky-300 mt-0.5 tabular-nums">
              {payload.metrics.effective_hourly_burn.toFixed(2)} u/hr
            </div>
          </div>
          <div className="bg-[#0B1220] border border-slate-800 rounded-xl p-3">
            <div className="text-[10px] uppercase text-slate-400">Projected Runway</div>
            <div
              className={`text-xl font-bold font-mono mt-0.5 tabular-nums ${
                payload.metrics.risk_level === 'CRITICAL'
                  ? 'text-rose-400'
                  : payload.metrics.risk_level === 'WATCH'
                    ? 'text-amber-400'
                    : 'text-emerald-400'
              }`}
            >
              {payload.metrics.hours_of_supply}h
            </div>
          </div>
          <div className="bg-[#0B1220] border border-slate-800 rounded-xl p-3">
            <div className="text-[10px] uppercase text-slate-400">14-Day Stockout ETA</div>
            <div className="text-xl font-bold font-mono text-amber-300 mt-0.5 tabular-nums">
              {payload.forecast.predicted_stockout_day
                ? `Day +${payload.forecast.predicted_stockout_day}`
                : 'No Stockout'}
            </div>
          </div>
          <div className="bg-[#0B1220] border border-slate-800 rounded-xl p-3">
            <div className="text-[10px] uppercase text-slate-400">Seasonal Regime</div>
            <div className="text-xs font-semibold text-violet-300 mt-1.5">
              {SEASON_PROFILES[state.season].label}
            </div>
          </div>
        </div>
      )}

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* 14-Day Demand + Historical Consumption */}
        <div className="bg-[#0B1220] border border-slate-800/90 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                <TrendingUp className="h-4 w-4 text-sky-400" />
                30d Historical Consumption &amp; 14d Forecast (80%/95% CI)
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Daily demand units incorporating seasonal factor &amp; damped trend slope (
                {payload?.forecast.trend_slope_daily ?? 0} u/day)
              </p>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={combinedDemandSeries}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis dataKey="label" tick={{ fill: '#94A3B8', fontSize: 10 }} />
                <YAxis tick={{ fill: '#94A3B8', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    border: '1px solid #334155',
                    borderRadius: '10px',
                    fontSize: '11px',
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="band95"
                  stroke="none"
                  fill="#38BDF8"
                  fillOpacity={0.14}
                  name="95% Confidence Band"
                />
                <Area
                  type="monotone"
                  dataKey="band80"
                  stroke="none"
                  fill="#38BDF8"
                  fillOpacity={0.26}
                  name="80% Confidence Band"
                />
                <Line
                  type="monotone"
                  dataKey="historical"
                  stroke="#94A3B8"
                  strokeWidth={2}
                  dot={{ r: 2 }}
                  name="Historical Daily Burn"
                />
                <Line
                  type="monotone"
                  dataKey="predicted"
                  stroke="#38BDF8"
                  strokeWidth={2.5}
                  dot={{ r: 3, fill: '#38BDF8' }}
                  name="Predicted Daily Demand"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 72-Hour Granular Burn-Down */}
        <div className="bg-[#0B1220] border border-slate-800/90 rounded-2xl p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                <Activity className="h-4 w-4 text-rose-400" />
                72-Hour Emergency Inventory Burn-Down Trajectory
              </h3>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Diurnal trauma-weighted inventory depletion against critical safety floor
              </p>
            </div>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={payload?.forecast.hourly_burndown_72h ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis dataKey="label" tick={{ fill: '#94A3B8', fontSize: 10 }} />
                <YAxis tick={{ fill: '#94A3B8', fontSize: 10 }} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    border: '1px solid #334155',
                    borderRadius: '10px',
                    fontSize: '11px',
                  }}
                />
                <ReferenceLine
                  y={6}
                  stroke="#F43F5E"
                  strokeDasharray="4 4"
                  label={{ value: 'Critical Floor (6u)', fill: '#FB7185', fontSize: 10 }}
                />
                <Area
                  type="monotone"
                  dataKey="upper_band"
                  stroke="none"
                  fill="#F43F5E"
                  fillOpacity={0.12}
                  name="Upper Stock Envelope"
                />
                <Line
                  type="monotone"
                  dataKey="projected_units"
                  stroke="#FB7185"
                  strokeWidth={2.6}
                  dot={false}
                  name="Projected Units Remaining"
                />
                <Line
                  type="monotone"
                  dataKey="lower_band"
                  stroke="#F59E0B"
                  strokeDasharray="3 3"
                  strokeWidth={1.5}
                  dot={false}
                  name="Worst-Case Surge Bound"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Bottom Row: Weekly Pattern + What-If Emergency Surge Injector */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-[#0B1220] border border-slate-800/90 rounded-2xl p-4">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-1.5 mb-2">
            <Calendar className="h-4 w-4 text-violet-400" /> Day-of-Week Demand Seasonality (%)
          </h3>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyBars}>
                <CartesianGrid strokeDasharray="3 3" stroke="#1E293B" />
                <XAxis dataKey="day" tick={{ fill: '#94A3B8', fontSize: 10 }} />
                <YAxis tick={{ fill: '#94A3B8', fontSize: 10 }} domain={[70, 140]} />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0F172A',
                    border: '1px solid #334155',
                    borderRadius: '10px',
                    fontSize: '11px',
                  }}
                />
                <Bar dataKey="index" fill="#8B5CF6" radius={[6, 6, 0, 0]} name="Demand Index %" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-2 bg-[#0B1220] border border-slate-800/90 rounded-2xl p-4 flex flex-col justify-between gap-3">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-rose-300 flex items-center gap-1.5">
              <Flame className="h-4 w-4" /> What-If Emergency Surge Simulator
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              Stress-test the predictive network by injecting a localized mass-casualty or surgical
              hemorrhage surge on the selected hospital and blood group.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Scenario Label</label>
              <input
                value={surgeLabel}
                onChange={(e) => setSurgeLabel(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
              />
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">
                Burn Multiplier ({surgeMult.toFixed(1)}x)
              </label>
              <input
                type="range"
                min={1.3}
                max={3.5}
                step={0.1}
                value={surgeMult}
                onChange={(e) => setSurgeMult(Number(e.target.value))}
                className="w-full accent-rose-500 mt-2"
              />
            </div>
            <div className="flex items-end">
              <button
                onClick={() =>
                  onInjectCustomSurge({
                    facility_id: facilityId,
                    blood_type: bloodType,
                    multiplier: surgeMult,
                    duration_hours: 12,
                    label: surgeLabel || 'Emergency Surge',
                  })
                }
                className="w-full px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition"
              >
                <AlertTriangle className="h-3.5 w-3.5" /> Inject 12h Surge ({bloodType})
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
