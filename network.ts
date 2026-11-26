export const BLOOD_TYPES = [
  'O-',
  'O+',
  'A-',
  'A+',
  'B-',
  'B+',
  'AB-',
  'AB+',
] as const;

export type BloodType = (typeof BLOOD_TYPES)[number];

export type FacilityRole =
  | 'TRAUMA_CENTER'
  | 'MUNICIPAL_BLOOD_BANK'
  | 'ONCOLOGY_INSTITUTE'
  | 'TERTIARY_HOSPITAL'
  | 'REGIONAL_HUB';

export type SeasonRegime =
  | 'NORMAL'
  | 'MONSOON_DENGUE'
  | 'WINTER_TRAUMA'
  | 'FESTIVAL_SURGE';

export type RiskLevel = 'OPTIMAL' | 'WATCH' | 'CRITICAL';

export interface BloodBatch {
  id: string;
  blood_type: BloodType;
  units: number;
  hours_to_expiry: number;
  origin_code: string;
}

export interface InventorySlot {
  batches: BloodBatch[];
  base_hourly_burn: number;
  surge_multiplier: number;
  history_30d_daily: number[];
}

export interface Facility {
  id: string;
  code: string;
  name: string;
  short_name: string;
  role: FacilityRole;
  zone: string;
  lat: number;
  lng: number;
  capacity_units: number;
  inventory: Record<BloodType, InventorySlot>;
}

export interface SurgeEvent {
  id: string;
  facility_id: string;
  blood_type: BloodType;
  multiplier: number;
  total_duration_hours: number;
  remaining_hours: number;
  label: string;
}

export interface ColdChainTransfer {
  id: string;
  from_facility_id: string;
  from_code: string;
  to_facility_id: string;
  to_code: string;
  source_blood_type: BloodType;
  target_blood_type: BloodType;
  is_compatibility_fallback: boolean;
  units: number;
  distance_km: number;
  total_transit_minutes: number;
  remaining_minutes: number;
  earliest_batch_expiry_hours: number;
  status: 'IN_TRANSIT' | 'DELIVERED';
  reason: string;
}

export interface DonorRecord {
  id: string;
  name: string;
  blood_type: BloodType;
  zone: string;
  lat: number;
  lng: number;
  days_since_last_donation: number;
  mobilized: boolean;
  distance_km?: number;
  exact_match?: boolean;
}

export interface AuditLogEntry {
  id: string;
  sim_hour: number;
  category: string;
  message: string;
}

export interface SlotMetrics {
  total_units: number;
  effective_hourly_burn: number;
  hours_of_supply: number;
  expiring_24h: number;
  expiring_48h: number;
  earliest_expiry_hours: number;
  risk_level: RiskLevel;
  risk_score: number;
}

export interface TransferRecommendation {
  id: string;
  category: 'SHORTAGE_MITIGATION' | 'COMPATIBLE_FALLBACK' | 'EXPIRY_RESCUE';
  priority: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  from_facility_id: string;
  from_code: string;
  from_name: string;
  to_facility_id: string;
  to_code: string;
  to_name: string;
  source_blood_type: BloodType;
  target_blood_type: BloodType;
  is_compatibility_fallback: boolean;
  units: number;
  distance_km: number;
  transit_minutes: number;
  dest_runway_hours: number;
  projected_dest_runway_hours: number;
  earliest_batch_expiry_hours: number;
  utility_score: number;
  rationale: string;
}

export interface RegionRiskSummary {
  zone: string;
  facilities: number;
  total_units: number;
  critical_slots: number;
  watch_slots: number;
  expiring_24h: number;
  avg_risk_score: number;
  status: RiskLevel;
}

export interface FacilityRiskSummary {
  facility_id: string;
  code: string;
  name: string;
  zone: string;
  role: FacilityRole;
  total_units: number;
  min_runway_hours: number;
  critical_slots: number;
  watch_slots: number;
  critical_types: BloodType[];
  expiring_24h: number;
  peak_risk_score: number;
  avg_risk_score: number;
}

export interface ForecastDailyPoint {
  day: string;
  day_num: number;
  predicted_demand: number;
  lower_80: number;
  upper_80: number;
  lower_95: number;
  upper_95: number;
  projected_inventory: number;
}

export interface ForecastHourlyPoint {
  hour: number;
  label: string;
  projected_units: number;
  upper_band: number;
  lower_band: number;
}

export interface ForecastPayload {
  facility_id: string;
  facility_code: string;
  blood_type: BloodType;
  metrics: SlotMetrics;
  history_30d_daily: number[];
  forecast: {
    model: string;
    trend_slope_daily: number;
    weekly_seasonality_indices: number[];
    predicted_stockout_day: number | null;
    daily_forecast: ForecastDailyPoint[];
    hourly_burndown_72h: ForecastHourlyPoint[];
  };
}

export interface NetworkState {
  sim_hour: number;
  season: SeasonRegime;
  facilities: Facility[];
  surges: SurgeEvent[];
  transfers: ColdChainTransfer[];
  donors: DonorRecord[];
  audit_log: AuditLogEntry[];
  regions: RegionRiskSummary[];
  facility_risks: FacilityRiskSummary[];
  recommendations: TransferRecommendation[];
}

export interface AiBriefingResponse {
  provider: string;
  live_llm: boolean;
  briefing: string;
  telemetry_snapshot: string;
}
