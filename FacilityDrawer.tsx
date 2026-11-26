import React from 'react';
import {
  Activity,
  AlertTriangle,
  Building2,
  Flame,
  LineChart,
  MapPin,
  Send,
} from 'lucide-react';
import { ROLE_LABELS } from '../engine/constants';
import { computeSlotMetrics } from '../engine/simulation';
import { BLOOD_TYPES, BloodType, Facility, NetworkState } from '../types/network';

interface FacilityDrawerProps {
  state: NetworkState;
  facility: Facility;
  onInspectForecast: (facilityId: string, bloodType: BloodType) => void;
  onInjectSurge: (facilityId: string, bloodType: BloodType) => void;
  onGoToAllocation: () => void;
}

export const FacilityDrawer: React.FC<FacilityDrawerProps> = ({
  state,
  facility,
  onInspectForecast,
  onInjectSurge,
  onGoToAllocation,
}) => {
  const facRisk = state.facility_risks.find((f) => f.facility_id === facility.id);
  const activeSurges = state.surges.filter((s) => s.facility_id === facility.id);

  const slotRows = BLOOD_TYPES.map((bt) => ({
    bt,
    metrics: computeSlotMetrics(facility, bt, state.season, state.surges),
  }));

  const fillPct = Math.min(
    100,
    Math.round(((facRisk?.total_units ?? 0) / Math.max(1, facility.capacity_units)) * 100)
  );

  return (
    <div className="bg-[#0B1220] border border-slate-800/90 rounded-2xl p-4 flex flex-col gap-3.5 h-full">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <span className="px-2 py-0.5 rounded-md bg-slate-800 text-slate-200 font-mono text-[11px] font-bold">
              {facility.code}
            </span>
            <span className="text-[11px] text-slate-400 flex items-center gap-1">
              <MapPin className="h-3 w-3 text-rose-400" />
              {facility.zone}
            </span>
          </div>
          <h3 className="text-sm font-bold text-white mt-1.5 leading-snug">{facility.name}</h3>
          <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
            <Building2 className="h-3 w-3" /> {ROLE_LABELS[facility.role] ?? facility.role}
          </p>
        </div>

        <div className="text-right">
          <div className="text-[10px] uppercase tracking-wider text-slate-400">Peak Risk</div>
          <div
            className={`text-lg font-bold font-mono tabular-nums ${
              (facRisk?.peak_risk_score ?? 0) >= 65
                ? 'text-rose-400'
                : (facRisk?.peak_risk_score ?? 0) >= 35
                  ? 'text-amber-400'
                  : 'text-emerald-400'
            }`}
          >
            {facRisk?.peak_risk_score ?? 0}
            <span className="text-[10px] text-slate-500">/100</span>
          </div>
        </div>
      </div>

      {/* Capacity Gauge */}
      <div className="bg-slate-900/70 border border-slate-800 rounded-xl p-2.5">
        <div className="flex justify-between text-[11px] mb-1.5">
          <span className="text-slate-400">Cold-Vault Occupancy</span>
          <span className="font-mono text-slate-200 tabular-nums">
            {facRisk?.total_units ?? 0} / {facility.capacity_units} units ({fillPct}%)
          </span>
        </div>
        <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-rose-500 via-amber-400 to-emerald-400 transition-all"
            style={{ width: `${fillPct}%` }}
          />
        </div>
      </div>

      {/* Active Surges */}
      {activeSurges.length > 0 && (
        <div className="rounded-xl bg-rose-950/35 border border-rose-500/40 p-2.5 space-y-1">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-rose-300">
            <Flame className="h-3.5 w-3.5" /> Active Emergency Surge
          </div>
          {activeSurges.map((s) => (
            <div key={s.id} className="text-[11px] text-rose-200/90 flex justify-between">
              <span>
                {s.label} ({s.blood_type} x{s.multiplier.toFixed(1)})
              </span>
              <span className="font-mono">{s.remaining_hours.toFixed(1)}h left</span>
            </div>
          ))}
        </div>
      )}

      {/* 8-Blood-Group Matrix */}
      <div className="flex-1 overflow-y-auto pr-0.5 space-y-1.5">
        <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-slate-400 px-1">
          <span>Blood Group Telemetry</span>
          <span>Stock · Runway · Burn</span>
        </div>
        {slotRows.map(({ bt, metrics }) => {
          const isCrit = metrics.risk_level === 'CRITICAL';
          const isWatch = metrics.risk_level === 'WATCH';
          return (
            <div
              key={bt}
              className={`rounded-xl border px-2.5 py-2 flex items-center justify-between gap-2 transition ${
                isCrit
                  ? 'bg-rose-950/30 border-rose-500/40'
                  : isWatch
                    ? 'bg-amber-950/20 border-amber-500/30'
                    : 'bg-slate-900/50 border-slate-800/80 hover:border-slate-700'
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-9 text-center py-0.5 rounded-md font-mono text-xs font-bold ${
                    isCrit
                      ? 'bg-rose-500/20 text-rose-300'
                      : isWatch
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/15 text-emerald-300'
                  }`}
                >
                  {bt}
                </span>
                <div>
                  <div className="text-xs font-mono font-semibold text-slate-100 tabular-nums">
                    {metrics.total_units}u{' '}
                    <span className="text-slate-400 font-normal">
                      · {metrics.hours_of_supply}h
                    </span>
                  </div>
                  <div className="text-[10px] text-slate-400 font-mono">
                    {metrics.effective_hourly_burn.toFixed(2)}u/hr
                    {metrics.expiring_24h > 0 && (
                      <span className="text-amber-300 ml-1.5">
                        ({metrics.expiring_24h}u exp&lt;24h)
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  onClick={() => onInspectForecast(facility.id, bt)}
                  title={`Open 14-day AI forecast for ${facility.code} ${bt}`}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-sky-600/30 text-sky-300 transition"
                >
                  <LineChart className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => onInjectSurge(facility.id, bt)}
                  title={`Simulate trauma surge on ${bt}`}
                  className="p-1.5 rounded-lg bg-slate-800 hover:bg-rose-600/30 text-rose-300 transition"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Quick Action Footer */}
      <div className="grid grid-cols-2 gap-2 pt-1 border-t border-slate-800/80">
        <button
          onClick={() => onInspectForecast(facility.id, facRisk?.critical_types[0] ?? 'O-')}
          className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 text-xs font-medium flex items-center justify-center gap-1.5 transition"
        >
          <Activity className="h-3.5 w-3.5 text-sky-400" /> AI Forecast
        </button>
        <button
          onClick={onGoToAllocation}
          className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition"
        >
          <Send className="h-3.5 w-3.5" /> Coordinate Stock
        </button>
      </div>
    </div>
  );
};
