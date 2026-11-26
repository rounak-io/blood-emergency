import {
  AiBriefingResponse,
  BloodType,
  DonorRecord,
  ForecastPayload,
  NetworkState,
  SeasonRegime,
} from '../types/network';
import {
  advanceSimulationLocal,
  buildForecastLocal,
  createInitialNetworkStateLocal,
  generateBriefingLocal,
  haversineKm,
  matchEligibleDonorsLocal,
  summarizeNetwork,
} from './simulation';

export type EngineMode = 'PYTHON_BACKEND' | 'BROWSER_LOCAL';

const API_BASE = '/api';

async function tryFetch<T>(path: string, options?: RequestInit): Promise<T | null> {
  if (
    typeof window !== 'undefined' &&
    (window.location.protocol === 'file:' || window.location.hostname.endsWith('github.io'))
  ) {
    return null;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2200);
    const res = await fetch(`${API_BASE}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options?.headers ?? {}),
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function checkBackendHealth(): Promise<{ online: boolean; geminiEnabled: boolean }> {
  const data = await tryFetch<{ status: string; gemini_enabled: boolean }>('/health');
  return {
    online: Boolean(data && data.status === 'ok'),
    geminiEnabled: Boolean(data?.gemini_enabled),
  };
}

export async function fetchInitialState(): Promise<{ state: NetworkState; mode: EngineMode }> {
  const remote = await tryFetch<NetworkState>('/state');
  if (remote) return { state: remote, mode: 'PYTHON_BACKEND' };
  return { state: createInitialNetworkStateLocal(), mode: 'BROWSER_LOCAL' };
}

export async function resetNetwork(mode: EngineMode): Promise<NetworkState> {
  if (mode === 'PYTHON_BACKEND') {
    const remote = await tryFetch<NetworkState>('/reset', { method: 'POST' });
    if (remote) return remote;
  }
  return createInitialNetworkStateLocal();
}

export async function advanceNetworkClock(
  mode: EngineMode,
  current: NetworkState,
  hours: number
): Promise<NetworkState> {
  if (mode === 'PYTHON_BACKEND') {
    const remote = await tryFetch<NetworkState>('/sim/advance', {
      method: 'POST',
      body: JSON.stringify({ hours }),
    });
    if (remote) return remote;
  }
  return advanceSimulationLocal(current, hours);
}

export async function changeSeasonRegime(
  mode: EngineMode,
  current: NetworkState,
  season: SeasonRegime
): Promise<NetworkState> {
  if (mode === 'PYTHON_BACKEND') {
    const remote = await tryFetch<NetworkState>('/season', {
      method: 'POST',
      body: JSON.stringify({ season }),
    });
    if (remote) return remote;
  }
  const next: NetworkState = JSON.parse(JSON.stringify(current));
  next.season = season;
  next.audit_log.unshift({
    id: `LOG-${next.audit_log.length + 1}`,
    sim_hour: next.sim_hour,
    category: 'SEASON',
    message: `Forecasting regime switched to ${season}.`,
  });
  return summarizeNetwork(next);
}

export async function injectSurgeEvent(
  mode: EngineMode,
  current: NetworkState,
  payload: {
    facility_id: string;
    blood_type: BloodType;
    multiplier: number;
    duration_hours: number;
    label: string;
  }
): Promise<NetworkState> {
  if (mode === 'PYTHON_BACKEND') {
    const remote = await tryFetch<NetworkState>('/surges', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (remote) return remote;
  }
  const next: NetworkState = JSON.parse(JSON.stringify(current));
  const fac = next.facilities.find((f) => f.id === payload.facility_id);
  next.surges.push({
    id: `SURGE-${next.surges.length + 101}`,
    facility_id: payload.facility_id,
    blood_type: payload.blood_type,
    multiplier: payload.multiplier,
    total_duration_hours: payload.duration_hours,
    remaining_hours: payload.duration_hours,
    label: payload.label,
  });
  if (fac) {
    next.audit_log.unshift({
      id: `LOG-${next.audit_log.length + 1}`,
      sim_hour: next.sim_hour,
      category: 'SURGE',
      message: `${payload.label} at ${fac.code} (${payload.blood_type} x${payload.multiplier.toFixed(1)}).`,
    });
  }
  return summarizeNetwork(next);
}

export async function logInventoryBatch(
  mode: EngineMode,
  current: NetworkState,
  payload: {
    facility_id: string;
    blood_type: BloodType;
    units: number;
    hours_to_expiry: number;
  }
): Promise<NetworkState> {
  if (mode === 'PYTHON_BACKEND') {
    const remote = await tryFetch<NetworkState>('/inventory/batch', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (remote) return remote;
  }
  const next: NetworkState = JSON.parse(JSON.stringify(current));
  const fac = next.facilities.find((f) => f.id === payload.facility_id);
  if (fac) {
    const id = `${fac.code}-${payload.blood_type.replace('+', 'P').replace('-', 'N')}-${Math.floor(
      100 + Math.random() * 899
    )}`;
    fac.inventory[payload.blood_type].batches.push({
      id,
      blood_type: payload.blood_type,
      units: payload.units,
      hours_to_expiry: payload.hours_to_expiry,
      origin_code: fac.code,
    });
    fac.inventory[payload.blood_type].batches.sort((a, b) => a.hours_to_expiry - b.hours_to_expiry);
    next.audit_log.unshift({
      id: `LOG-${next.audit_log.length + 1}`,
      sim_hour: next.sim_hour,
      category: 'INVENTORY',
      message: `Logged ${payload.units}u ${payload.blood_type} (${id}) at ${fac.code}.`,
    });
  }
  return summarizeNetwork(next);
}

export async function dispatchColdChain(
  mode: EngineMode,
  current: NetworkState,
  payload: {
    from_facility_id: string;
    to_facility_id: string;
    source_blood_type: BloodType;
    target_blood_type: BloodType;
    units: number;
    reason: string;
  }
): Promise<NetworkState> {
  if (mode === 'PYTHON_BACKEND') {
    const remote = await tryFetch<NetworkState>('/transfers/dispatch', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (remote) return remote;
  }
  const next: NetworkState = JSON.parse(JSON.stringify(current));
  const src = next.facilities.find((f) => f.id === payload.from_facility_id);
  const dest = next.facilities.find((f) => f.id === payload.to_facility_id);
  if (!src || !dest) return current;

  const slot = src.inventory[payload.source_blood_type];
  slot.batches.sort((a, b) => a.hours_to_expiry - b.hours_to_expiry);
  const avail = slot.batches.reduce((acc, b) => acc + b.units, 0);
  const sendUnits = Math.min(payload.units, avail);
  if (sendUnits <= 0) return current;

  let rem = sendUnits;
  let earliestExp = 999;
  for (const b of slot.batches) {
    if (rem <= 0) break;
    const take = Math.min(b.units, rem);
    if (take > 0) {
      earliestExp = Math.min(earliestExp, b.hours_to_expiry);
      b.units -= take;
      rem -= take;
    }
  }
  slot.batches = slot.batches.filter((b) => b.units > 0);

  const distKm = Number(haversineKm(src.lat, src.lng, dest.lat, dest.lng).toFixed(2));
  const transitMin = Number(((distKm / 34) * 60 + 6).toFixed(1));

  next.transfers.unshift({
    id: `TX-${next.transfers.length + 901}`,
    from_facility_id: src.id,
    from_code: src.code,
    to_facility_id: dest.id,
    to_code: dest.code,
    source_blood_type: payload.source_blood_type,
    target_blood_type: payload.target_blood_type,
    is_compatibility_fallback: payload.source_blood_type !== payload.target_blood_type,
    units: sendUnits,
    distance_km: distKm,
    total_transit_minutes: transitMin,
    remaining_minutes: transitMin,
    earliest_batch_expiry_hours: Number(earliestExp.toFixed(1)),
    status: 'IN_TRANSIT',
    reason: payload.reason,
  });
  next.audit_log.unshift({
    id: `LOG-${next.audit_log.length + 1}`,
    sim_hour: next.sim_hour,
    category: 'DISPATCH',
    message: `Dispatched ${sendUnits}u ${payload.source_blood_type} ${src.code} -> ${dest.code} (ETA ${Math.round(
      transitMin
    )}m).`,
  });
  return summarizeNetwork(next);
}

export async function fetchForecast(
  mode: EngineMode,
  state: NetworkState,
  facilityId: string,
  bloodType: BloodType
): Promise<ForecastPayload> {
  if (mode === 'PYTHON_BACKEND') {
    const remote = await tryFetch<ForecastPayload>(
      `/forecast?facility_id=${encodeURIComponent(facilityId)}&blood_type=${encodeURIComponent(
        bloodType
      )}`
    );
    if (remote) return remote;
  }
  return buildForecastLocal(state, facilityId, bloodType);
}

export async function mobilizeDonors(
  mode: EngineMode,
  current: NetworkState,
  facilityId: string,
  bloodType: BloodType,
  radiusKm = 15
): Promise<{ state: NetworkState; mobilizedCount: number; eligible: DonorRecord[] }> {
  if (mode === 'PYTHON_BACKEND') {
    const remote = await tryFetch<{
      mobilized_count: number;
      eligible_donors: DonorRecord[];
      state: NetworkState;
    }>('/donors/mobilize', {
      method: 'POST',
      body: JSON.stringify({ facility_id: facilityId, blood_type: bloodType, radius_km: radiusKm }),
    });
    if (remote) {
      return {
        state: remote.state,
        mobilizedCount: remote.mobilized_count,
        eligible: remote.eligible_donors,
      };
    }
  }
  const eligible = matchEligibleDonorsLocal(current, facilityId, bloodType, radiusKm);
  const ids = new Set(eligible.slice(0, 8).map((d) => d.id));
  const next: NetworkState = JSON.parse(JSON.stringify(current));
  next.donors = next.donors.map((d) => (ids.has(d.id) ? { ...d, mobilized: true } : d));
  const fac = next.facilities.find((f) => f.id === facilityId);
  if (fac) {
    next.audit_log.unshift({
      id: `LOG-${next.audit_log.length + 1}`,
      sim_hour: next.sim_hour,
      category: 'DONOR',
      message: `Mobilized ${ids.size} eligible donors within ${radiusKm}km for ${fac.code} (${bloodType}).`,
    });
  }
  return { state: summarizeNetwork(next), mobilizedCount: ids.size, eligible };
}

export async function requestAiBriefing(
  mode: EngineMode,
  state: NetworkState,
  question?: string
): Promise<AiBriefingResponse> {
  if (mode === 'PYTHON_BACKEND') {
    const remote = await tryFetch<AiBriefingResponse>('/ai/brief', {
      method: 'POST',
      body: JSON.stringify({ question }),
    });
    if (remote) return remote;
  }
  return generateBriefingLocal(state, question);
}
