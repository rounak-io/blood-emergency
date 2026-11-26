import React, { useMemo, useState } from 'react';
import { Clock, PackagePlus, Search, ShieldAlert } from 'lucide-react';
import { BLOOD_TYPES, BloodType, NetworkState } from '../types/network';

interface InventoryLedgerProps {
  state: NetworkState;
  onAddBatch: (payload: {
    facility_id: string;
    blood_type: BloodType;
    units: number;
    hours_to_expiry: number;
  }) => void;
}

export const InventoryLedger: React.FC<InventoryLedgerProps> = ({ state, onAddBatch }) => {
  const [filterZone, setFilterZone] = useState<string>('ALL');
  const [filterType, setFilterType] = useState<string>('ALL');
  const [expiryOnly, setExpiryOnly] = useState(false);
  const [query, setQuery] = useState('');

  const [newFacId, setNewFacId] = useState(state.facilities[0]?.id ?? '');
  const [newBt, setNewBt] = useState<BloodType>('O-');
  const [newUnits, setNewUnits] = useState(12);
  const [newExpiry, setNewExpiry] = useState(168);

  const flatBatches = useMemo(() => {
    const rows: Array<{
      id: string;
      facilityCode: string;
      facilityName: string;
      zone: string;
      bloodType: BloodType;
      units: number;
      hoursToExpiry: number;
      originCode: string;
    }> = [];

    for (const fac of state.facilities) {
      if (filterZone !== 'ALL' && fac.zone !== filterZone) continue;
      for (const bt of BLOOD_TYPES) {
        if (filterType !== 'ALL' && bt !== filterType) continue;
        for (const b of fac.inventory[bt].batches) {
          if (b.units <= 0) continue;
          if (expiryOnly && b.hours_to_expiry > 48) continue;
          if (
            query.trim() &&
            !`${fac.code} ${fac.name} ${b.id} ${bt}`
              .toLowerCase()
              .includes(query.toLowerCase())
          ) {
            continue;
          }
          rows.push({
            id: b.id,
            facilityCode: fac.code,
            facilityName: fac.short_name,
            zone: fac.zone,
            bloodType: bt,
            units: b.units,
            hoursToExpiry: b.hours_to_expiry,
            originCode: b.origin_code,
          });
        }
      }
    }
    return rows.sort((a, b) => a.hoursToExpiry - b.hoursToExpiry);
  }, [state.facilities, filterZone, filterType, expiryOnly, query]);

  const zones = Array.from(new Set(state.facilities.map((f) => f.zone)));
  const critExpiryCount = flatBatches.filter((b) => b.hoursToExpiry <= 24).length;

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
      {/* Batch Table */}
      <div className="xl:col-span-8 bg-[#0B1220] border border-slate-800/90 rounded-2xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Clock className="h-4 w-4 text-amber-400" />
              FEFO Expiry-Aware Cold-Chain Batch Ledger
            </h2>
            <p className="text-xs text-slate-400">
              First-Expired, First-Out (FEFO) telemetry across all hospitals &amp; blood banks
            </p>
          </div>
          {critExpiryCount > 0 && (
            <span className="px-2.5 py-1 rounded-full bg-amber-500/15 border border-amber-500/40 text-amber-300 text-xs font-mono flex items-center gap-1">
              <ShieldAlert className="h-3.5 w-3.5" /> {critExpiryCount} batches &le;24h expiry
            </span>
          )}
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="h-3.5 w-3.5 text-slate-400 absolute left-3 top-2.5" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search batch ID or hospital..."
              className="w-full bg-slate-900 border border-slate-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white"
            />
          </div>
          <select
            value={filterZone}
            onChange={(e) => setFilterZone(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200"
          >
            <option value="ALL">All Zones</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="bg-slate-900 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 font-mono"
          >
            <option value="ALL">All Groups</option>
            {BLOOD_TYPES.map((bt) => (
              <option key={bt} value={bt}>
                {bt}
              </option>
            ))}
          </select>
          <button
            onClick={() => setExpiryOnly((v) => !v)}
            className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
              expiryOnly
                ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-700'
            }`}
          >
            Rescue Window (&le;48h)
          </button>
        </div>

        {/* Table */}
        <div className="overflow-x-auto max-h-[480px] overflow-y-auto border border-slate-800/80 rounded-xl">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-900/90 text-[10px] uppercase tracking-wider text-slate-400 sticky top-0">
              <tr>
                <th className="px-3 py-2.5">Batch ID</th>
                <th className="px-3 py-2.5">Facility</th>
                <th className="px-3 py-2.5">Group</th>
                <th className="px-3 py-2.5">Units</th>
                <th className="px-3 py-2.5">Time to Expiry</th>
                <th className="px-3 py-2.5">FEFO Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/70">
              {flatBatches.slice(0, 80).map((b) => {
                const isCrit = b.hoursToExpiry <= 24;
                const isRescue = b.hoursToExpiry > 24 && b.hoursToExpiry <= 48;
                return (
                  <tr key={`${b.facilityCode}-${b.id}`} className="hover:bg-slate-900/40">
                    <td className="px-3 py-2 font-mono text-slate-200">{b.id}</td>
                    <td className="px-3 py-2">
                      <span className="font-mono text-white font-semibold">{b.facilityCode}</span>{' '}
                      <span className="text-slate-400">{b.facilityName}</span>
                    </td>
                    <td className="px-3 py-2 font-mono font-bold text-rose-300">{b.bloodType}</td>
                    <td className="px-3 py-2 font-mono text-slate-100 tabular-nums">{b.units}u</td>
                    <td className="px-3 py-2 font-mono tabular-nums text-slate-200">
                      {b.hoursToExpiry.toFixed(1)}h ({(b.hoursToExpiry / 24).toFixed(1)}d)
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={`px-2 py-0.5 rounded-md text-[10px] font-mono font-semibold ${
                          isCrit
                            ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                            : isRescue
                              ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              : 'bg-emerald-500/10 text-emerald-300 border border-emerald-500/20'
                        }`}
                      >
                        {isCrit ? 'CRITICAL EXPIRY' : isRescue ? 'RESCUE PRIORITY' : 'FRESH'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Log New Blood Batch Panel */}
      <div className="xl:col-span-4 bg-[#0B1220] border border-slate-800/90 rounded-2xl p-4 space-y-4 h-fit">
        <div>
          <h3 className="text-sm font-bold text-white flex items-center gap-2">
            <PackagePlus className="h-4 w-4 text-emerald-400" />
            Log Incoming Cold-Chain Batch
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Simulate real-time hospital blood bank intake; updates FEFO queue and shortage runway
            instantly.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">Receiving Facility</label>
            <select
              value={newFacId}
              onChange={(e) => setNewFacId(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white"
            >
              {state.facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.code} — {f.name}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Blood Group</label>
              <select
                value={newBt}
                onChange={(e) => setNewBt(e.target.value as BloodType)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
              >
                {BLOOD_TYPES.map((bt) => (
                  <option key={bt} value={bt}>
                    {bt}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] text-slate-400 block mb-1">Units</label>
              <input
                type="number"
                min={1}
                max={100}
                value={newUnits}
                onChange={(e) => setNewUnits(Math.max(1, Number(e.target.value)))}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
              />
            </div>
          </div>
          <div>
            <label className="text-[11px] text-slate-400 block mb-1">
              Shelf-Life Remaining (hours)
            </label>
            <input
              type="number"
              min={6}
              max={840}
              value={newExpiry}
              onChange={(e) => setNewExpiry(Math.max(6, Number(e.target.value)))}
              className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-white font-mono"
            />
          </div>
          <button
            onClick={() =>
              onAddBatch({
                facility_id: newFacId,
                blood_type: newBt,
                units: newUnits,
                hours_to_expiry: newExpiry,
              })
            }
            className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition"
          >
            Register Batch to Live Network
          </button>
        </div>
      </div>
    </div>
  );
};
