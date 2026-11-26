"""Domain models, ABO/Rh compatibility matrix, and realistic 10-facility network seed."""

from __future__ import annotations

import math
import random
from dataclasses import dataclass, field, asdict
from typing import Dict, List, Literal, Optional

BloodType = Literal["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"]
BLOOD_TYPES: List[BloodType] = ["O-", "O+", "A-", "A+", "B-", "B+", "AB-", "AB+"]

FacilityRole = Literal[
    "TRAUMA_CENTER",
    "MUNICIPAL_BLOOD_BANK",
    "ONCOLOGY_INSTITUTE",
    "TERTIARY_HOSPITAL",
    "REGIONAL_HUB",
]

SeasonRegime = Literal["NORMAL", "MONSOON_DENGUE", "WINTER_TRAUMA", "FESTIVAL_SURGE"]

# Clinical Red Blood Cell (RBC) compatibility: Recipient -> Compatible Donor Types (ordered by preference)
RBC_COMPATIBILITY: Dict[BloodType, List[BloodType]] = {
    "O-": ["O-"],
    "O+": ["O+", "O-"],
    "A-": ["A-", "O-"],
    "A+": ["A+", "A-", "O+", "O-"],
    "B-": ["B-", "O-"],
    "B+": ["B+", "B-", "O+", "O-"],
    "AB-": ["AB-", "A-", "B-", "O-"],
    "AB+": ["AB+", "AB-", "A+", "A-", "B+", "B-", "O+", "O-"],
}

SEASON_PROFILES: Dict[SeasonRegime, Dict[str, object]] = {
    "NORMAL": {
        "label": "Baseline Normal Operations",
        "global_multiplier": 1.0,
        "type_multipliers": {bt: 1.0 for bt in BLOOD_TYPES},
        "zone_multipliers": {
            "Central Metro": 1.0,
            "North Corridor": 1.0,
            "East Industrial": 1.0,
            "South Harbor": 1.0,
        },
        "description": "Standard elective surgery + trauma baseline across all 4 zones.",
    },
    "MONSOON_DENGUE": {
        "label": "Monsoon & Vector Outbreak",
        "global_multiplier": 1.28,
        "type_multipliers": {
            "O-": 1.20,
            "O+": 1.38,
            "A-": 1.15,
            "A+": 1.28,
            "B-": 1.25,
            "B+": 1.42,
            "AB-": 1.15,
            "AB+": 1.25,
        },
        "zone_multipliers": {
            "Central Metro": 1.25,
            "North Corridor": 1.15,
            "East Industrial": 1.35,
            "South Harbor": 1.45,
        },
        "description": "Elevated hemorrhagic fever & coastal flooding demand, especially O+ and B+.",
    },
    "WINTER_TRAUMA": {
        "label": "Winter Fog & Highway Trauma",
        "global_multiplier": 1.32,
        "type_multipliers": {
            "O-": 1.60,
            "O+": 1.42,
            "A-": 1.25,
            "A+": 1.22,
            "B-": 1.20,
            "B+": 1.22,
            "AB-": 1.15,
            "AB+": 1.15,
        },
        "zone_multipliers": {
            "Central Metro": 1.25,
            "North Corridor": 1.50,
            "East Industrial": 1.32,
            "South Harbor": 1.12,
        },
        "description": "Severe highway RTA surges requiring universal O- and O+ emergency packs.",
    },
    "FESTIVAL_SURGE": {
        "label": "Holiday & Festival Surge",
        "global_multiplier": 1.22,
        "type_multipliers": {
            "O-": 1.35,
            "O+": 1.30,
            "A-": 1.18,
            "A+": 1.24,
            "B-": 1.18,
            "B+": 1.25,
            "AB-": 1.12,
            "AB+": 1.18,
        },
        "zone_multipliers": {
            "Central Metro": 1.40,
            "North Corridor": 1.25,
            "East Industrial": 1.18,
            "South Harbor": 1.22,
        },
        "description": "Reduced donor turnout combined with elevated urban trauma & burn emergencies.",
    },
}


