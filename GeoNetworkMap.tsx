import React, { useMemo, useState } from 'react';
import {
  Layers,
  Maximize2,
  Navigation,
  Radio,
  Truck,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  Facility,
  FacilityRiskSummary,
  NetworkState,
  RiskLevel,
  TransferRecommendation,
} from '../types/network';

interface GeoNetworkMapProps {
  state: NetworkState;
  selectedFacilityId: string;
  onSelectFacility: (id: string) => void;
  highlightedRec?: TransferRecommendation | null;
}

const SVG_W = 860;
const SVG_H = 520;

function projectCoords(lat: number, lng: number): { x: number; y: number } {
  // Bounds around seeded region (lat 12.855..13.10, lng 77.495..77.74)
  const minLat = 12.852;
  const maxLat = 13.102;
  const minLng = 77.495;
  const maxLng = 77.742;

  const x = ((lng - minLng) / (maxLng - minLng)) * (SVG_W - 140) + 70;
  const y = SVG_H - (((lat - minLat) / (maxLat - minLat)) * (SVG_H - 110) + 55);
  return { x, y };
}

function riskColor(status: RiskLevel): string {
  if (status === 'CRITICAL') return '#F43F5E';
  if (status === 'WATCH') return '#F59E0B';
  return '#10B981';
}

function facilityStatus(risk?: FacilityRiskSummary): RiskLevel {
  if (!risk) return 'OPTIMAL';
  if (risk.critical_slots > 0) return 'CRITICAL';
  if (risk.watch_slots > 0) return 'WATCH';
  return 'OPTIMAL';
}

