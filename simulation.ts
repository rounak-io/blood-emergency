import {
  AiBriefingResponse,
  BLOOD_TYPES,
  BloodBatch,
  BloodType,
  DonorRecord,
  Facility,
  FacilityRiskSummary,
  FacilityRole,
  ForecastDailyPoint,
  ForecastHourlyPoint,
  ForecastPayload,
  InventorySlot,
  NetworkState,
  RegionRiskSummary,
  RiskLevel,
  SeasonRegime,
  SlotMetrics,
  SurgeEvent,
  TransferRecommendation,
} from '../types/network';
import {
  DONOR_COOLDOWN_DAYS,
  RBC_COMPATIBILITY,
  SEASON_PROFILES,
} from './constants';

function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

function generateHistory30d(baseDaily: number, seed: number): number[] {
  const rng = seededRandom(seed);
  const out: number[] = [];
  for (let d = 0; d < 30; d++) {
    const dow = d % 7;
    const weekdayFactor = dow === 4 || dow === 5 ? 1.18 : dow === 6 ? 0.9 : 1.0;
    const trend = 1.0 + (d / 30) * 0.08;
    const noise = 0.86 + rng() * 0.3;
    out.push(Number(Math.max(0.5, baseDaily * weekdayFactor * trend * noise).toFixed(2)));
  }
  return out;
}

export function computeEffectiveHourlyBurn(
  slot: InventorySlot,
  zone: string,
  bloodType: BloodType,
  season: SeasonRegime,
  surges: SurgeEvent[],
  facilityId: string
): number {
  const profile = SEASON_PROFILES[season];
  const zoneMult = profile.zone_multipliers[zone] ?? 1.0;
  const typeMult = profile.type_multipliers[bloodType] ?? 1.0;
  let surgeMult = 1.0;
  for (const s of surges) {
    if (s.facility_id === facilityId && s.blood_type === bloodType && s.remaining_hours > 0) {
      surgeMult = Math.max(surgeMult, s.multiplier);
    }
  }
  return Number(
    (slot.base_hourly_burn * profile.global_multiplier * typeMult * zoneMult * surgeMult).toFixed(3)
  );
}

export function computeSlotMetrics(
  facility: Facility,
  bloodType: BloodType,
  season: SeasonRegime,
  surges: SurgeEvent[]
): SlotMetrics {
  const slot = facility.inventory[bloodType];
  const batches = slot.batches.filter((b) => b.units > 0);
  const total_units = batches.reduce((acc, b) => acc + b.units, 0);
  const expiring_24h = batches
    .filter((b) => b.hours_to_expiry <= 24)
    .reduce((acc, b) => acc + b.units, 0);
  const expiring_48h = batches
    .filter((b) => b.hours_to_expiry <= 48)
    .reduce((acc, b) => acc + b.units, 0);
  const earliest_expiry_hours =
    batches.length > 0 ? Math.min(...batches.map((b) => b.hours_to_expiry)) : 999;

  const effective_hourly_burn = computeEffectiveHourlyBurn(
    slot,
    facility.zone,
    bloodType,
    season,
    surges,
    facility.id
  );
  const hours_of_supply = Number(
    (total_units / Math.max(0.05, effective_hourly_burn)).toFixed(1)
  );

  let risk_level: RiskLevel = 'OPTIMAL';
  if (hours_of_supply < 12 || total_units <= 3) {
    risk_level = 'CRITICAL';
  } else if (hours_of_supply < 28) {
    risk_level = 'WATCH';
  }

  const runwayRisk = Math.max(0, Math.min(85, (40 - Math.min(40, hours_of_supply)) * 2.125));
  const expiryRisk = Math.min(15, (expiring_24h / Math.max(1, total_units)) * 15);
  const risk_score = Number(Math.min(100, runwayRisk + expiryRisk).toFixed(1));

  return {
    total_units,
    effective_hourly_burn,
    hours_of_supply,
    expiring_24h,
    expiring_48h,
    earliest_expiry_hours: Number(earliest_expiry_hours.toFixed(1)),
    risk_level,
    risk_score,
  };
}

