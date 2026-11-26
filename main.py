"""HemoPulse AI Starlette + Uvicorn REST API Server."""

from __future__ import annotations

import os
import random
from typing import Any, Dict

from starlette.applications import Starlette
from starlette.middleware import Middleware
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from .forecaster import compute_slot_metrics, forecast_14_days, summarize_regional_risk
from .gemini_advisor import generate_ai_briefing
from .models import (
    BLOOD_TYPES,
    SEASON_PROFILES,
    create_initial_network_state,
    haversine_km,
)
from .optimizer import compute_optimal_recommendations, match_eligible_donors

STATE: Dict[str, Any] = create_initial_network_state()


def _append_log(category: str, message: str) -> None:
    log_id = f"LOG-{len(STATE['audit_log']) + 1:03d}"
    STATE["audit_log"].insert(
        0,
        {
            "id": log_id,
            "sim_hour": round(STATE["sim_hour"], 1),
            "category": category,
            "message": message,
        },
    )
    STATE["audit_log"] = STATE["audit_log"][:60]


def _enriched_payload() -> dict:
    regions, fac_risks = summarize_regional_risk(STATE)
    recs = compute_optimal_recommendations(STATE)
    return {
        **STATE,
        "regions": regions,
        "facility_risks": fac_risks,
        "recommendations": recs,
        "season_profiles": SEASON_PROFILES,
    }


async def health(request: Request) -> JSONResponse:
    return JSONResponse({
        "status": "ok",
        "service": "HemoPulse AI Backend",
        "gemini_enabled": bool(os.environ.get("GEMINI_API_KEY", "").strip()),
    })


async def get_state(request: Request) -> JSONResponse:
    return JSONResponse(_enriched_payload())


async def reset_state(request: Request) -> JSONResponse:
    global STATE
    STATE = create_initial_network_state()
    return JSONResponse(_enriched_payload())


async def advance_sim(request: Request) -> JSONResponse:
    body = await request.json()
    hours = float(body.get("hours", 1.0))
    hours = max(0.25, min(24.0, hours))

    STATE["sim_hour"] = round(STATE["sim_hour"] + hours, 2)
    season = STATE["season"]
    surges = STATE["surges"]

    # Consume inventory FEFO + age batches
    for fac in STATE["facilities"]:
        for bt in BLOOD_TYPES:
            slot = fac["inventory"][bt]
            m = compute_slot_metrics(fac, bt, season, surges)
            demand = m["effective_hourly_burn"] * hours
            # Probabilistic integer consumption with deterministic floor
            units_to_consume = int(demand) + (1 if random.random() < (demand - int(demand)) else 0)

            for b in slot["batches"]:
                b["hours_to_expiry"] = round(b["hours_to_expiry"] - hours, 2)

            # Remove expired units
            expired = [b for b in slot["batches"] if b["hours_to_expiry"] <= 0]
            if expired:
                exp_units = sum(b["units"] for b in expired)
                if exp_units > 0:
                    _append_log("EXPIRY", f"{exp_units}u of {bt} expired at {fac['code']}.")
            slot["batches"] = [b for b in slot["batches"] if b["hours_to_expiry"] > 0 and b["units"] > 0]

            # Deduct FEFO
            slot["batches"].sort(key=lambda b: b["hours_to_expiry"])
            rem = units_to_consume
            for b in slot["batches"]:
                if rem <= 0:
                    break
                take = min(b["units"], rem)
                b["units"] -= take
                rem -= take
            slot["batches"] = [b for b in slot["batches"] if b["units"] > 0]

    # Advance surges
    for s in surges:
        s["remaining_hours"] = max(0.0, round(s["remaining_hours"] - hours, 2))
    STATE["surges"] = [s for s in surges if s["remaining_hours"] > 0]

    # Advance cold chain transfers
    minutes = hours * 60.0
    for tx in STATE["transfers"]:
        if tx["status"] == "IN_TRANSIT":
            tx["remaining_minutes"] = max(0.0, round(tx["remaining_minutes"] - minutes, 1))
            if tx["remaining_minutes"] <= 0:
                tx["status"] = "DELIVERED"
                dest = next((f for f in STATE["facilities"] if f["id"] == tx["to_facility_id"]), None)
                if dest:
                    slot = dest["inventory"][tx["target_blood_type"]]
                    slot["batches"].append({
                        "id": f"{tx['id']}-DLV",
                        "blood_type": tx["target_blood_type"],
                        "units": tx["units"],
                        "hours_to_expiry": max(12.0, tx["earliest_batch_expiry_hours"] - hours),
                        "origin_code": tx["from_code"],
                    })
                    slot["batches"].sort(key=lambda b: b["hours_to_expiry"])
                _append_log(
                    "DELIVERY",
                    f"{tx['id']}: {tx['units']}u {tx['source_blood_type']} delivered {tx['from_code']} -> {tx['to_code']}.",
                )

    return JSONResponse(_enriched_payload())