export const GeoNetworkMap: React.FC<GeoNetworkMapProps> = ({
  state,
  selectedFacilityId,
  onSelectFacility,
  highlightedRec,
}) => {
  const [zoom, setZoom] = useState(1);
  const [showHeatmap, setShowHeatmap] = useState(true);
  const [showRoutes, setShowRoutes] = useState(true);

  const riskById = useMemo(() => {
    const map = new Map<string, FacilityRiskSummary>();
    state.facility_risks.forEach((r) => map.set(r.facility_id, r));
    return map;
  }, [state.facility_risks]);

  const facilityPositions = useMemo(() => {
    const map = new Map<string, { x: number; y: number; fac: Facility }>();
    state.facilities.forEach((fac) => {
      map.set(fac.id, { ...projectCoords(fac.lat, fac.lng), fac });
    });
    return map;
  }, [state.facilities]);

  const zoneCenters = useMemo(() => {
    const groups = new Map<string, { xs: number[]; ys: number[] }>();
    state.facilities.forEach((f) => {
      const p = projectCoords(f.lat, f.lng);
      const entry = groups.get(f.zone) ?? { xs: [], ys: [] };
      entry.xs.push(p.x);
      entry.ys.push(p.y);
      groups.set(f.zone, entry);
    });
    return Array.from(groups.entries()).map(([zone, coords]) => {
      const cx = coords.xs.reduce((a, b) => a + b, 0) / coords.xs.length;
      const cy = coords.ys.reduce((a, b) => a + b, 0) / coords.ys.length;
      const reg = state.regions.find((r) => r.zone === zone);
      return { zone, cx, cy, reg };
    });
  }, [state.facilities, state.regions]);

  const activeTransfers = state.transfers.filter((t) => t.status === 'IN_TRANSIT');

  return (
    <div className="bg-[#0B1220] border border-slate-800/90 rounded-2xl overflow-hidden flex flex-col">
      {/* Map Toolbar */}
      <div className="px-4 py-2.5 border-b border-slate-800/80 flex flex-wrap items-center justify-between gap-2 bg-slate-900/40">
        <div className="flex items-center gap-2">
          <Navigation className="h-4 w-4 text-rose-400" />
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-200">
            Geospatial Command Network
          </h2>
          <span className="text-[11px] font-mono text-slate-400">
            • 10 Facilities • 4 Regions
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowHeatmap((v) => !v)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border flex items-center gap-1 transition ${
              showHeatmap
                ? 'bg-rose-500/15 text-rose-300 border-rose-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-700'
            }`}
          >
            <Layers className="h-3 w-3" /> Regional Risk Zones
          </button>
          <button
            onClick={() => setShowRoutes((v) => !v)}
            className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border flex items-center gap-1 transition ${
              showRoutes
                ? 'bg-sky-500/15 text-sky-300 border-sky-500/40'
                : 'bg-slate-900 text-slate-400 border-slate-700'
            }`}
          >
            <Truck className="h-3 w-3" /> AI Corridor Overlay
          </button>
          <div className="flex items-center bg-slate-900 border border-slate-800 rounded-lg ml-1">
            <button
              onClick={() => setZoom((z) => Math.max(0.85, Number((z - 0.15).toFixed(2))))}
              className="p-1.5 text-slate-400 hover:text-white"
              title="Zoom out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </button>
            <span className="px-1.5 text-[10px] font-mono text-slate-400">
              {Math.round(zoom * 100)}%
            </span>
            <button
              onClick={() => setZoom((z) => Math.min(1.6, Number((z + 0.15).toFixed(2))))}
              className="p-1.5 text-slate-400 hover:text-white"
              title="Zoom in"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => setZoom(1)}
              className="p-1.5 text-slate-400 hover:text-white border-l border-slate-800"
              title="Reset zoom"
            >
              <Maximize2 className="h-3 w-3" />
            </button>
          </div>
        </div>
      </div>

      {/* Interactive SVG Canvas */}
      <div className="relative flex-1 bg-[radial-gradient(circle_at_50%_45%,#111D33_0%,#080D17_75%)] overflow-hidden min-h-[380px]">
        <svg
          viewBox={`0 0 ${SVG_W} ${SVG_H}`}
          className="w-full h-full select-none transition-transform duration-200"
          style={{ transform: `scale(${zoom})`, transformOrigin: 'center center' }}
        >
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#1E293B" strokeWidth="0.5" strokeOpacity="0.45" />
            </pattern>
            <radialGradient id="zoneCrit" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#F43F5E" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#F43F5E" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="zoneWatch" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.18" />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="zoneOpt" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#10B981" stopOpacity="0.14" />
              <stop offset="100%" stopColor="#10B981" stopOpacity="0" />
            </radialGradient>
          </defs>

          <rect width={SVG_W} height={SVG_H} fill="url(#grid)" />

          {/* Simulated arterial river & highway corridors for spatial realism */}
          <path
            d="M 40 420 Q 260 360 440 310 T 830 220"
            fill="none"
            stroke="#1E3A5F"
            strokeWidth="2.5"
            strokeDasharray="6 6"
            strokeOpacity="0.5"
          />
          <path
            d="M 420 20 L 420 495"
            fill="none"
            stroke="#1E293B"
            strokeWidth="1.5"
            strokeDasharray="4 4"
          />

          {/* Regional Risk Heat Zones */}
          {showHeatmap &&
            zoneCenters.map(({ zone, cx, cy, reg }) => {
              const st = reg?.status ?? 'OPTIMAL';
              const grad =
                st === 'CRITICAL'
                  ? 'url(#zoneCrit)'
                  : st === 'WATCH'
                    ? 'url(#zoneWatch)'
                    : 'url(#zoneOpt)';
              return (
                <g key={zone}>
                  <circle cx={cx} cy={cy} r={118} fill={grad} />
                  <circle
                    cx={cx}
                    cy={cy}
                    r={95}
                    fill="none"
                    stroke={riskColor(st)}
                    strokeOpacity={0.22}
                    strokeDasharray="4 5"
                  />
                  <text
                    x={cx}
                    y={cy - 102}
                    textAnchor="middle"
                    className="fill-slate-400 text-[10px] font-mono uppercase tracking-widest"
                  >
                    {zone} ({reg?.avg_risk_score ?? 0})
                  </text>
                </g>
              );
            })}

          {/* Top AI Recommended Corridors (Dashed) */}
          {showRoutes &&
            state.recommendations.slice(0, 4).map((rec) => {
              const p1 = facilityPositions.get(rec.from_facility_id);
              const p2 = facilityPositions.get(rec.to_facility_id);
              if (!p1 || !p2) return null;
              const isHighlighted = highlightedRec?.id === rec.id;
              const mx = (p1.x + p2.x) / 2;
              const my = (p1.y + p2.y) / 2 - 28;
              return (
                <path
                  key={rec.id}
                  d={`M ${p1.x} ${p1.y} Q ${mx} ${my} ${p2.x} ${p2.y}`}
                  fill="none"
                  stroke={rec.category === 'EXPIRY_RESCUE' ? '#A855F7' : '#38BDF8'}
                  strokeWidth={isHighlighted ? 3 : 1.3}
                  strokeOpacity={isHighlighted ? 0.95 : 0.4}
                  strokeDasharray="5 5"
                />
              );
            })}

          {/* Live Cold-Chain Transfers In Transit */}
          {activeTransfers.map((tx) => {
            const p1 = facilityPositions.get(tx.from_facility_id);
            const p2 = facilityPositions.get(tx.to_facility_id);
            if (!p1 || !p2) return null;
            const progress = Math.min(
              1,
              Math.max(0.05, 1 - tx.remaining_minutes / Math.max(1, tx.total_transit_minutes))
            );
            const mx = (p1.x + p2.x) / 2;
            const my = (p1.y + p2.y) / 2 - 24;
            // Quadratic Bezier point at t = progress
            const t = progress;
            const vx = (1 - t) * (1 - t) * p1.x + 2 * (1 - t) * t * mx + t * t * p2.x;
            const vy = (1 - t) * (1 - t) * p1.y + 2 * (1 - t) * t * my + t * t * p2.y;

            return (
              <g key={tx.id}>
                <path
                  d={`M ${p1.x} ${p1.y} Q ${mx} ${my} ${p2.x} ${p2.y}`}
                  fill="none"
                  stroke="#38BDF8"
                  strokeWidth={2.4}
                  strokeOpacity={0.85}
                />
                <circle cx={vx} cy={vy} r={7} fill="#0EA5E9" fillOpacity={0.28} />
                <circle cx={vx} cy={vy} r={4} fill="#38BDF8" stroke="#FFFFFF" strokeWidth={1.2} />
                <rect
                  x={vx + 8}
                  y={vy - 10}
                  width={68}
                  height={16}
                  rx={4}
                  fill="#0F172A"
                  stroke="#38BDF8"
                  strokeWidth={0.8}
                />
                <text
                  x={vx + 12}
                  y={vy + 1}
                  className="fill-sky-200 text-[9px] font-mono font-semibold"
                >
                  {tx.units}u {tx.source_blood_type} · {Math.ceil(tx.remaining_minutes)}m
                </text>
              </g>
            );
          })}

          {/* Facility Nodes */}
          {state.facilities.map((fac) => {
            const pos = facilityPositions.get(fac.id);
            if (!pos) return null;
            const risk = riskById.get(fac.id);
            const status = facilityStatus(risk);
            const color = riskColor(status);
            const isSelected = fac.id === selectedFacilityId;
            const isBank =
              fac.role === 'MUNICIPAL_BLOOD_BANK' || fac.role === 'REGIONAL_HUB';

            return (
              <g
                key={fac.id}
                onClick={() => onSelectFacility(fac.id)}
                className="cursor-pointer group"
              >
                {status !== 'OPTIMAL' && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={status === 'CRITICAL' ? 22 : 16}
                    fill={color}
                    fillOpacity={status === 'CRITICAL' ? 0.18 : 0.12}
                    stroke={color}
                    strokeWidth={1}
                    strokeOpacity={0.45}
                  />
                )}
                {isSelected && (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={19}
                    fill="none"
                    stroke="#FFFFFF"
                    strokeWidth={1.6}
                    strokeDasharray="3 2"
                  />
                )}

                {isBank ? (
                  <rect
                    x={pos.x - 9}
                    y={pos.y - 9}
                    width={18}
                    height={18}
                    rx={4}
                    fill="#0F172A"
                    stroke={color}
                    strokeWidth={2.4}
                  />
                ) : (
                  <circle
                    cx={pos.x}
                    cy={pos.y}
                    r={10}
                    fill="#0F172A"
                    stroke={color}
                    strokeWidth={2.4}
                  />
                )}

                <circle cx={pos.x} cy={pos.y} r={3.5} fill={color} />

                {/* Code + Runway Tag */}
                <rect
                  x={pos.x - 36}
                  y={pos.y + 14}
                  width={72}
                  height={24}
                  rx={5}
                  fill="#0B1324"
                  fillOpacity={0.92}
                  stroke={isSelected ? '#E2E8F0' : '#1E293B'}
                  strokeWidth={1}
                />
                <text
                  x={pos.x}
                  y={pos.y + 24}
                  textAnchor="middle"
                  className="fill-slate-100 text-[9px] font-mono font-bold"
                >
                  {fac.code}
                </text>
                <text
                  x={pos.x}
                  y={pos.y + 34}
                  textAnchor="middle"
                  style={{ fill: color }}
                  className="text-[8.5px] font-mono font-semibold"
                >
                  {risk ? `${risk.total_units}u · ${risk.min_runway_hours}h` : ''}
                </text>
              </g>
            );
          })}
        </svg>

        {/* Bottom Map Legend */}
        <div className="absolute bottom-3 left-3 right-3 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
          <div className="pointer-events-auto flex flex-wrap items-center gap-3 px-3 py-1.5 rounded-xl bg-slate-950/85 border border-slate-800/90 backdrop-blur-sm text-[11px]">
            <span className="flex items-center gap-1.5 text-rose-300">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Critical (&lt;12h)
            </span>
            <span className="flex items-center gap-1.5 text-amber-300">
              <span className="h-2.5 w-2.5 rounded-full bg-amber-500" /> Watch (&lt;28h)
            </span>
            <span className="flex items-center gap-1.5 text-emerald-300">
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Optimal
            </span>
            <span className="flex items-center gap-1.5 text-slate-300">
              <span className="h-2.5 w-2.5 rounded-sm border border-slate-400" /> Blood Bank / Hub
            </span>
            <span className="flex items-center gap-1.5 text-sky-300">
              <Radio className="h-3 w-3" /> Live Cold-Chain
            </span>
          </div>
          <div className="px-2.5 py-1 rounded-lg bg-slate-950/80 border border-slate-800 text-[10px] font-mono text-slate-400">
            Click any node to inspect inventory &amp; forecasts
          </div>
        </div>
      </div>
    </div>
  );
};