export function summarizeNetwork(state: Omit<NetworkState, 'regions' | 'facility_risks' | 'recommendations'>): NetworkState {
  const zoneMap = new Map<
    string,
    {
      zone: string;
      facilities: number;
      total_units: number;
      critical_slots: number;
      watch_slots: number;
      expiring_24h: number;
      scores: number[];
    }
  >();

  const facility_risks: FacilityRiskSummary[] = [];

  for (const fac of state.facilities) {
    if (!zoneMap.has(fac.zone)) {
      zoneMap.set(fac.zone, {
        zone: fac.zone,
        facilities: 0,
        total_units: 0,
        critical_slots: 0,
        watch_slots: 0,
        expiring_24h: 0,
        scores: [],
      });
    }

    let facUnits = 0;
    let facCrit = 0;
    let facWatch = 0;
    let facExp24 = 0;
    let minRunway = 999;
    const criticalTypes: BloodType[] = [];
    const slotScores: number[] = [];

    for (const bt of BLOOD_TYPES) {
      const m = computeSlotMetrics(fac, bt, state.season, state.surges);
      facUnits += m.total_units;
      facExp24 += m.expiring_24h;
      slotScores.push(m.risk_score);
      if (m.hours_of_supply < minRunway) minRunway = m.hours_of_supply;
      if (m.risk_level === 'CRITICAL') {
        facCrit++;
        criticalTypes.push(bt);
      } else if (m.risk_level === 'WATCH') {
        facWatch++;
      }
    }

    const peakScore = slotScores.length > 0 ? Math.max(...slotScores) : 0;
    const avgScore =
      slotScores.length > 0
        ? Number((slotScores.reduce((a, b) => a + b, 0) / slotScores.length).toFixed(1))
        : 0;

    const z = zoneMap.get(fac.zone)!;
    z.facilities += 1;
    z.total_units += facUnits;
    z.critical_slots += facCrit;
    z.watch_slots += facWatch;
    z.expiring_24h += facExp24;
    z.scores.push(peakScore);

    facility_risks.push({
      facility_id: fac.id,
      code: fac.code,
      name: fac.name,
      zone: fac.zone,
      role: fac.role,
      total_units: facUnits,
      min_runway_hours: Number(minRunway.toFixed(1)),
      critical_slots: facCrit,
      watch_slots: facWatch,
      critical_types: criticalTypes,
      expiring_24h: facExp24,
      peak_risk_score: Number(peakScore.toFixed(1)),
      avg_risk_score: avgScore,
    });
  }

  const regions: RegionRiskSummary[] = Array.from(zoneMap.values()).map((z) => {
    const avg_risk_score = Number(
      (z.scores.reduce((a, b) => a + b, 0) / Math.max(1, z.scores.length)).toFixed(1)
    );
    const status: RiskLevel =
      z.critical_slots >= 2
        ? 'CRITICAL'
        : z.critical_slots === 1 || z.watch_slots >= 3
          ? 'WATCH'
          : 'OPTIMAL';
    return {
      zone: z.zone,
      facilities: z.facilities,
      total_units: z.total_units,
      critical_slots: z.critical_slots,
      watch_slots: z.watch_slots,
      expiring_24h: z.expiring_24h,
      avg_risk_score,
      status,
    };
  });

  regions.sort((a, b) => b.avg_risk_score - a.avg_risk_score);
  facility_risks.sort((a, b) => b.peak_risk_score - a.peak_risk_score);

  const recommendations = computeRecommendationsLocal(
    state.facilities,
    state.season,
    state.surges
  );

  return {
    ...state,
    regions,
    facility_risks,
    recommendations,
  };
}