async def set_season(request: Request) -> JSONResponse:
    body = await request.json()
    season = body.get("season", "NORMAL")
    if season not in SEASON_PROFILES:
        return JSONResponse({"error": "Invalid season regime"}, status_code=400)
    STATE["season"] = season
    _append_log("SEASON", f"Forecasting regime switched to {SEASON_PROFILES[season]['label']}.")
    return JSONResponse(_enriched_payload())


async def add_surge(request: Request) -> JSONResponse:
    body = await request.json()
    fac_id = body["facility_id"]
    bt = body["blood_type"]
    mult = float(body.get("multiplier", 1.8))
    duration = float(body.get("duration_hours", 12.0))
    label = body.get("label", "Emergency Trauma Surge")

    fac = next((f for f in STATE["facilities"] if f["id"] == fac_id), None)
    if not fac or bt not in BLOOD_TYPES:
        return JSONResponse({"error": "Invalid facility or blood type"}, status_code=400)

    surge = {
        "id": f"SURGE-{len(STATE['surges']) + 101}",
        "facility_id": fac_id,
        "blood_type": bt,
        "multiplier": mult,
        "total_duration_hours": duration,
        "remaining_hours": duration,
        "label": label,
    }
    STATE["surges"].append(surge)
    _append_log("SURGE", f"{label} at {fac['code']} ({bt} x{mult:.1f} for {int(duration)}h).")
    return JSONResponse(_enriched_payload())


async def add_batch(request: Request) -> JSONResponse:
    body = await request.json()
    fac_id = body["facility_id"]
    bt = body["blood_type"]
    units = int(body["units"])
    expiry_hours = float(body["hours_to_expiry"])

    fac = next((f for f in STATE["facilities"] if f["id"] == fac_id), None)
    if not fac or bt not in BLOOD_TYPES or units <= 0:
        return JSONResponse({"error": "Invalid batch payload"}, status_code=400)

    slot = fac["inventory"][bt]
    batch_id = f"{fac['code']}-{bt.replace('+', 'P').replace('-', 'N')}-{random.randint(100, 999)}"
    slot["batches"].append({
        "id": batch_id,
        "blood_type": bt,
        "units": units,
        "hours_to_expiry": expiry_hours,
        "origin_code": fac["code"],
    })
    slot["batches"].sort(key=lambda b: b["hours_to_expiry"])
    _append_log("INVENTORY", f"Logged {units}u {bt} batch ({batch_id}, exp {int(expiry_hours)}h) at {fac['code']}.")
    return JSONResponse(_enriched_payload())


