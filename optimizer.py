"""NetworkX + FEFO Multi-Objective Cold-Chain Optimizer & Donor Cascade Matcher."""

from __future__ import annotations

from typing import Dict, List

import networkx as nx

from .forecaster import compute_slot_metrics
from .models import BLOOD_TYPES, BloodType, RBC_COMPATIBILITY, SeasonRegime, haversine_km


def build_facility_graph(facilities: List[dict]) -> nx.Graph:
    g = nx.Graph()
    for f in facilities:
        g.add_node(f["id"], code=f["code"], zone=f["zone"], lat=f["lat"], lng=f["lng"])
    for i, f1 in enumerate(facilities):
        for f2 in facilities[i + 1 :]:
            dist = round(haversine_km(f1["lat"], f1["lng"], f2["lat"], f2["lng"]), 2)
            # Average urban cold-chain ambulance/van speed ~34 km/h + 6 min staging
            transit_min = round((dist / 34.0) * 60.0 + 6.0, 1)
            g.add_edge(f1["id"], f2["id"], distance_km=dist, transit_min=transit_min)
    return g


def compute_optimal_recommendations(state: dict, max_results: int = 12) -> List[dict]:
    """Generate ranked recommendations covering Shortage Mitigation, Compatible Fallback, and FEFO Expiry Rescue."""
    facilities = state["facilities"]
    season: SeasonRegime = state["season"]
    surges = state["surges"]
    graph = build_facility_graph(facilities)

    fac_by_id: Dict[str, dict] = {f["id"]: f for f in facilities}
    metrics_cache: Dict[str, Dict[BloodType, dict]] = {
        f["id"]: {bt: compute_slot_metrics(f, bt, season, surges) for bt in BLOOD_TYPES}
        for f in facilities
    }

    recommendations: List[dict] = []

    # 1. Deficit-driven Shortage Mitigation (Exact Match + Safe Compatible Fallback)
    for dest in facilities:
        for target_bt in BLOOD_TYPES:
            dest_m = metrics_cache[dest["id"]][target_bt]
            if dest_m["risk_level"] == "OPTIMAL":
                continue

            desired_units = max(4, min(18, int(round(dest_m["effective_hourly_burn"] * 24.0 - dest_m["total_units"]))))
            if desired_units <= 0:
                desired_units = 6

            best_candidate = None
            best_score = -1e9

            for src in facilities:
                if src["id"] == dest["id"]:
                    continue

                edge = graph[src["id"]][dest["id"]]
                dist_km = edge["distance_km"]
                transit_min = edge["transit_min"]

                for compat_rank, src_bt in enumerate(RBC_COMPATIBILITY[target_bt]):
                    src_m = metrics_cache[src["id"]][src_bt]
                    # Reserve at least 20h of supply at source
                    safe_reserve = max(4, int(round(src_m["effective_hourly_burn"] * 20.0)))
                    available_surplus = src_m["total_units"] - safe_reserve
                    if available_surplus < 3:
                        continue

                    send_units = min(desired_units, available_surplus)
                    is_fallback = src_bt != target_bt

                    # Prefer FEFO batches that aren't about to expire before delivery
                    batches = [
                        b for b in src["inventory"][src_bt]["batches"]
                        if b["units"] > 0 and b["hours_to_expiry"] > (transit_min / 60.0 + 4.0)
                    ]
                    if not batches:
                        continue
                    earliest_exp = min(b["hours_to_expiry"] for b in batches)

                    # Multi-objective utility score
                    urgency_bonus = 120.0 if dest_m["risk_level"] == "CRITICAL" else 65.0
                    exact_bonus = 45.0 if not is_fallback else -12.0 * compat_rank
                    # Preserve O- universal stock unless destination is critical
                    universal_penalty = 20.0 if (is_fallback and src_bt == "O-" and dest_m["risk_level"] != "CRITICAL") else 0.0
                    expiry_rescue_bonus = 28.0 if earliest_exp <= 36.0 else 0.0
                    distance_penalty = dist_km * 1.4

                    score = urgency_bonus + exact_bonus + expiry_rescue_bonus - distance_penalty - universal_penalty
                    if score > best_score:
                        best_score = score
                        best_candidate = {
                            "id": f"REC-{dest['code']}-{target_bt}-{src['code']}-{src_bt}",
                            "category": "COMPATIBLE_FALLBACK" if is_fallback else "SHORTAGE_MITIGATION",
                            "priority": "CRITICAL" if dest_m["risk_level"] == "CRITICAL" else "HIGH",
                            "from_facility_id": src["id"],
                            "from_code": src["code"],
                            "from_name": src["short_name"],
                            "to_facility_id": dest["id"],
                            "to_code": dest["code"],
                            "to_name": dest["short_name"],
                            "source_blood_type": src_bt,
                            "target_blood_type": target_bt,
                            "is_compatibility_fallback": is_fallback,
                            "units": send_units,
                            "distance_km": dist_km,
                            "transit_minutes": transit_min,
                            "dest_runway_hours": dest_m["hours_of_supply"],
                            "projected_dest_runway_hours": round(
                                (dest_m["total_units"] + send_units) / max(0.05, dest_m["effective_hourly_burn"]), 1
                            ),
                            "earliest_batch_expiry_hours": round(earliest_exp, 1),
                            "utility_score": round(score, 1),
                            "rationale": (
                                f"{dest['short_name']} hits {dest_m['hours_of_supply']}h runway on {target_bt}. "
                                f"Route {send_units}u {src_bt}"
                                + (f" (ABO/Rh compatible substitute for {target_bt})" if is_fallback else "")
                                + f" from {src['short_name']} ({dist_km} km, ~{int(round(transit_min))}m)."
                            ),
                        }

            if best_candidate:
                recommendations.append(best_candidate)

    # 2. Proactive FEFO Expiry-Rescue Swaps (save near-expiry <36h batches at low-burn nodes)
    for src in facilities:
        for bt in BLOOD_TYPES:
            src_m = metrics_cache[src["id"]][bt]
            if src_m["expiring_48h"] < 3 or src_m["hours_of_supply"] < 32.0:
                continue

            near_batches = [b for b in src["inventory"][bt]["batches"] if 4.0 < b["hours_to_expiry"] <= 36.0 and b["units"] > 0]
            if not near_batches:
                continue
            rescue_units = min(10, sum(b["units"] for b in near_batches))
            earliest_exp = min(b["hours_to_expiry"] for b in near_batches)

            # Find highest-burn compatible hospital that will consume before expiry
            best_dest = None
            best_burn = 0.0
            for dest in facilities:
                if dest["id"] == src["id"]:
                    continue
                if dest["role"] not in ("TRAUMA_CENTER", "TERTIARY_HOSPITAL"):
                    continue
                dest_m = metrics_cache[dest["id"]][bt]
                if dest_m["effective_hourly_burn"] > src_m["effective_hourly_burn"] * 1.4 and dest_m["effective_hourly_burn"] > best_burn:
                    best_burn = dest_m["effective_hourly_burn"]
                    best_dest = dest

            if best_dest:
                edge = graph[src["id"]][best_dest["id"]]
                recommendations.append({
                    "id": f"RESCUE-{src['code']}-{bt}-{best_dest['code']}",
                    "category": "EXPIRY_RESCUE",
                    "priority": "MEDIUM",
                    "from_facility_id": src["id"],
                    "from_code": src["code"],
                    "from_name": src["short_name"],
                    "to_facility_id": best_dest["id"],
                    "to_code": best_dest["code"],
                    "to_name": best_dest["short_name"],
                    "source_blood_type": bt,
                    "target_blood_type": bt,
                    "is_compatibility_fallback": False,
                    "units": rescue_units,
                    "distance_km": edge["distance_km"],
                    "transit_minutes": edge["transit_min"],
                    "dest_runway_hours": metrics_cache[best_dest["id"]][bt]["hours_of_supply"],
                    "projected_dest_runway_hours": round(
                        (metrics_cache[best_dest["id"]][bt]["total_units"] + rescue_units) / max(0.05, best_burn), 1
                    ),
                    "earliest_batch_expiry_hours": round(earliest_exp, 1),
                    "utility_score": 88.0,
                    "rationale": (
                        f"FEFO Wastage Prevention: {rescue_units}u of {bt} at {src['short_name']} expire in "
                        f"{round(earliest_exp, 1)}h. Transfer to high-burn {best_dest['short_name']} "
                        f"({best_burn:.2f}u/hr) for immediate clinical utilization."
                    ),
                })

    priority_rank = {"CRITICAL": 0, "HIGH": 1, "MEDIUM": 2}
    recommendations.sort(key=lambda r: (priority_rank.get(r["priority"], 3), -r["utility_score"]))
    return recommendations[:max_results]


def match_eligible_donors(
    state: dict,
    target_facility_id: str,
    target_blood_type: BloodType,
    radius_km: float = 15.0,
) -> List[dict]:
    fac = next((f for f in state["facilities"] if f["id"] == target_facility_id), None)
    if not fac:
        return []

    compatible_types = set(RBC_COMPATIBILITY[target_blood_type])
    eligible: List[dict] = []
    for d in state["donors"]:
        if d["days_since_last_donation"] < 56:
            continue
        if d["blood_type"] not in compatible_types:
            continue
        dist = round(haversine_km(fac["lat"], fac["lng"], d["lat"], d["lng"]), 2)
        if dist <= radius_km:
            eligible.append({
                **d,
                "distance_km": dist,
                "exact_match": d["blood_type"] == target_blood_type,
            })

    eligible.sort(key=lambda x: (not x["exact_match"], x["distance_km"]))
    return eligible