export function computeRecommendationsLocal(
  facilities: Facility[],
  season: SeasonRegime,
  surges: SurgeEvent[]
): TransferRecommendation[] {
  const metricsMap = new Map<string, Record<BloodType, SlotMetrics>>();
  for (const f of facilities) {
    const rec = {} as Record<BloodType, SlotMetrics>;
    for (const bt of BLOOD_TYPES) {
      rec[bt] = computeSlotMetrics(f, bt, season, surges);
    }
    metricsMap.set(f.id, rec);
  }

  const recs: TransferRecommendation[] = [];

  for (const dest of facilities) {
    for (const targetBt of BLOOD_TYPES) {
      const destM = metricsMap.get(dest.id)![targetBt];
      if (destM.risk_level === 'OPTIMAL') continue;

      const desiredUnits = Math.max(
        4,
        Math.min(18, Math.round(destM.effective_hourly_burn * 24 - destM.total_units) || 6)
      );

      let bestCandidate: TransferRecommendation | null = null;
      let bestScore = -1e9;

      for (const src of facilities) {
        if (src.id === dest.id) continue;
        const distKm = Number(haversineKm(src.lat, src.lng, dest.lat, dest.lng).toFixed(2));
        const transitMin = Number(((distKm / 34) * 60 + 6).toFixed(1));

        const compatList = RBC_COMPATIBILITY[targetBt];
        compatList.forEach((srcBt, compatRank) => {
          const srcM = metricsMap.get(src.id)![srcBt];
          const safeReserve = Math.max(4, Math.round(srcM.effective_hourly_burn * 20));
          const surplus = srcM.total_units - safeReserve;
          if (surplus < 3) return;

          const sendUnits = Math.min(desiredUnits, surplus);
          const isFallback = srcBt !== targetBt;
          const validBatches = src.inventory[srcBt].batches.filter(
            (b) => b.units > 0 && b.hours_to_expiry > transitMin / 60 + 4
          );
          if (validBatches.length === 0) return;

          const earliestExp = Math.min(...validBatches.map((b) => b.hours_to_expiry));
          const urgencyBonus = destM.risk_level === 'CRITICAL' ? 120 : 65;
          const exactBonus = !isFallback ? 45 : -12 * compatRank;
          const universalPenalty =
            isFallback && srcBt === 'O-' && destM.risk_level !== 'CRITICAL' ? 20 : 0;
          const expiryBonus = earliestExp <= 36 ? 28 : 0;
          const score = urgencyBonus + exactBonus + expiryBonus - distKm * 1.4 - universalPenalty;

          if (score > bestScore) {
            bestScore = score;
            bestCandidate = {
              id: `REC-${dest.code}-${targetBt}-${src.code}-${srcBt}`,
              category: isFallback ? 'COMPATIBLE_FALLBACK' : 'SHORTAGE_MITIGATION',
              priority: destM.risk_level === 'CRITICAL' ? 'CRITICAL' : 'HIGH',
              from_facility_id: src.id,
              from_code: src.code,
              from_name: src.short_name,
              to_facility_id: dest.id,
              to_code: dest.code,
              to_name: dest.short_name,
              source_blood_type: srcBt,
              target_blood_type: targetBt,
              is_compatibility_fallback: isFallback,
              units: sendUnits,
              distance_km: distKm,
              transit_minutes: transitMin,
              dest_runway_hours: destM.hours_of_supply,
              projected_dest_runway_hours: Number(
                (
                  (destM.total_units + sendUnits) /
                  Math.max(0.05, destM.effective_hourly_burn)
                ).toFixed(1)
              ),
              earliest_batch_expiry_hours: Number(earliestExp.toFixed(1)),
              utility_score: Number(score.toFixed(1)),
              rationale: `${dest.short_name} hits ${destM.hours_of_supply}h runway on ${targetBt}. Route ${sendUnits}u ${srcBt}${
                isFallback ? ` (ABO/Rh compatible substitute for ${targetBt})` : ''
              } from ${src.short_name} (${distKm} km, ~${Math.round(transitMin)}m).`,
            };
          }
        });
      }

      if (bestCandidate) recs.push(bestCandidate);
    }
  }

  // Expiry Rescue Swaps
  for (const src of facilities) {
    for (const bt of BLOOD_TYPES) {
      const srcM = metricsMap.get(src.id)![bt];
      if (srcM.expiring_48h < 3 || srcM.hours_of_supply < 32) continue;

      const nearBatches = src.inventory[bt].batches.filter(
        (b) => b.hours_to_expiry > 4 && b.hours_to_expiry <= 36 && b.units > 0
      );
      if (nearBatches.length === 0) continue;

      const rescueUnits = Math.min(
        10,
        nearBatches.reduce((acc, b) => acc + b.units, 0)
      );
      const earliestExp = Math.min(...nearBatches.map((b) => b.hours_to_expiry));

      let bestDest: Facility | null = null;
      let bestBurn = 0;
      for (const dest of facilities) {
        if (dest.id === src.id) continue;
        if (dest.role !== 'TRAUMA_CENTER' && dest.role !== 'TERTIARY_HOSPITAL') continue;
        const destM = metricsMap.get(dest.id)![bt];
        if (
          destM.effective_hourly_burn > srcM.effective_hourly_burn * 1.4 &&
          destM.effective_hourly_burn > bestBurn
        ) {
          bestBurn = destM.effective_hourly_burn;
          bestDest = dest;
        }
      }

      if (bestDest) {
        const distKm = Number(
          haversineKm(src.lat, src.lng, bestDest.lat, bestDest.lng).toFixed(2)
        );
        const transitMin = Number(((distKm / 34) * 60 + 6).toFixed(1));
        const destM = metricsMap.get(bestDest.id)![bt];
        recs.push({
          id: `RESCUE-${src.code}-${bt}-${bestDest.code}`,
          category: 'EXPIRY_RESCUE',
          priority: 'MEDIUM',
          from_facility_id: src.id,
          from_code: src.code,
          from_name: src.short_name,
          to_facility_id: bestDest.id,
          to_code: bestDest.code,
          to_name: bestDest.short_name,
          source_blood_type: bt,
          target_blood_type: bt,
          is_compatibility_fallback: false,
          units: rescueUnits,
          distance_km: distKm,
          transit_minutes: transitMin,
          dest_runway_hours: destM.hours_of_supply,
          projected_dest_runway_hours: Number(
            ((destM.total_units + rescueUnits) / Math.max(0.05, bestBurn)).toFixed(1)
          ),
          earliest_batch_expiry_hours: Number(earliestExp.toFixed(1)),
          utility_score: 88,
          rationale: `FEFO Wastage Prevention: ${rescueUnits}u of ${bt} at ${src.short_name} expire in ${earliestExp.toFixed(
            1
          )}h. Transfer to high-burn ${bestDest.short_name} (${bestBurn.toFixed(2)}u/hr) before wastage.`,
        });
      }
    }
  }

  const pRank = { CRITICAL: 0, HIGH: 1, MEDIUM: 2 };
  recs.sort((a, b) => pRank[a.priority] - pRank[b.priority] || b.utility_score - a.utility_score);
  return recs.slice(0, 12);
}

