import React, { useEffect, useState } from 'react';
import {
  AlertTriangle,
  BrainCircuit,
  Clock,
  GitCompare,
  Map as MapIcon,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  advanceNetworkClock,
  changeSeasonRegime,
  checkBackendHealth,
  dispatchColdChain,
  EngineMode,
  fetchInitialState,
  injectSurgeEvent,
  logInventoryBatch,
  mobilizeDonors,
  resetNetwork,
} from './engine/apiClient';
import { createInitialNetworkStateLocal } from './engine/simulation';
import { AiCopilotModal } from './components/AiCopilotModal';
import { AllocationCenter } from './components/AllocationCenter';
import { FacilityDrawer } from './components/FacilityDrawer';
import { ForecastLab } from './components/ForecastLab';
import { GeoNetworkMap } from './components/GeoNetworkMap';
import { InventoryLedger } from './components/InventoryLedger';
import { RegionalDonors } from './components/RegionalDonors';
import { TopCommandBar } from './components/TopCommandBar';
import {
  BloodType,
  NetworkState,
  SeasonRegime,
  TransferRecommendation,
} from './types/network';

type ActiveTab = 'COMMAND' | 'FORECAST' | 'ALLOCATION' | 'INVENTORY' | 'REGIONS';

export default function App() {
  const [state, setState] = useState<NetworkState>(() => createInitialNetworkStateLocal());
  const [engineMode, setEngineMode] = useState<EngineMode>('BROWSER_LOCAL');
  const [geminiEnabled, setGeminiEnabled] = useState(false);

  const [activeTab, setActiveTab] = useState<ActiveTab>('COMMAND');
  const [selectedFacilityId, setSelectedFacilityId] = useState<string>('fac-metro-trauma');
  const [forecastBloodType, setForecastBloodType] = useState<BloodType>('O-');

  const [isPlaying, setIsPlaying] = useState(false);
  const [simSpeed, setSimSpeed] = useState<1 | 6 | 24>(6);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [highlightedRec, setHighlightedRec] = useState<TransferRecommendation | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const notify = (msg: string) => {
    setToast(msg);
    setTimeout(() => {
      setToast((prev) => (prev === msg ? null : prev));
    }, 3600);
  };

  useEffect(() => {
    (async () => {
      const health = await checkBackendHealth();
      const init = await fetchInitialState();
      setState(init.state);
      setEngineMode(init.mode);
      setGeminiEnabled(health.geminiEnabled);
    })();
  }, []);

  useEffect(() => {
    if (!isPlaying) return;
    const intervalMs = 1500;
    const hoursPerTick = simSpeed === 1 ? 0.25 : simSpeed === 6 ? 1.0 : 4.0;
    const timer = setInterval(async () => {
      setState((prev) => prev); // trigger via async below
      const next = await advanceNetworkClock(engineMode, state, hoursPerTick);
      setState(next);
    }, intervalMs);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, simSpeed, engineMode, state.sim_hour]);

  const selectedFacility =
    state.facilities.find((f) => f.id === selectedFacilityId) ?? state.facilities[0];

  const handleStep = async (hours: number) => {
    const next = await advanceNetworkClock(engineMode, state, hours);
    setState(next);
    notify(`Simulation advanced +${hours}h (T+${next.sim_hour.toFixed(1)}h).`);
  };

  const handleReset = async () => {
    setIsPlaying(false);
    const next = await resetNetwork(engineMode);
    setState(next);
    notify('Network simulation reset to baseline.');
  };

  const handleSeasonChange = async (season: SeasonRegime) => {
    const next = await changeSeasonRegime(engineMode, state, season);
    setState(next);
    notify(`Forecasting regime updated to ${season}.`);
  };

  const handleInjectSurge = async (payload: {
    facility_id: string;
    blood_type: BloodType;
    multiplier: number;
    duration_hours: number;
    label: string;
  }) => {
    const next = await injectSurgeEvent(engineMode, state, payload);
    setState(next);
    notify(`Emergency surge injected: ${payload.label} (${payload.blood_type}).`);
  };

  const handleDispatch = async (payload: {
    from_facility_id: string;
    to_facility_id: string;
    source_blood_type: BloodType;
    target_blood_type: BloodType;
    units: number;
    reason: string;
  }) => {
    const next = await dispatchColdChain(engineMode, state, payload);
    setState(next);
    notify(`Cold-chain transfer dispatched (${payload.units}u ${payload.source_blood_type}).`);
  };

  const handleAddBatch = async (payload: {
    facility_id: string;
    blood_type: BloodType;
    units: number;
    hours_to_expiry: number;
  }) => {
    const next = await logInventoryBatch(engineMode, state, payload);
    setState(next);
    notify(`Registered ${payload.units}u ${payload.blood_type} batch to FEFO ledger.`);
  };

  const handleMobilizeDonors = async (
    facilityId: string,
    bloodType: BloodType,
    radiusKm: number
  ) => {
    const res = await mobilizeDonors(engineMode, state, facilityId, bloodType, radiusKm);
    setState(res.state);
    notify(`Mobilized ${res.mobilizedCount} eligible ${bloodType}-compatible donors within ${radiusKm} km.`);
  };

  const tabs: Array<{ id: ActiveTab; label: string; icon: React.ReactNode; badge?: number }> = [
    { id: 'COMMAND', label: 'Network Map & Alerts', icon: <MapIcon className="h-4 w-4" /> },
    {
      id: 'FORECAST',
      label: 'AI Forecast Lab',
      icon: <BrainCircuit className="h-4 w-4" />,
    },
    {
      id: 'ALLOCATION',
      label: 'Smart Matching & Dispatch',
      icon: <GitCompare className="h-4 w-4" />,
      badge: state.recommendations.length,
    },
    {
      id: 'INVENTORY',
      label: 'FEFO Expiry Ledger',
      icon: <Clock className="h-4 w-4" />,
    },
    {
      id: 'REGIONS',
      label: 'Regions & Donor Cascade',
      icon: <Users className="h-4 w-4" />,
    },
  ];

  return (
    <div className="min-h-screen bg-[#070B12] text-slate-100 flex flex-col">
      <TopCommandBar
        state={state}
        engineMode={engineMode}
        geminiEnabled={geminiEnabled}
        isPlaying={isPlaying}
        simSpeed={simSpeed}
        onTogglePlay={() => setIsPlaying((v) => !v)}
        onChangeSpeed={setSimSpeed}
        onStepHours={handleStep}
        onReset={handleReset}
        onChangeSeason={handleSeasonChange}
        onOpenCopilot={() => setCopilotOpen(true)}
      />

      {/* Sub-Nav Tabs */}
      <nav className="border-b border-slate-800/80 bg-[#090E18]">
        <div className="max-w-[1600px] mx-auto px-4 flex items-center gap-1.5 overflow-x-auto py-2">
          {tabs.map((tab) => {
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3.5 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 whitespace-nowrap transition ${
                  active
                    ? 'bg-rose-600/20 text-rose-200 border border-rose-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-100 hover:bg-slate-900/70 border border-transparent'
                }`}
              >
                {tab.icon}
                {tab.label}
                {tab.badge !== undefined && tab.badge > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full bg-rose-500 text-white text-[10px] font-mono">
                    {tab.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </nav>

      {/* Main Content */}
      <main className="flex-1 max-w-[1600px] w-full mx-auto p-4 space-y-4">
        {activeTab === 'COMMAND' && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 xl:grid-cols-12 gap-4">
              <div className="xl:col-span-8">
                <GeoNetworkMap
                  state={state}
                  selectedFacilityId={selectedFacilityId}
                  onSelectFacility={setSelectedFacilityId}
                  highlightedRec={highlightedRec}
                />
              </div>
              <div className="xl:col-span-4">
                {selectedFacility && (
                  <FacilityDrawer
                    state={state}
                    facility={selectedFacility}
                    onInspectForecast={(fid, bt) => {
                      setSelectedFacilityId(fid);
                      setForecastBloodType(bt);
                      setActiveTab('FORECAST');
                    }}
                    onInjectSurge={(fid, bt) =>
                      handleInjectSurge({
                        facility_id: fid,
                        blood_type: bt,
                        multiplier: 2.0,
                        duration_hours: 12,
                        label: 'Rapid Trauma Surge',
                      })
                    }
                    onGoToAllocation={() => setActiveTab('ALLOCATION')}
                  />
                )}
              </div>
            </div>

            {/* Bottom Command Strip: Top Priority AI Recommendations */}
            <div className="bg-[#0B1220] border border-slate-800/90 rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-rose-400" />
                  Immediate Predictive Shortage &amp; FEFO Rescue Queue
                </h3>
                <button
                  onClick={() => setActiveTab('ALLOCATION')}
                  className="text-xs text-sky-400 hover:text-sky-300 font-medium"
                >
                  Open Full Allocation Center →
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {state.recommendations.slice(0, 3).map((rec) => (
                  <div
                    key={rec.id}
                    onMouseEnter={() => setHighlightedRec(rec)}
                    onMouseLeave={() => setHighlightedRec(null)}
                    className="rounded-xl bg-slate-900/70 border border-slate-800 hover:border-sky-500/40 p-3 flex flex-col justify-between gap-2.5 transition"
                  >
                    <div>
                      <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                        <span
                          className={`font-bold ${
                            rec.priority === 'CRITICAL'
                              ? 'text-rose-400'
                              : rec.priority === 'HIGH'
                                ? 'text-amber-300'
                                : 'text-violet-300'
                          }`}
                        >
                          [{rec.priority}] {rec.category.replace('_', ' ')}
                        </span>
                        <span className="text-slate-400">~{Math.round(rec.transit_minutes)}m</span>
                      </div>
                      <p className="text-xs text-slate-200 leading-relaxed">{rec.rationale}</p>
                    </div>
                    <button
                      onClick={() =>
                        handleDispatch({
                          from_facility_id: rec.from_facility_id,
                          to_facility_id: rec.to_facility_id,
                          source_blood_type: rec.source_blood_type,
                          target_blood_type: rec.target_blood_type,
                          units: rec.units,
                          reason: rec.category.replace('_', ' '),
                        })
                      }
                      className="w-full py-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white text-xs font-semibold transition"
                    >
                      Approve &amp; Dispatch {rec.units}u {rec.source_blood_type}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'FORECAST' && (
          <ForecastLab
            state={state}
            engineMode={engineMode}
            facilityId={selectedFacilityId}
            bloodType={forecastBloodType}
            onSelectTarget={(fid, bt) => {
              setSelectedFacilityId(fid);
              setForecastBloodType(bt);
            }}
            onInjectCustomSurge={handleInjectSurge}
          />
        )}

        {activeTab === 'ALLOCATION' && (
          <AllocationCenter
            state={state}
            onDispatch={handleDispatch}
            onHoverRec={setHighlightedRec}
          />
        )}

        {activeTab === 'INVENTORY' && (
          <InventoryLedger state={state} onAddBatch={handleAddBatch} />
        )}

        {activeTab === 'REGIONS' && (
          <RegionalDonors state={state} onMobilize={handleMobilizeDonors} />
        )}
      </main>

      <AiCopilotModal
        open={copilotOpen}
        onClose={() => setCopilotOpen(false)}
        state={state}
        engineMode={engineMode}
      />

      {toast && (
        <div className="fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-xl bg-slate-900 border border-emerald-500/40 text-xs text-emerald-200 shadow-2xl flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-400" />
          {toast}
        </div>
      )}
    </div>
  );
}
