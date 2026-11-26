import { BloodType, SeasonRegime } from '../types/network';

export const RBC_COMPATIBILITY: Record<BloodType, BloodType[]> = {
  'O-': ['O-'],
  'O+': ['O+', 'O-'],
  'A-': ['A-', 'O-'],
  'A+': ['A+', 'A-', 'O+', 'O-'],
  'B-': ['B-', 'O-'],
  'B+': ['B+', 'B-', 'O+', 'O-'],
  'AB-': ['AB-', 'A-', 'B-', 'O-'],
  'AB+': ['AB+', 'AB-', 'A+', 'A-', 'B+', 'B-', 'O+', 'O-'],
};

export interface SeasonProfile {
  label: string;
  global_multiplier: number;
  type_multipliers: Record<BloodType, number>;
  zone_multipliers: Record<string, number>;
  description: string;
}

export const SEASON_PROFILES: Record<SeasonRegime, SeasonProfile> = {
  NORMAL: {
    label: 'Baseline Normal Ops',
    global_multiplier: 1.0,
    type_multipliers: {
      'O-': 1, 'O+': 1, 'A-': 1, 'A+': 1, 'B-': 1, 'B+': 1, 'AB-': 1, 'AB+': 1,
    },
    zone_multipliers: {
      'Central Metro': 1.0,
      'North Corridor': 1.0,
      'East Industrial': 1.0,
      'South Harbor': 1.0,
    },
    description: 'Standard elective surgery + trauma baseline across all 4 zones.',
  },
  MONSOON_DENGUE: {
    label: 'Monsoon & Dengue Outbreak',
    global_multiplier: 1.28,
    type_multipliers: {
      'O-': 1.2, 'O+': 1.38, 'A-': 1.15, 'A+': 1.28, 'B-': 1.25, 'B+': 1.42, 'AB-': 1.15, 'AB+': 1.25,
    },
    zone_multipliers: {
      'Central Metro': 1.25,
      'North Corridor': 1.15,
      'East Industrial': 1.35,
      'South Harbor': 1.45,
    },
    description: 'Elevated hemorrhagic fever & coastal flooding demand, especially O+ and B+.',
  },
  WINTER_TRAUMA: {
    label: 'Winter Fog & Highway Trauma',
    global_multiplier: 1.32,
    type_multipliers: {
      'O-': 1.6, 'O+': 1.42, 'A-': 1.25, 'A+': 1.22, 'B-': 1.2, 'B+': 1.22, 'AB-': 1.15, 'AB+': 1.15,
    },
    zone_multipliers: {
      'Central Metro': 1.25,
      'North Corridor': 1.5,
      'East Industrial': 1.32,
      'South Harbor': 1.12,
    },
    description: 'Severe highway RTA surges requiring universal O- and O+ emergency packs.',
  },
  FESTIVAL_SURGE: {
    label: 'Holiday & Festival Surge',
    global_multiplier: 1.22,
    type_multipliers: {
      'O-': 1.35, 'O+': 1.3, 'A-': 1.18, 'A+': 1.24, 'B-': 1.18, 'B+': 1.25, 'AB-': 1.12, 'AB+': 1.18,
    },
    zone_multipliers: {
      'Central Metro': 1.4,
      'North Corridor': 1.25,
      'East Industrial': 1.18,
      'South Harbor': 1.22,
    },
    description: 'Reduced donor turnout combined with elevated urban trauma & burn emergencies.',
  },
};

export const ROLE_LABELS: Record<string, string> = {
  TRAUMA_CENTER: 'Level-1 Trauma Center',
  MUNICIPAL_BLOOD_BANK: 'Municipal Blood Bank',
  ONCOLOGY_INSTITUTE: 'Oncology & Hematology',
  TERTIARY_HOSPITAL: 'Tertiary Hospital',
  REGIONAL_HUB: 'Regional Cold-Chain Hub',
};

export const DONOR_COOLDOWN_DAYS = 56;
export const DEFAULT_DONOR_RADIUS_KM = 15;