export function createInitialNetworkStateLocal(): NetworkState {
  const specs: Array<[string, string, string, string, FacilityRole, string, number, number, number, number, number]> = [
    ['fac-metro-trauma', 'MTC-01', 'Metro Level-1 Trauma Center', 'Metro Trauma', 'TRAUMA_CENTER', 'Central Metro', 12.9716, 77.5946, 420, 1.45, 0.42],
    ['fac-central-bank', 'CBB-02', 'Central Municipal Blood Bank', 'Central Bank', 'MUNICIPAL_BLOOD_BANK', 'Central Metro', 12.985, 77.58, 950, 0.35, 1.85],
    ['fac-north-hub', 'NRH-03', 'North Corridor Regional Hub', 'North Hub', 'REGIONAL_HUB', 'North Corridor', 13.062, 77.592, 820, 0.4, 1.65],
    ['fac-north-ortho', 'NTH-04', 'North Highway Trauma & Ortho', 'North Trauma', 'TRAUMA_CENTER', 'North Corridor', 13.081, 77.628, 310, 1.15, 0.48],
    ['fac-east-onc', 'EOI-05', 'East Oncology & Hematology Inst.', 'East Oncology', 'ONCOLOGY_INSTITUTE', 'East Industrial', 12.978, 77.698, 380, 0.95, 0.72],
    ['fac-east-bank', 'EBB-06', 'East Industrial Blood Depository', 'East Bank', 'MUNICIPAL_BLOOD_BANK', 'East Industrial', 12.952, 77.715, 740, 0.32, 1.55],
    ['fac-south-harbor', 'SHG-07', 'South Harbor General Hospital', 'South Harbor', 'TERTIARY_HOSPITAL', 'South Harbor', 12.889, 77.612, 360, 1.05, 0.55],
    ['fac-south-cardiac', 'SCC-08', 'South Cardiac & Maternity Care', 'South Cardiac', 'TERTIARY_HOSPITAL', 'South Harbor', 12.872, 77.568, 340, 0.9, 0.65],
    ['fac-west-apex', 'WAT-09', 'West Apex Neuro & Trauma', 'West Apex', 'TRAUMA_CENTER', 'Central Metro', 12.955, 77.518, 390, 1.22, 0.52],
    ['fac-apex-reserve', 'ARC-10', 'Regional Cryo & Reserve Depot', 'Apex Reserve', 'REGIONAL_HUB', 'South Harbor', 12.904, 77.652, 900, 0.28, 1.75],
  ];

  const shares: Record<BloodType, number> = {
    'O+': 0.3, 'B+': 0.26, 'A+': 0.21, 'AB+': 0.08, 'O-': 0.06, 'A-': 0.04, 'B-': 0.03, 'AB-': 0.02,
  };

  const rng = seededRandom(42);
  const facilities: Facility[] = specs.map((spec, idx) => {
    const [id, code, name, short_name, role, zone, lat, lng, capacity_units, burnScale, stockScale] = spec;
    const inventory = {} as Record<BloodType, InventorySlot>;

    BLOOD_TYPES.forEach((bt, bIdx) => {
      const share = shares[bt];
      const base_hourly_burn = Number(Math.max(0.18, burnScale * share * 5.6).toFixed(2));
      let stress = stockScale;
      if (id === 'fac-metro-trauma' && (bt === 'O-' || bt === 'O+')) stress = 0.26;
      else if (id === 'fac-north-ortho' && (bt === 'O-' || bt === 'A+')) stress = 0.34;
      else if (id === 'fac-south-harbor' && (bt === 'B+' || bt === 'O+')) stress = 0.42;
      else if (id === 'fac-east-onc' && (bt === 'A-' || bt === 'AB-')) stress = 0.48;

      const targetUnits = Math.max(4, Math.round(capacity_units * share * 0.48 * stress));
      const batches: BloodBatch[] = [];
      let remaining = targetUnits;
      let bNum = 1;
      while (remaining > 0) {
        const chunk = Math.min(remaining, Math.max(3, Math.round(targetUnits * (0.28 + rng() * 0.22))));
        let expHours = Math.round(48 + rng() * 570);
        if (bNum === 1 && (role === 'MUNICIPAL_BLOOD_BANK' || role === 'ONCOLOGY_INSTITUTE') && rng() < 0.65) {
          expHours = Math.round(14 + rng() * 20);
        } else if (id === 'fac-east-onc' && bt === 'O+' && bNum === 1) {
          expHours = 18;
        }
        batches.push({
          id: `${code}-${bt.replace('+', 'P').replace('-', 'N')}-B${String(bNum).padStart(2, '0')}`,
          blood_type: bt,
          units: chunk,
          hours_to_expiry: expHours,
          origin_code: code,
        });
        remaining -= chunk;
        bNum++;
      }
      batches.sort((a, b) => a.hours_to_expiry - b.hours_to_expiry);
      inventory[bt] = {
        batches,
        base_hourly_burn,
        surge_multiplier: 1.0,
        history_30d_daily: generateHistory30d(base_hourly_burn * 24, 1000 + idx * 20 + bIdx),
      };
    });

    return {
      id, code, name, short_name, role, zone, lat, lng, capacity_units, inventory,
    };
  });

  const donorNames = [
    'Aarav Sharma', 'Priya Nair', 'Rohan Kulkarni', 'Ananya Iyer', 'Vikram Menon',
    'Sneha Reddy', 'Kabir Malhotra', 'Meera Krishnan', 'Arjun Verma', 'Diya Sengupta',
    'Siddharth Rao', 'Kavya Joshi', 'Aditya Patel', 'Nisha Gupta', 'Rahul Deshmukh',
    'Ishita Roy', 'Pranav Bhat', 'Tanvi Hegde', 'Karan Kapoor', 'Shruti Bansal',
    'Devansh Tiwari', 'Pooja Shetty', 'Nikhil Pillai', 'Riya Chatterjee', 'Harsh Vardhan',
    'Aishwarya Menon', 'Varun Gokhale', 'Neha Kulkarni', 'Surya Narayanan', 'Divya Krishnan',
    'Gaurav Saxena', 'Aditi Deshpande', 'Manish Agarwal', 'Swati Mishra', 'Omkar Pawar',
    'Lavanya Srinivas',
  ];
  const zoneCoords: Array<[string, number, number]> = [
    ['Central Metro', 12.9716, 77.5946],
    ['North Corridor', 13.07, 77.61],
    ['East Industrial', 12.965, 77.705],
    ['South Harbor', 12.885, 77.595],
  ];
  const cooldownChoices = [18, 42, 61, 74, 92, 118, 145, 210];

  const donors: DonorRecord[] = donorNames.map((name, i) => {
    const [zone, zLat, zLng] = zoneCoords[i % 4];
    let bt = BLOOD_TYPES[i % BLOOD_TYPES.length];
    if (i % 5 === 0) bt = 'O-';
    else if (i % 3 === 0) bt = 'O+';
    return {
      id: `DNR-${100 + i}`,
      name,
      blood_type: bt,
      zone,
      lat: Number((zLat + (rng() - 0.5) * 0.09).toFixed(5)),
      lng: Number((zLng + (rng() - 0.5) * 0.09).toFixed(5)),
      days_since_last_donation: cooldownChoices[i % cooldownChoices.length],
      mobilized: false,
    };
  });

  const baseState = {
    sim_hour: 0,
    season: 'NORMAL' as SeasonRegime,
    facilities,
    surges: [
      {
        id: 'SURGE-001',
        facility_id: 'fac-metro-trauma',
        blood_type: 'O-' as BloodType,
        multiplier: 1.75,
        total_duration_hours: 12,
        remaining_hours: 9.5,
        label: 'Multi-Vehicle Corridor Collision',
      },
    ],
    transfers: [
      {
        id: 'TX-901',
        from_facility_id: 'fac-central-bank',
        from_code: 'CBB-02',
        to_facility_id: 'fac-metro-trauma',
        to_code: 'MTC-01',
        source_blood_type: 'O+' as BloodType,
        target_blood_type: 'O+' as BloodType,
        is_compatibility_fallback: false,
        units: 14,
        distance_km: 2.18,
        total_transit_minutes: 18,
        remaining_minutes: 11,
        earliest_batch_expiry_hours: 210,
        status: 'IN_TRANSIT' as const,
        reason: 'Proactive AI Trauma Buffer',
      },
    ],
    donors,
    audit_log: [
      {
        id: 'LOG-001',
        sim_hour: 0,
        category: 'SYSTEM',
        message: 'HemoPulse AI Network synchronized 10 facilities across 4 zones.',
      },
      {
        id: 'LOG-002',
        sim_hour: 0,
        category: 'ALERT',
        message: 'Predictive Alert: MTC-01 O- projected below 12h threshold due to corridor collision.',
      },
    ],
  };

  return summarizeNetwork(baseState);
}

