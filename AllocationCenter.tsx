import React, { useMemo, useState } from 'react';
import {
  ArrowRight,
  CheckCircle2,
  GitCompare,
  Send,
  ShieldAlert,
  Sparkles,
  Truck,
} from 'lucide-react';
import { RBC_COMPATIBILITY } from '../engine/constants';
import { computeSlotMetrics, haversineKm } from '../engine/simulation';
import {
  BLOOD_TYPES,
  BloodType,
  NetworkState,
  TransferRecommendation,
} from '../types/network';

interface AllocationCenterProps {
  state: NetworkState;
  onDispatch: (payload: {
    from_facility_id: string;
    to_facility_id: string;
    source_blood_type: BloodType;
    target_blood_type: BloodType;
    units: number;
    reason: string;
  }) => void;
  onHoverRec: (rec: TransferRecommendation | null) => void;
}

export const AllocationCenter: React.FC<AllocationCenterProps> = ({
  state,
  onDispatch,
  onHoverRec,
}) => {
  const [targetFacId, setTargetFacId] = useState(state.facilities[0]?.id ?? '');
  const [targetBt, setTargetBt] = useState<BloodType>('O-');
  const [sourceFacId, setSourceFacId] = useState(state.facilities[1]?.id ?? '');
  const [sourceBt, setSourceBt] = useState<BloodType>('O-');
  const [customUnits, setCustomUnits] = useState(8);

  const compatibleDonors = RBC_COMPATIBILITY[targetBt];

  const surplusOptions = useMemo(() => {
    const dest = state.facilities.find((f) => f.id === targetFacId);
    if (!dest) return [];
    const options: Array<{
      facId: string;
      code: string;
      name: string;
      bt: BloodType;
      units: number;
      runway: number;
      distKm: number;
      exact: boolean;
    }> = [];

    for (const src of state.facilities) {
      if (src.id === targetFacId) continue;
      const distKm = Number(haversineKm(src.lat, src.lng, dest.lat, dest.lng).toFixed(2));
      for (const bt of compatibleDonors) {
        const m = computeSlotMetrics(src, bt, state.season, state.surges);
        if (m.total_units >= 6) {
          options.push({
            facId: src.id,
            code: src.code,
            name: src.short_name,
            bt,
            units: m.total_units,
            runway: m.hours_of_supply,
            distKm,
            exact: bt === targetBt,
          });
        }
      }
    }
    return options.sort((a, b) => Number(b.exact) - Number(a.exact) || b.runway - a.runway);
  }, [state, targetFacId, targetBt, compatibleDonors]);

  const activeTransfers = state.transfers.filter((t) => t.status === 'IN_TRANSIT');
  const deliveredTransfers = state.transfers.filter((t) => t.status === 'DELIVERED');

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      {/* Left: AI Optimization Queue */}
      <div className="xl:col-span-7 bg-[#0B1220] border border-slate-800/90 rounded-2xl p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-rose-400" />
              AI Coordinated Resource Allocation Recommendations
            </h2>
            <p className="text-xs text-slate-400">
              Multi-objective optimizer balancing shortage urgency, ABO/Rh compatibility &amp; FEFO
              expiry rescue
            </p>
          </div>
          <span className="px-2.5 py-1 rounded-full bg-slate-900 border border-slate-800 text-[11px] font-mono text-slate-300">
            {state.recommendations.length} optimal routes
          </span>
        </div>

        <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
          {state.recommendations.length === 0 && (
            <div className="p-8 text-center text-slate-400 text-xs border border-dashed border-slate-800 rounded-xl">
              All network facilities are currently within optimal safety margins.
            </div>
          )}

          {state.recommendations.map((rec) => {
            const badgeStyle =
              rec.priority === 'CRITICAL'
                ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                : rec.priority === 'HIGH'
                  ? 'bg-amber-500/15 text-amber-300 border-amber-500/40'
                  : 'bg-violet-500/15 text-violet-300 border-violet-500/40';

            return (
              <div
                key={rec.id}
                onMouseEnter={() => onHoverRec(rec)}
                onMouseLeave={() => onHoverRec(null)}
                className="rounded-xl bg-slate-900/60 border border-slate-800 hover:border-sky-500/50 p-3.5 transition flex flex-col sm:flex-row sm:items-center justify-between gap-3"
              >
                <div className="space-y-1.5 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold border ${badgeStyle}`}>
                      {rec.priority}
                    </span>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-mono bg-slate-800 text-slate-300">
                      {rec.category.replace('_', ' ')}
                    </span>
                    <span className="text-xs font-mono font-semibold text-white flex items-center gap-1">
                      {rec.from_code} <ArrowRight className="h-3 w-3 text-sky-400" /> {rec.to_code}
                    </span>
                    <span className="text-xs font-mono text-sky-300">
                      {rec.units}u {rec.source_blood_type}
                      {rec.is_compatibility_fallback && ` → ${rec.target_blood_type}`}
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 leading-relaxed">{rec.rationale}</p>
                  <div className="flex flex-wrap gap-3 text-[11px] font-mono text-slate-400">
                    <span>Distance: {rec.distance_km} km</span>
                    <span>ETA: ~{Math.round(rec.transit_minutes)}m</span>
                    <span>
                      Runway boost: {rec.dest_runway_hours}h →{' '}
                      <strong className="text-emerald-300">{rec.projected_dest_runway_hours}h</strong>
                    </span>
                  </div>
                </div>

                <button
                  onClick={() =>
                    onDispatch({
                      from_facility_id: rec.from_facility_id,
                      to_facility_id: rec.to_facility_id,
                      source_blood_type: rec.source_blood_type,
                      target_blood_type: rec.target_blood_type,
                      units: rec.units,
                      reason: rec.category.replace('_', ' '),
                    })
                  }
                  className="shrink-0 px-3.5 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition"
                >
                  <Send className="h-3.5 w-3.5" /> Dispatch
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Right: Intelligent ABO/Rh Matcher + Live Transit */}
      <div className="xl:col-span-5 space-y-4">
        <div className="bg-[#0B1220] border border-slate-800/90 rounded-2xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <GitCompare className="h-4 w-4 text-emerald-400" />
            Intelligent Blood Availability Matcher (ABO/Rh)
          </h3>

          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Recipient Facility</label>
              <select
                value={targetFacId}
                onChange={(e) => setTargetFacId(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white"
              >
                {state.facilities.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.code} · {f.short_name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Requested Blood Group</label>
              <select
                value={targetBt}
                onChange={(e) => {
                  const bt = e.target.value as BloodType;
                  setTargetBt(bt);
                  setSourceBt(bt);
                }}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white font-mono"
              >
                {BLOOD_TYPES.map((bt) => (
                  <option key={bt} value={bt}>
                    {bt}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="rounded-xl bg-slate-900/70 border border-slate-800 p-2.5">
            <div className="text-[10px] uppercase tracking-wider text-slate-400 mb-1.5">
              Clinically Compatible Donor Groups for {targetBt}
            </div>
            <div className="flex flex-wrap gap-1.5">
              {compatibleDonors.map((bt, idx) => (
                <button
                  key={bt}
                  onClick={() => setSourceBt(bt)}
                  className={`px-2 py-1 rounded-lg text-xs font-mono font-semibold border transition ${
                    sourceBt === bt
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                      : 'bg-slate-800 text-slate-300 border-slate-700'
                  }`}
                >
                  {bt} {idx === 0 ? '(Exact)' : '(Compat)'}
                </button>
              ))}
            </div>
          </div>

          <div className="max-h-40 overflow-y-auto space-y-1.5">
            {surplusOptions.slice(0, 6).map((opt) => (
              <div
                key={`${opt.facId}-${opt.bt}`}
                onClick={() => {
                  setSourceFacId(opt.facId);
                  setSourceBt(opt.bt);
                }}
                className={`p-2 rounded-xl border cursor-pointer flex items-center justify-between text-xs transition ${
                  sourceFacId === opt.facId && sourceBt === opt.bt
                    ? 'bg-sky-950/40 border-sky-500/50'
                    : 'bg-slate-900/40 border-slate-800 hover:border-slate-700'
                }`}
              >
                <div>
                  <span className="font-mono font-bold text-white">{opt.code}</span>{' '}
                  <span className="text-slate-400">{opt.name}</span>
                  <div className="text-[10px] font-mono text-slate-400">
                    {opt.distKm} km · Runway {opt.runway}h
                  </div>
                </div>
                <div className="text-right font-mono">
                  <span className="text-emerald-300 font-bold">{opt.units}u {opt.bt}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <input
              type="number"
              min={1}
              max={30}
              value={customUnits}
              onChange={(e) => setCustomUnits(Math.max(1, Number(e.target.value)))}
              className="w-20 bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs font-mono text-white"
            />
            <button
              onClick={() =>
                onDispatch({
                  from_facility_id: sourceFacId,
                  to_facility_id: targetFacId,
                  source_blood_type: sourceBt,
                  target_blood_type: targetBt,
                  units: customUnits,
                  reason: 'Manual Compatible Match Dispatch',
                })
              }
              disabled={sourceFacId === targetFacId}
              className="flex-1 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition"
            >
              <ShieldAlert className="h-3.5 w-3.5" /> Dispatch Matched Units
            </button>
          </div>
        </div>

        {/* Live Cold-Chain Transit Tracker */}
        <div className="bg-[#0B1220] border border-slate-800/90 rounded-2xl p-4 space-y-2.5">
          <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
            <Truck className="h-4 w-4 text-sky-400" />
            Cold-Chain Transit Telemetry ({activeTransfers.length} In Transit)
          </h3>
          <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
            {activeTransfers.map((tx) => {
              const pct = Math.min(
                100,
                Math.round(
                  ((tx.total_transit_minutes - tx.remaining_minutes) /
                    Math.max(1, tx.total_transit_minutes)) *
                    100
                )
              );
              return (
                <div
                  key={tx.id}
                  className="p-2.5 rounded-xl bg-slate-900/80 border border-sky-500/30 space-y-1.5"
                >
                  <div className="flex justify-between text-xs font-mono">
                    <span className="text-white font-semibold">
                      {tx.id}: {tx.from_code} → {tx.to_code} ({tx.units}u {tx.source_blood_type})
                    </span>
                    <span className="text-sky-300">{Math.ceil(tx.remaining_minutes)}m ETA</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-sky-400 transition-all"
                      style={{ width: `${Math.max(8, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            {deliveredTransfers.slice(0, 4).map((tx) => (
              <div
                key={tx.id}
                className="p-2 rounded-xl bg-slate-900/40 border border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-400"
              >
                <span className="flex items-center gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                  {tx.id}: {tx.units}u {tx.source_blood_type} → {tx.to_code}
                </span>
                <span className="text-emerald-400">DELIVERED</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
