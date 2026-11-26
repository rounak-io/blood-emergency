"""Gemini AI Clinical Logistics Advisor with deterministic intelligent fallback."""

from __future__ import annotations

import os
from typing import Optional

import requests

from .forecaster import summarize_regional_risk
from .optimizer import compute_optimal_recommendations


def generate_ai_briefing(state: dict, question: Optional[str] = None) -> dict:
    """Produce an actionable situation report or answer a custom operational question."""
    regions, fac_risks = summarize_regional_risk(state)
    recs = compute_optimal_recommendations(state, max_results=5)

    top_facs = fac_risks[:3]
    top_regions = regions[:2]

    telemetry_summary = (
        f"Simulation Hour: {state['sim_hour']:.1f}h | Season Regime: {state['season']}\n"
        f"Highest-Risk Regions: "
        + ", ".join(f"{r['zone']} (avg risk {r['avg_risk_score']}/100, {r['critical_slots']} critical slots)" for r in top_regions)
        + "\nCritical Hospitals: "
        + ", ".join(f"{f['code']} {f['name']} (min runway {f['min_runway_hours']}h, critical: {f['critical_types']})" for f in top_facs)
        + "\nTop AI Transfer Recommendations:\n"
        + "\n".join(f"- [{r['priority']}] {r['rationale']}" for r in recs)
    )

    api_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if api_key:
        prompt = (
            "You are HemoPulse AI, an emergency medical blood-network command advisor. "
            "Given the live telemetry below, provide a crisp, structured 3-part clinical logistics response: "
            "(1) Threat Assessment, (2) Immediate Dispatch & FEFO Actions, (3) Donor & Surge Preparedness.\n\n"
            f"TELEMETRY:\n{telemetry_summary}\n\n"
            f"USER QUERY: {question or 'Provide an executive network readiness and shortage prevention briefing.'}"
        )
        try:
            resp = requests.post(
                f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={api_key}",
                json={"contents": [{"parts": [{"text": prompt}]}]},
                timeout=12,
            )
            if resp.ok:
                data = resp.json()
                text = (
                    data.get("candidates", [{}])[0]
                    .get("content", {})
                    .get("parts", [{}])[0]
                    .get("text", "")
                )
                if text:
                    return {
                        "provider": "Google Gemini 2.5 Flash",
                        "live_llm": True,
                        "briefing": text,
                        "telemetry_snapshot": telemetry_summary,
                    }
        except Exception:
            pass

    # Deterministic clinical reasoning fallback (always available offline/without key)
    lead_fac = top_facs[0] if top_facs else None
    lead_reg = top_regions[0] if top_regions else None

    lines = [
        f"### Executive Situation Brief (Season: {state['season']} | T+{state['sim_hour']:.1f}h)",
        "",
        "**1. Threat & High-Risk Region Assessment**",
    ]
    if lead_reg:
        lines.append(
            f"- **Priority Zone:** `{lead_reg['zone']}` carries the highest composite risk score "
            f"(`{lead_reg['avg_risk_score']}/100`) with `{lead_reg['critical_slots']}` critical blood-group slots "
            f"and `{lead_reg['expiring_24h']}` units within the 24-hour expiry window."
        )
    if lead_fac:
        crit_str = ", ".join(lead_fac["critical_types"]) if lead_fac["critical_types"] else "Watch-level buffer"
        lines.append(
            f"- **Most Vulnerable Hospital:** `{lead_fac['code']} ({lead_fac['name']})` has a minimum runway of "
            f"`{lead_fac['min_runway_hours']}h` (critical groups: `{crit_str}`)."
        )

    lines.extend(["", "**2. Recommended Coordinated Actions (FEFO + ABO/Rh Optimized)**"])
    if recs:
        for idx, rec in enumerate(recs[:4], start=1):
            lines.append(f"{idx}. **[{rec['priority']}]** {rec['rationale']}")
    else:
        lines.append("- Network inventory is balanced across all 10 facilities; no urgent transfers required.")

    if question:
        q_lower = question.lower()
        lines.extend(["", f"**3. Targeted Answer to Query:** *\"{question}\"*"])
        if "o-" in q_lower or "universal" in q_lower:
            lines.append(
                "- Universal `O-` reserves should be ring-fenced for Level-1 Trauma (`MTC-01`, `NTH-04`, `WAT-09`) "
                "while non-emergency `O+`/`A+`/`B+` demand is fulfilled via type-specific or compatible hubs."
            )
        elif "expir" in q_lower or "waste" in q_lower or "fefo" in q_lower:
            total_exp = sum(r["expiring_24h"] for r in regions)
            lines.append(
                f"- Currently `{total_exp}` units across the network expire within 24h. Executing the FEFO "
                "Expiry-Rescue swaps above redirects near-expiry packs to high-burn trauma centers before wastage."
            )
        else:
            lines.append(
                "- Activate geo-targeted donor mobilization within 15 km of the highest-deficit zone and monitor "
                "72-hour prediction intervals in the Forecast Lab before escalating seasonal surge buffers."
            )

    return {
        "provider": "HemoPulse Clinical Reasoning Engine (Deterministic)",
        "live_llm": False,
        "briefing": "\n".join(lines),
        "telemetry_snapshot": telemetry_summary,
    }