export function advanceSimulationLocal(state: NetworkState, hours: number): NetworkState {
  const next: NetworkState = JSON.parse(JSON.stringify(state));
  next.sim_hour = Number((next.sim_hour + hours).toFixed(2));

  for (const fac of next.facilities) {
    for (const bt of BLOOD_TYPES) {
      const slot = fac.inventory[bt];
      const m = computeSlotMetrics(fac, bt, next.season, next.surges);
      const demand = m.effective_hourly_burn * hours;
      const unitsToConsume = Math.floor(demand) + (Math.random() < demand - Math.floor(demand) ? 1 : 0);

      for (const b of slot.batches) {
        b.hours_to_expiry = Number((b.hours_to_expiry - hours).toFixed(2));
      }

      const expiredUnits = slot.batches
        .filter((b) => b.hours_to_expiry <= 0)
        .reduce((acc, b) => acc + b.units, 0);
      if (expiredUnits > 0) {
        next.audit_log.unshift({
          id: `LOG-${next.audit_log.length + 1}`,
          sim_hour: next.sim_hour,
          category: 'EXPIRY',
          message: `${expiredUnits}u of ${bt} expired at ${fac.code}.`,
        });
      }
      slot.batches = slot.batches.filter((b) => b.hours_to_expiry > 0 && b.units > 0);
      slot.batches.sort((a, b) => a.hours_to_expiry - b.hours_to_expiry);

      let rem = unitsToConsume;
      for (const b of slot.batches) {
        if (rem <= 0) break;
        const take = Math.min(b.units, rem);
        b.units -= take;
        rem -= take;
      }
      slot.batches = slot.batches.filter((b) => b.units > 0);
    }
  }

  next.surges = next.surges
    .map((s) => ({ ...s, remaining_hours: Math.max(0, Number((s.remaining_hours - hours).toFixed(2))) }))
    .filter((s) => s.remaining_hours > 0);

  const minutes = hours * 60;
  for (const tx of next.transfers) {
    if (tx.status === 'IN_TRANSIT') {
      tx.remaining_minutes = Math.max(0, Number((tx.remaining_minutes - minutes).toFixed(1)));
      if (tx.remaining_minutes <= 0) {
        tx.status = 'DELIVERED';
        const dest = next.facilities.find((f) => f.id === tx.to_facility_id);
        if (dest) {
          const slot = dest.inventory[tx.target_blood_type];
          slot.batches.push({
            id: `${tx.id}-DLV`,
            blood_type: tx.target_blood_type,
            units: tx.units,
            hours_to_expiry: Math.max(12, tx.earliest_batch_expiry_hours - hours),
            origin_code: tx.from_code,
          });
          slot.batches.sort((a, b) => a.hours_to_expiry - b.hours_to_expiry);
        }
        next.audit_log.unshift({
          id: `LOG-${next.audit_log.length + 1}`,
          sim_hour: next.sim_hour,
          category: 'DELIVERY',
          message: `${tx.id}: ${tx.units}u ${tx.source_blood_type} delivered ${tx.from_code} -> ${tx.to_code}.`,
        });
      }
    }
  }

  next.audit_log = next.audit_log.slice(0, 60);
  return summarizeNetwork(next);
}