async def dispatch_transfer(request: Request) -> JSONResponse:
    body = await request.json()
    src_id = body["from_facility_id"]
    dest_id = body["to_facility_id"]
    src_bt = body["source_blood_type"]
    target_bt = body.get("target_blood_type", src_bt)
    units = int(body["units"])
    reason = body.get("reason", "AI Coordinated Transfer")

    src = next((f for f in STATE["facilities"] if f["id"] == src_id), None)
    dest = next((f for f in STATE["facilities"] if f["id"] == dest_id), None)
    if not src or not dest or src_bt not in BLOOD_TYPES:
        return JSONResponse({"error": "Invalid transfer parameters"}, status_code=400)

    slot = src["inventory"][src_bt]
    slot["batches"].sort(key=lambda b: b["hours_to_expiry"])
    available = sum(b["units"] for b in slot["batches"])
    send_units = min(units, available)
    if send_units <= 0:
        return JSONResponse({"error": "Insufficient source units"}, status_code=400)

    rem = send_units
    earliest_exp = 999.0
    for b in slot["batches"]:
        if rem <= 0:
            break
        take = min(b["units"], rem)
        if take > 0:
            earliest_exp = min(earliest_exp, b["hours_to_expiry"])
            b["units"] -= take
            rem -= take
    slot["batches"] = [b for b in slot["batches"] if b["units"] > 0]

    dist = round(haversine_km(src["lat"], src["lng"], dest["lat"], dest["lng"]), 2)
    transit_min = round((dist / 34.0) * 60.0 + 6.0, 1)

    tx = {
        "id": f"TX-{len(STATE['transfers']) + 901}",
        "from_facility_id": src_id,
        "from_code": src["code"],
        "to_facility_id": dest_id,
        "to_code": dest["code"],
        "source_blood_type": src_bt,
        "target_blood_type": target_bt,
        "is_compatibility_fallback": src_bt != target_bt,
        "units": send_units,
        "distance_km": dist,
        "total_transit_minutes": transit_min,
        "remaining_minutes": transit_min,
        "earliest_batch_expiry_hours": round(earliest_exp, 1),
        "status": "IN_TRANSIT",
        "reason": reason,
    }
    STATE["transfers"].insert(0, tx)
    _append_log("DISPATCH", f"Dispatched {send_units}u {src_bt} {src['code']} -> {dest['code']} (ETA {int(round(transit_min))}m).")
    return JSONResponse(_enriched_payload())


async def get_forecast(request: Request) -> JSONResponse:
    fac_id = request.query_params.get("facility_id", STATE["facilities"][0]["id"])
    bt = request.query_params.get("blood_type", "O-")
    fac = next((f for f in STATE["facilities"] if f["id"] == fac_id), None)
    if not fac or bt not in BLOOD_TYPES:
        return JSONResponse({"error": "Invalid facility or blood type"}, status_code=400)

    m = compute_slot_metrics(fac, bt, STATE["season"], STATE["surges"])
    fc = forecast_14_days(
        fac["inventory"][bt]["history_30d_daily"],
        m["effective_hourly_burn"],
        m["total_units"],
    )
    return JSONResponse({
        "facility_id": fac_id,
        "facility_code": fac["code"],
        "blood_type": bt,
        "metrics": m,
        "history_30d_daily": fac["inventory"][bt]["history_30d_daily"],
        "forecast": fc,
    })


async def mobilize_donors(request: Request) -> JSONResponse:
    body = await request.json()
    fac_id = body["facility_id"]
    bt = body["blood_type"]
    radius_km = float(body.get("radius_km", 15.0))
    matched = match_eligible_donors(STATE, fac_id, bt, radius_km)
    ids = {d["id"] for d in matched[:8]}
    for d in STATE["donors"]:
        if d["id"] in ids:
            d["mobilized"] = True
    fac = next((f for f in STATE["facilities"] if f["id"] == fac_id), None)
    if fac:
        _append_log("DONOR", f"Mobilized {len(ids)} eligible donors within {int(radius_km)}km for {fac['code']} ({bt}).")
    return JSONResponse({"mobilized_count": len(ids), "eligible_donors": matched, "state": _enriched_payload()})


async def ai_brief(request: Request) -> JSONResponse:
    body = await request.json() if request.method == "POST" else {}
    question = body.get("question")
    return JSONResponse(generate_ai_briefing(STATE, question=question))


routes = [
    Route("/api/health", health, methods=["GET"]),
    Route("/api/state", get_state, methods=["GET"]),
    Route("/api/reset", reset_state, methods=["POST"]),
    Route("/api/sim/advance", advance_sim, methods=["POST"]),
    Route("/api/season", set_season, methods=["POST"]),
    Route("/api/surges", add_surge, methods=["POST"]),
    Route("/api/inventory/batch", add_batch, methods=["POST"]),
    Route("/api/transfers/dispatch", dispatch_transfer, methods=["POST"]),
    Route("/api/forecast", get_forecast, methods=["GET"]),
    Route("/api/donors/mobilize", mobilize_donors, methods=["POST"]),
    Route("/api/ai/brief", ai_brief, methods=["POST"]),
]

middleware = [
    Middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
]

app = Starlette(routes=routes, middleware=middleware)
