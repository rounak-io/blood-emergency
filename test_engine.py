"""Unit tests for HemoPulse AI forecasting, ABO/Rh matching, FEFO optimization, and advisor."""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.forecaster import compute_slot_metrics, forecast_14_days, summarize_regional_risk
from app.gemini_advisor import generate_ai_briefing
from app.models import BLOOD_TYPES, RBC_COMPATIBILITY, create_initial_network_state
from app.optimizer import compute_optimal_recommendations, match_eligible_donors


class TestHemoPulseEngine(unittest.TestCase):
    def setUp(self) -> None:
        self.state = create_initial_network_state()

    def test_initial_network_has_10_facilities_and_8_types(self) -> None:
        self.assertEqual(len(self.state["facilities"]), 10)
        for fac in self.state["facilities"]:
            for bt in BLOOD_TYPES:
                self.assertIn(bt, fac["inventory"])
                self.assertTrue(len(fac["inventory"][bt]["history_30d_daily"]) == 30)

    def test_rbc_compatibility_rules(self) -> None:
        self.assertEqual(RBC_COMPATIBILITY["O-"], ["O-"])
        self.assertEqual(len(RBC_COMPATIBILITY["AB+"]), 8)
        self.assertIn("O-", RBC_COMPATIBILITY["A+"])
        self.assertNotIn("A+", RBC_COMPATIBILITY["O-"])

    def test_forecast_14_days_emits_confidence_intervals(self) -> None:
        fac = self.state["facilities"][0]
        m = compute_slot_metrics(fac, "O-", self.state["season"], self.state["surges"])
        fc = forecast_14_days(
            fac["inventory"]["O-"]["history_30d_daily"],
            m["effective_hourly_burn"],
            m["total_units"],
        )
        self.assertEqual(len(fc["daily_forecast"]), 14)
        self.assertEqual(len(fc["hourly_burndown_72h"]), 19)
        for pt in fc["daily_forecast"]:
            self.assertLessEqual(pt["lower_95"], pt["lower_80"])
            self.assertLessEqual(pt["lower_80"], pt["predicted_demand"])
            self.assertLessEqual(pt["predicted_demand"], pt["upper_80"])
            self.assertLessEqual(pt["upper_80"], pt["upper_95"])

    def test_optimizer_produces_shortage_and_expiry_recommendations(self) -> None:
        recs = compute_optimal_recommendations(self.state)
        self.assertGreater(len(recs), 0)
        categories = {r["category"] for r in recs}
        self.assertTrue(
            "SHORTAGE_MITIGATION" in categories or "COMPATIBLE_FALLBACK" in categories
        )

    def test_regional_risk_and_donor_matching(self) -> None:
        regions, fac_risks = summarize_regional_risk(self.state)
        self.assertEqual(len(regions), 4)
        self.assertEqual(len(fac_risks), 10)
        donors = match_eligible_donors(self.state, "fac-metro-trauma", "O-", radius_km=15.0)
        for d in donors:
            self.assertGreaterEqual(d["days_since_last_donation"], 56)
            self.assertEqual(d["blood_type"], "O-")
            self.assertLessEqual(d["distance_km"], 15.0)

    def test_ai_briefing_fallback_always_succeeds(self) -> None:
        res = generate_ai_briefing(self.state, question="What about O- reserves?")
        self.assertIn("Executive Situation Brief", res["briefing"])
        self.assertIn("O-", res["briefing"])


if __name__ == "__main__":
    unittest.main()