export function buildForecastLocal(
  state: NetworkState,
  facilityId: string,
  bloodType: BloodType
): ForecastPayload {
  const fac = state.facilities.find((f) => f.id === facilityId) ?? state.facilities[0];
  const m = computeSlotMetrics(fac, bloodType, state.season, state.surges);
  const history = fac.inventory[bloodType].history_30d_daily;
  const n = history.length;

  // Linear regression
  const meanX = (n - 1) / 2;
  const meanY = history.reduce((a, b) => a + b, 0) / Math.max(1, n);
  let num = 0;
  let den = 0;
  history.forEach((y, x) => {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  });
  const slope = den > 0 ? num / den : 0;
  const dampedSlope = Math.max(-1.5, Math.min(2.5, slope * 0.45));
  const intercept = meanY - slope * meanX;

  const weeklyIndices: number[] = [];
  for (let dow = 0; dow < 7; dow++) {
    const samples = history.filter((_, idx) => idx % 7 === dow);
    const avg = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length);
    weeklyIndices.push(Number((avg / Math.max(0.1, meanY)).toFixed(3)));
  }

  const residuals = history.map((y, x) => y - (intercept + slope * x));
  const variance = residuals.reduce((acc, r) => acc + r * r, 0) / Math.max(1, n);
  const residualStd = Math.max(Math.sqrt(variance), 0.08 * meanY);

  const anchorDaily = 0.35 * history[n - 1] + 0.65 * (m.effective_hourly_burn * 24);
  const daily_forecast: ForecastDailyPoint[] = [];
  let projStock = m.total_units;
  let stockoutDay: number | null = null;

  for (let d = 1; d <= 14; d++) {
    const dowIdx = weeklyIndices[(n + d - 1) % 7];
    const meanDemand = Math.max(0.5, (anchorDaily + dampedSlope * d) * dowIdx);
    const spread = residualStd * Math.sqrt(d) * 0.55;
    projStock = Math.max(0, projStock - meanDemand);
    if (projStock <= 0 && stockoutDay === null) stockoutDay = d;

    daily_forecast.push({
      day: `D+${d}`,
      day_num: d,
      predicted_demand: Number(meanDemand.toFixed(2)),
      lower_80: Number(Math.max(0, meanDemand - 1.28 * spread).toFixed(2)),
      upper_80: Number((meanDemand + 1.28 * spread).toFixed(2)),
      lower_95: Number(Math.max(0, meanDemand - 1.96 * spread).toFixed(2)),
      upper_95: Number((meanDemand + 1.96 * spread).toFixed(2)),
      projected_inventory: Number(projStock.toFixed(1)),
    });
  }

  const hourly_burndown_72h: ForecastHourlyPoint[] = [];
  let invH = m.total_units;
  for (let h = 0; h <= 72; h += 4) {
    const diurnal = 1 + 0.14 * Math.sin((h / 24) * 2 * Math.PI);
    const band = residualStd * 0.18 * Math.sqrt(Math.max(1, h / 4));
    hourly_burndown_72h.push({
      hour: h,
      label: `+${h}h`,
      projected_units: Number(Math.max(0, invH).toFixed(1)),
      upper_band: Number(Math.max(0, invH + band).toFixed(1)),
      lower_band: Number(Math.max(0, invH - band).toFixed(1)),
    });
    invH = Math.max(0, invH - m.effective_hourly_burn * 4 * diurnal);
  }

  return {
    facility_id: fac.id,
    facility_code: fac.code,
    blood_type: bloodType,
    metrics: m,
    history_30d_daily: history,
    forecast: {
      model: 'Holt-Winters Damped Trend + 7d Seasonal Decomposition',
      trend_slope_daily: Number(dampedSlope.toFixed(3)),
      weekly_seasonality_indices: weeklyIndices,
      predicted_stockout_day: stockoutDay,
      daily_forecast,
      hourly_burndown_72h,
    },
  };
}

