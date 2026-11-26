import React, { useMemo, useState } from 'react';
import { BellRing, CheckCircle2, MapPin, ShieldAlert, Users } from 'lucide-react';
import { DONOR_COOLDOWN_DAYS } from '../engine/constants';
import { matchEligibleDonorsLocal } from '../engine/simulation';
import { BLOOD_TYPES, BloodType, NetworkState } from '../types/network';

interface RegionalDonorsProps {
  state: NetworkState;
  onMobilize: (facilityId: string, bloodType: BloodType, radiusKm: number) => void;
}

export const RegionalDonors: React.FC<RegionalDonorsProps> = ({ state, onMobilize }) => {
  const [facId, setFacId] = useState(state.facility_risks[0]?.facility_id ?? state.facilities[0]?.id ?? '');
  const [bt, setBt] = useState<BloodType>('O-');
  const [radiusKm, setRadiusKm] = useState(15);

  const eligibleDonors = useMemo(
    () => matchEligibleDonorsLocal(state, facId, bt, radiusKm),
    [state, facId, bt, radiusKm]
  );

  return (
    <div className="space-y-4">
      {/* 4 Regional Risk Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
        {state.regions.map((reg) => {
          const isCrit = reg.status === 'CRITICAL';
          const isWatch = reg.status === 'WATCH';
          return (
            <div
              key={reg.zone}
              className={`rounded-2xl border p-4 space-y-2 ${
                isCrit
                  ? 'bg-rose-950/25 border-rose-500/40'
                  : isWatch
                    ? 'bg-amber-950/20 border-amber-500/35'
                    : 'bg-[#0B1220] border-slate-800/90'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-white flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-rose-400" /> {reg.zone}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-bold ${
                    isCrit
                      ? 'bg-rose-500/20 text-rose-300'
                      : isWatch
                        ? 'bg-amber-500/20 text-amber-300'
                        : 'bg-emerald-500/15 text-emerald-300'
                  }`}
                >
                  {reg.status}
                </span>
              </div>
              <div className="flex items-baseline justify-between">
                <div className="text-2xl font-bold font-mono text-white tabular-nums">
                  {reg.avg_risk_score}
                  <span className="text-xs text-slate-400">/100 risk</span>
                </div>
                <div className="text-xs font-mono text-slate-300">{reg.total_units}u stock</div>
              </div>
              <div className="text-[11px] font-mono text-slate-400 flex justify-between pt-1 border-t border-slate-800/70">
                <span>{reg.critical_slots} critical slots</span>
                <span>{reg.expiring_24h}u exp&lt;24h</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
        {/* High-Risk Hospitals Watchlist */}
        <div className="xl:col-span-6 bg-[#0B1220] border border-slate-800/90 rounded-2xl p-4 space-y-3">
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-rose-400" />
            High-Risk Hospital Priority Watchlist
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-900/90 text-[10px] uppercase text-slate-400">
                <tr>
                  <th className="px-3 py-2">Hospital</th>
                  <th className="px-3 py-2">Zone</th>
                  <th className="px-3 py-2">Min Runway</th>
                  <th className="px-3 py-2">Critical Types</th>
                  <th className="px-3 py-2">Risk</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/70">
                {state.facility_risks.map((f) => (
                  <tr key={f.facility_id} className="hover:bg-slate-900/40">
                    <td className="px-3 py-2">
                      <div className="font-mono font-bold text-white">{f.code}</div>
                      <div className="text-[11px] text-slate-400">{f.name}</div>
                    </td>
                    <td className="px-3 py-2 text-slate-300">{f.zone}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-amber-300">
                      {f.min_runway_hours}h
                    </td>
                    <td className="px-3 py-2 font-mono text-rose-300">
                      {f.critical_types.length ? f.critical_types.join(', ') : '—'}
                    </td>
                    <td className="px-3 py-2 font-mono font-bold text-white">
                      {f.peak_risk_score}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Geo-Targeted Donor Mobilization Cascade */}
        <div className="xl:col-span-6 bg-[#0B1220] border border-slate-800/90 rounded-2xl p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <Users className="h-4 w-4 text-violet-400" />
                Geo-Targeted Donor Mobilization Cascade
              </h3>
              <p className="text-xs text-slate-400">
                Filters donors within radius with &ge;{DONOR_COOLDOWN_DAYS}-day medical cooldown &amp;
                ABO/Rh match
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            <select
              value={facId}
              onChange={(e) => setFacId(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white"
            >
              {state.facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} · {f.short_name}
                </option>
              ))}
            </select>
            <select
              value={bt}
              onChange={(e) => setBt(e.target.value as BloodType)}
              className="bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white font-mono"
            >
              {BLOOD_TYPES.map((t) => (
                <option key={t} value={t}>
                  Needed: {t}
                </option>
              ))}
            </select>
            <select
              value={radiusKm}
              onChange={(e) => setRadiusKm(Number(e.target.value))}
              className="bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-2 text-xs text-white font-mono"
            >
              {[8, 12, 15, 25].map((r) => (
                <option key={r} value={r}>
                  Radius: {r} km
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between bg-slate-900/70 border border-slate-800 rounded-xl p-3">
            <div className="text-xs text-slate-300">
              <strong className="text-white font-mono">{eligibleDonors.length}</strong> eligible
              compatible donors within {radiusKm} km
            </div>
            <button
              onClick={() => onMobilize(facId, bt, radiusKm)}
              disabled={eligibleDonors.length === 0}
              className="px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-40 text-white text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <BellRing className="h-3.5 w-3.5" /> Dispatch SMS/Push Alert
            </button>
          </div>

          <div className="max-h-64 overflow-y-auto space-y-1.5 pr-1">
            {eligibleDonors.map((d) => (
              <div
                key={d.id}
                className="p-2.5 rounded-xl bg-slate-900/50 border border-slate-800 flex items-center justify-between text-xs"
              >
                <div>
                  <span className="font-semibold text-white">{d.name}</span>{' '}
                  <span className="font-mono text-rose-300 font-bold ml-1">{d.blood_type}</span>
                  <div className="text-[11px] text-slate-400 font-mono">
                    {d.zone} · {d.distance_km} km away · Last donated {d.days_since_last_donation}d
                    ago
                  </div>
                </div>
                {d.mobilized ? (
                  <span className="px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-300 font-mono text-[10px] flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> ALERTED
                  </span>
                ) : (
                  <span className="px-2 py-1 rounded-md bg-slate-800 text-slate-300 font-mono text-[10px]">
                    {d.exact_match ? 'EXACT MATCH' : 'COMPATIBLE'}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
