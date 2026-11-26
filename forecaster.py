"""AI Predictive Forecasting Engine (Holt-Winters Trend + Seasonal Decomposition + Confidence Intervals)."""

from __future__ import annotations

import math
from typing import Dict, List, Tuple

import numpy as np

from .models import BLOOD_TYPES, BloodType, SEASON_PROFILES, SeasonRegime


def compute_effective_hourly_burn(
    slot: dict,
    zone: str,
    blood_type: BloodType,
    season: SeasonRegime,
    active_surges: List[dict],
    facility_id: str,
) -> float:
    profile = SEASON_PROFILES[season]
    season_global = float(profile["global_multiplier"])
    type_mult = float(profile["type_multipliers"][blood_type])
    zone_mult = float(profile["zone_multipliers"].get(zone, 1.0))

    surge_mult = 1.0
    for s in active_surges:
        if s["facility_id"] == facility_id and s["blood_type"] == blood_type and s["remaining_hours"] > 0:
            surge_mult = max(surge_mult, float(s["multiplier"]))

    base = float(slot["base_hourly_burn"])
    return round(base * season_global * type_mult * zone_mult * surge_mult, 3)


def compute_slot_metrics(
    facility: dict,
    blood_type: BloodType,
    season: SeasonRegime,
    active_surges: List[dict],
) -> dict:
    slot = facility["inventory"][blood_type]
    batches = [b for b in slot["batches"] if b["units"] > 0]
    total_units = sum(b["units"] for b in batches)
    expiring_24h = sum(b["units"] for b in batches if b["hours_to_expiry"] <= 24.0)
    expiring_48h = sum(b["units"] for b in batches if b["hours_to_expiry"] <= 48.0)
    earliest_expiry = min((b["hours_to_expiry"] for b in batches), default=999.0)

    effective_burn = compute_effective_hourly_burn(
        slot, facility["zone"], blood_type, season, active_surges, facility["id"]
    )
    hours_of_supply = round(total_units / max(0.05, effective_burn), 1)

    if hours_of_supply < 12.0 or total_units <= 3:
        risk_level = "CRITICAL"
    elif hours_of_supply < 28.0:
        risk_level = "WATCH"
    else:
        risk_level = "OPTIMAL"

    # Risk score 0..100 combining runway deficit + expiry wastage risk
    runway_risk = max(0.0, min(85.0, (40.0 - min(40.0, hours_of_supply)) * 2.125))
    expiry_risk = min(15.0, (expiring_24h / max(1, total_units)) * 15.0)
    risk_score = round(min(100.0, runway_risk + expiry_risk), 1)

    return {
        "total_units": total_units,
        "effective_hourly_burn": effective_burn,
        "hours_of_supply": hours_of_supply,
        "expiring_24h": expiring_24h,
        "expiring_48h": expiring_48h,
        "earliest_expiry_hours": round(earliest_expiry, 1),
        "risk_level": risk_level,
        "risk_score": risk_score,
    }