export function matchEligibleDonorsLocal(
  state: NetworkState,
  facilityId: string,
  targetBloodType: BloodType,
  radiusKm = 15
): DonorRecord[] {
  const fac = state.facilities.find((f) => f.id === facilityId);
  if (!fac) return [];
  const compat = new Set(RBC_COMPATIBILITY[targetBloodType]);
  return state.donors
    .filter((d) => d.days_since_last_donation >= DONOR_COOLDOWN_DAYS && compat.has(d.blood_type))
    .map((d) => ({
      ...d,
      distance_km: Number(haversineKm(fac.lat, fac.lng, d.lat, d.lng).toFixed(2)),
      exact_match: d.blood_type === targetBloodType,
    }))
    .filter((d) => (d.distance_km ?? 999) <= radiusKm)
    .sort((a, b) => Number(b.exact_match) - Number(a.exact_match) || (a.distance_km ?? 0) - (b.distance_km ?? 0));
}

export function generateBriefingLocal(state: NetworkState, question?: string): AiBriefingResponse {
  const leadReg = state.regions[0];
  const leadFac = state.facility_risks[0];
  const recs = state.recommendations.slice(0, 4);

  const lines = [
    `### Executive Situation Brief (Season: ${state.season} | T+${state.sim_hour.toFixed(1)}h)`,
    '',
    '**1. Threat & High-Risk Region Assessment**',
  ];
  if (leadReg) {
    lines.push(
      `- **Priority Zone:** \`${leadReg.zone}\` carries the highest composite risk score (\`${leadReg.avg_risk_score}/100\`) with \`${leadReg.critical_slots}\` critical blood-group slots and \`${leadReg.expiring_24h}\` units inside the 24h expiry window.`
    );
  }
  if (leadFac) {
    const critStr = leadFac.critical_types.length ? leadFac.critical_types.join(', ') : 'Watch-level buffer';
    lines.push(
      `- **Most Vulnerable Hospital:** \`${leadFac.code} (${leadFac.name})\` has a minimum runway of \`${leadFac.min_runway_hours}h\` (critical groups: \`${critStr}\`).`
    );
  }
  lines.push('', '**2. Recommended Coordinated Actions (FEFO + ABO/Rh Optimized)**');
  if (recs.length) {
    recs.forEach((r, i) => {
      lines.push(`${i + 1}. **[${r.priority}]** ${r.rationale}`);
    });
  } else {
    lines.push('- Network inventory is balanced across all 10 facilities.');
  }
  if (question) {
    lines.push('', `**3. Targeted Response:** *"${question}"*`);
    lines.push(
      `- Ring-fence \`O-\` universal packs for Level-1 Trauma (\`MTC-01\`, \`NTH-04\`, \`WAT-09\`), route near-expiry \`<36h\` batches to high-burn wards, and trigger 15km geo-donor mobilization for \`${leadReg?.zone ?? 'Central Metro'}\`.`
    );
  }

  return {
    provider: 'HemoPulse In-Browser Clinical Engine',
    live_llm: false,
    briefing: lines.join('\n'),
    telemetry_snapshot: `T+${state.sim_hour.toFixed(1)}h | ${state.season}`,
  };
}