@dataclass
class BloodBatch:
    id: str
    blood_type: BloodType
    units: int
    hours_to_expiry: float
    origin_code: str


@dataclass
class InventorySlot:
    batches: List[BloodBatch]
    base_hourly_burn: float
    surge_multiplier: float = 1.0
    history_30d_daily: List[float] = field(default_factory=list)

    @property
    def total_units(self) -> int:
        return sum(b.units for b in self.batches if b.units > 0)


@dataclass
class Facility:
    id: str
    code: str
    name: str
    short_name: str
    role: FacilityRole
    zone: str
    lat: float
    lng: float
    capacity_units: int
    inventory: Dict[BloodType, InventorySlot]


@dataclass
class SurgeEvent:
    id: str
    facility_id: str
    blood_type: BloodType
    multiplier: float
    total_duration_hours: float
    remaining_hours: float
    label: str


@dataclass
class ColdChainTransfer:
    id: str
    from_facility_id: str
    from_code: str
    to_facility_id: str
    to_code: str
    source_blood_type: BloodType
    target_blood_type: BloodType
    is_compatibility_fallback: bool
    units: int
    distance_km: float
    total_transit_minutes: float
    remaining_minutes: float
    earliest_batch_expiry_hours: float
    status: Literal["IN_TRANSIT", "DELIVERED"]
    reason: str


@dataclass
class DonorRecord:
    id: str
    name: str
    blood_type: BloodType
    zone: str
    lat: float
    lng: float
    days_since_last_donation: int
    mobilized: bool = False


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    d_lat = math.radians(lat2 - lat1)
    d_lng = math.radians(lng2 - lng1)
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(math.radians(lat1))
        * math.cos(math.radians(lat2))
        * math.sin(d_lng / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(a))


def _generate_history_series(base_daily: float, seed: int) -> List[float]:
    rng = random.Random(seed)
    series: List[float] = []
    for day in range(30):
        # Weekly trauma rhythm (Fri/Sat higher) + slight upward trend + realistic noise
        weekday_factor = 1.18 if (day % 7) in (4, 5) else (0.90 if (day % 7) == 6 else 1.0)
        trend_factor = 1.0 + (day / 30.0) * 0.08
        noise = rng.uniform(0.86, 1.16)
        series.append(round(max(0.5, base_daily * weekday_factor * trend_factor * noise), 2))
    return series