def forecast_14_days(
    history_30d: List[float],
    effective_hourly_burn: float,
    current_units: int,
    horizon_days: int = 14,
) -> dict:
    """Fit damped linear trend + 7-day seasonal index on 30-day consumption and emit 14-day CI forecast."""
    arr = np.array(history_30d if len(history_30d) >= 7 else [effective_hourly_burn * 24.0] * 14, dtype=float)
    n = len(arr)

    # Linear regression slope over 30 days (damped for clinical stability)
    x = np.arange(n, dtype=float)
    slope, intercept = np.polyfit(x, arr, 1)
    damped_slope = float(np.clip(slope * 0.45, -1.5, 2.5))

    # Day-of-week seasonal indices from trailing weeks
    weekly_indices: List[float] = []
    mean_val = float(np.mean(arr)) or 1.0
    for dow in range(7):
        samples = arr[dow::7]
        weekly_indices.append(float(np.mean(samples) / mean_val) if len(samples) > 0 else 1.0)

    # Residual std for prediction intervals
    fitted = intercept + slope * x
    residual_std = float(np.std(arr - fitted))
    residual_std = max(residual_std, 0.08 * mean_val)

    current_daily_burn = effective_hourly_burn * 24.0
    # Blend statistical baseline with active live burn rate (captures immediate surges)
    anchor_daily = 0.35 * float(arr[-1]) + 0.65 * current_daily_burn

    daily_points = []
    projected_stock = float(current_units)
    stockout_day = None

    for d in range(1, horizon_days + 1):
        dow_idx = weekly_indices[(n + d - 1) % 7]
        mean_demand = max(0.5, (anchor_daily + damped_slope * d) * dow_idx)
        spread = residual_std * math.sqrt(d) * 0.55

        p_low95 = max(0.0, mean_demand - 1.96 * spread)
        p_low80 = max(0.0, mean_demand - 1.28 * spread)
        p_high80 = mean_demand + 1.28 * spread
        p_high95 = mean_demand + 1.96 * spread

        projected_stock = max(0.0, projected_stock - mean_demand)
        if projected_stock <= 0 and stockout_day is None:
            stockout_day = d

        daily_points.append({
            "day": f"D+{d}",
            "day_num": d,
            "predicted_demand": round(mean_demand, 2),
            "lower_80": round(p_low80, 2),
            "upper_80": round(p_high80, 2),
            "lower_95": round(p_low95, 2),
            "upper_95": round(p_high95, 2),
            "projected_inventory": round(projected_stock, 1),
        })

    # Also build 72-hour granular burn-down curve
    hourly_points = []
    inv_h = float(current_units)
    for h in range(0, 73, 4):
        diurnal = 1.0 + 0.14 * math.sin((h / 24.0) * 2 * math.pi)
        hourly_points.append({
            "hour": h,
            "label": f"+{h}h",
            "projected_units": round(max(0.0, inv_h), 1),
            "upper_band": round(max(0.0, inv_h + residual_std * 0.18 * math.sqrt(max(1, h / 4))), 1),
            "lower_band": round(max(0.0, inv_h - residual_std * 0.18 * math.sqrt(max(1, h / 4))), 1),
        })
        inv_h = max(0.0, inv_h - effective_hourly_burn * 4.0 * diurnal)

    return {
        "model": "Holt-Winters Damped Trend + 7d Seasonal Decomposition",
        "trend_slope_daily": round(damped_slope, 3),
        "weekly_seasonality_indices": [round(v, 3) for v in weekly_indices],
        "predicted_stockout_day": stockout_day,
        "daily_forecast": daily_points,
        "hourly_burndown_72h": hourly_points,
    }


def summarize_regional_risk(state: dict) -> Tuple[List[dict], List[dict]]:
    """Aggregate shortage risk by geographic zone and rank high-risk facilities."""
    season: SeasonRegime = state["season"]
    surges = state["surges"]
    zone_map: Dict[str, dict] = {}
    facility_risks: List[dict] = []

    for fac in state["facilities"]:
        zone = fac["zone"]
        if zone not in zone_map:
            zone_map[zone] = {
                "zone": zone,
                "facilities": 0,
                "total_units": 0,
                "critical_slots": 0,
                "watch_slots": 0,
                "expiring_24h": 0,
                "avg_risk_score": 0.0,
                "_scores": [],
            }

        fac_units = 0
        fac_crit = 0
        fac_watch = 0
        fac_exp24 = 0
        min_runway = 999.0
        critical_types: List[str] = []
        slot_scores: List[float] = []

        for bt in BLOOD_TYPES:
            m = compute_slot_metrics(fac, bt, season, surges)
            fac_units += m["total_units"]
            fac_exp24 += m["expiring_24h"]
            slot_scores.append(m["risk_score"])
            if m["hours_of_supply"] < min_runway:
                min_runway = m["hours_of_supply"]
            if m["risk_level"] == "CRITICAL":
                fac_crit += 1
                critical_types.append(bt)
            elif m["risk_level"] == "WATCH":
                fac_watch += 1

        max_score = max(slot_scores) if slot_scores else 0.0
        avg_score = round(sum(slot_scores) / max(1, len(slot_scores)), 1)

        z = zone_map[zone]
        z["facilities"] += 1
        z["total_units"] += fac_units
        z["critical_slots"] += fac_crit
        z["watch_slots"] += fac_watch
        z["expiring_24h"] += fac_exp24
        z["_scores"].append(max_score)

        facility_risks.append({
            "facility_id": fac["id"],
            "code": fac["code"],
            "name": fac["name"],
            "zone": zone,
            "role": fac["role"],
            "total_units": fac_units,
            "min_runway_hours": round(min_runway, 1),
            "critical_slots": fac_crit,
            "watch_slots": fac_watch,
            "critical_types": critical_types,
            "expiring_24h": fac_exp24,
            "peak_risk_score": round(max_score, 1),
            "avg_risk_score": avg_score,
        })

    regions = []
    for z in zone_map.values():
        scores = z.pop("_scores")
        z["avg_risk_score"] = round(sum(scores) / max(1, len(scores)), 1)
        z["status"] = (
            "CRITICAL" if z["critical_slots"] >= 2 else ("WATCH" if z["critical_slots"] == 1 or z["watch_slots"] >= 3 else "OPTIMAL")
        )
        regions.append(z)

    regions.sort(key=lambda r: r["avg_risk_score"], reverse=True)
    facility_risks.sort(key=lambda f: f["peak_risk_score"], reverse=True)
    return regions, facility_risks