def create_initial_network_state() -> dict:
    """Create a realistic 10-facility metropolitan + regional blood supply network."""
    facility_specs = [
        ("fac-metro-trauma", "MTC-01", "Metro Level-1 Trauma Center", "Metro Trauma", "TRAUMA_CENTER", "Central Metro", 12.9716, 77.5946, 420, 1.45, 0.42),
        ("fac-central-bank", "CBB-02", "Central Municipal Blood Bank", "Central Bank", "MUNICIPAL_BLOOD_BANK", "Central Metro", 12.9850, 77.5800, 950, 0.35, 1.85),
        ("fac-north-hub", "NRH-03", "North Corridor Regional Hub", "North Hub", "REGIONAL_HUB", "North Corridor", 13.0620, 77.5920, 820, 0.40, 1.65),
        ("fac-north-ortho", "NTH-04", "North Highway Trauma & Ortho", "North Trauma", "TRAUMA_CENTER", "North Corridor", 13.0810, 77.6280, 310, 1.15, 0.48),
        ("fac-east-onc", "EOI-05", "East Oncology & Hematology Inst.", "East Oncology", "ONCOLOGY_INSTITUTE", "East Industrial", 12.9780, 77.6980, 380, 0.95, 0.72),
        ("fac-east-bank", "EBB-06", "East Industrial Blood Depository", "East Bank", "MUNICIPAL_BLOOD_BANK", "East Industrial", 12.9520, 77.7150, 740, 0.32, 1.55),
        ("fac-south-harbor", "SHG-07", "South Harbor General Hospital", "South Harbor", "TERTIARY_HOSPITAL", "South Harbor", 12.8890, 77.6120, 360, 1.05, 0.55),
        ("fac-south-cardiac", "SCC-08", "South Cardiac & Maternity Care", "South Cardiac", "TERTIARY_HOSPITAL", "South Harbor", 12.8720, 77.5680, 340, 0.90, 0.65),
        ("fac-west-apex", "WAT-09", "West Apex Neuro & Trauma", "West Apex", "TRAUMA_CENTER", "Central Metro", 12.9550, 77.5180, 390, 1.22, 0.52),
        ("fac-apex-reserve", "ARC-10", "Regional Cryo & Reserve Depot", "Apex Reserve", "REGIONAL_HUB", "South Harbor", 12.9040, 77.6520, 900, 0.28, 1.75),
    ]

    type_shares: Dict[BloodType, float] = {
        "O+": 0.30,
        "B+": 0.26,
        "A+": 0.21,
        "AB+": 0.08,
        "O-": 0.06,
        "A-": 0.04,
        "B-": 0.03,
        "AB-": 0.02,
    }

    rng = random.Random(42)
    facilities: List[Facility] = []

    for idx, (fid, code, name, short_name, role, zone, lat, lng, cap, burn_scale, stock_scale) in enumerate(facility_specs):
        inventory: Dict[BloodType, InventorySlot] = {}
        for b_idx, bt in enumerate(BLOOD_TYPES):
            share = type_shares[bt]
            base_burn = round(max(0.18, burn_scale * share * 5.6), 2)

            # Create deliberate realistic stress points for immediate demo impact
            stress_factor = stock_scale
            if fid == "fac-metro-trauma" and bt in ("O-", "O+"):
                stress_factor = 0.26  # Imminent trauma shortage!
            elif fid == "fac-north-ortho" and bt in ("O-", "A+"):
                stress_factor = 0.34
            elif fid == "fac-south-harbor" and bt in ("B+", "O+"):
                stress_factor = 0.42
            elif fid == "fac-east-onc" and bt in ("A-", "AB-"):
                stress_factor = 0.48

            target_units = max(4, int(round(cap * share * 0.48 * stress_factor)))

            batches: List[BloodBatch] = []
            # Split into 2-4 FEFO batches, including near-expiry rescue candidates at low-burn depots
            remaining = target_units
            batch_idx = 1
            while remaining > 0:
                chunk = min(remaining, max(3, int(target_units * rng.uniform(0.28, 0.50))))
                if batch_idx == 1 and role in ("MUNICIPAL_BLOOD_BANK", "ONCOLOGY_INSTITUTE") and rng.random() < 0.65:
                    exp_hours = float(rng.randint(14, 34))  # Near-expiry FEFO candidate!
                elif fid == "fac-east-onc" and bt == "O+" and batch_idx == 1:
                    exp_hours = 18.0
                else:
                    exp_hours = float(rng.randint(48, 620))

                batches.append(
                    BloodBatch(
                        id=f"{code}-{bt.replace('+', 'P').replace('-', 'N')}-B{batch_idx:02d}",
                        blood_type=bt,
                        units=chunk,
                        hours_to_expiry=exp_hours,
                        origin_code=code,
                    )
                )
                remaining -= chunk
                batch_idx += 1

            batches.sort(key=lambda b: b.hours_to_expiry)
            history = _generate_history_series(base_burn * 24.0, seed=1000 + idx * 20 + b_idx)
            inventory[bt] = InventorySlot(
                batches=batches,
                base_hourly_burn=base_burn,
                surge_multiplier=1.0,
                history_30d_daily=history,
            )

        facilities.append(
            Facility(
                id=fid,
                code=code,
                name=name,
                short_name=short_name,
                role=role,
                zone=zone,
                lat=lat,
                lng=lng,
                capacity_units=cap,
                inventory=inventory,
            )
        )

    # Seed 1 active trauma surge at Metro Trauma
    surges: List[SurgeEvent] = [
        SurgeEvent(
            id="SURGE-001",
            facility_id="fac-metro-trauma",
            blood_type="O-",
            multiplier=1.75,
            total_duration_hours=12.0,
            remaining_hours=9.5,
            label="Multi-Vehicle Corridor Collision",
        )
    ]

    # Seed 1 in-transit cold chain transfer
    transfers: List[ColdChainTransfer] = [
        ColdChainTransfer(
            id="TX-901",
            from_facility_id="fac-central-bank",
            from_code="CBB-02",
            to_facility_id="fac-metro-trauma",
            to_code="MTC-01",
            source_blood_type="O+",
            target_blood_type="O+",
            is_compatibility_fallback=False,
            units=14,
            distance_km=2.18,
            total_transit_minutes=18.0,
            remaining_minutes=11.0,
            earliest_batch_expiry_hours=210.0,
            status="IN_TRANSIT",
            reason="Proactive AI Trauma Buffer",
        )
    ]

    # Seed 36 realistic regional blood donors
    donor_names = [
        "Aarav Sharma", "Priya Nair", "Rohan Kulkarni", "Ananya Iyer", "Vikram Menon",
        "Sneha Reddy", "Kabir Malhotra", "Meera Krishnan", "Arjun Verma", "Diya Sengupta",
        "Siddharth Rao", "Kavya Joshi", "Aditya Patel", "Nisha Gupta", "Rahul Deshmukh",
        "Ishita Roy", "Pranav Bhat", "Tanvi Hegde", "Karan Kapoor", "Shruti Bansal",
        "Devansh Tiwari", "Pooja Shetty", "Nikhil Pillai", "Riya Chatterjee", "Harsh Vardhan",
        "Aishwarya Menon", "Varun Gokhale", "Neha Kulkarni", "Surya Narayanan", "Divya Krishnan",
        "Gaurav Saxena", "Aditi Deshpande", "Manish Agarwal", "Swati Mishra", "Omkar Pawar",
        "Lavanya Srinivas",
    ]
    zones_coords = [
        ("Central Metro", 12.9716, 77.5946),
        ("North Corridor", 13.0700, 77.6100),
        ("East Industrial", 12.9650, 77.7050),
        ("South Harbor", 12.8850, 77.5950),
    ]
    donors: List[DonorRecord] = []
    for i, d_name in enumerate(donor_names):
        zone, z_lat, z_lng = zones_coords[i % 4]
        bt = BLOOD_TYPES[i % len(BLOOD_TYPES)]
        if i % 5 == 0:
            bt = "O-"
        elif i % 3 == 0:
            bt = "O+"
        donors.append(
            DonorRecord(
                id=f"DNR-{100 + i}",
                name=d_name,
                blood_type=bt,
                zone=zone,
                lat=round(z_lat + rng.uniform(-0.045, 0.045), 5),
                lng=round(z_lng + rng.uniform(-0.045, 0.045), 5),
                days_since_last_donation=rng.choice([18, 42, 61, 74, 92, 118, 145, 210]),
                mobilized=False,
            )
        )

    return {
        "sim_hour": 0.0,
        "season": "NORMAL",
        "facilities": [asdict(f) for f in facilities],
        "surges": [asdict(s) for s in surges],
        "transfers": [asdict(t) for t in transfers],
        "donors": [asdict(d) for d in donors],
        "audit_log": [
            {
                "id": "LOG-001",
                "sim_hour": 0.0,
                "category": "SYSTEM",
                "message": "HemoPulse AI Network synchronized 10 facilities across 4 zones.",
            },
            {
                "id": "LOG-002",
                "sim_hour": 0.0,
                "category": "ALERT",
                "message": "Predictive Alert: MTC-01 O- projected below 12h threshold due to corridor collision.",
            },
        ],
    }
