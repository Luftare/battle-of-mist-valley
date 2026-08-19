/**
 * Research Lab tech tree — team-wide upgrades unlocked over time.
 * Durations sit between 5–20s; Logistics Surge, Rapid Deployment, and
 * Rotary Feed stack (×5). Effects are intentionally strong and expensive
 * mid/late-game investments.
 */

import type { ThumbId } from "../thumbs/types";

export type UpgradeId =
  | "supplySpeed"
  | "infantryAccuracy"
  | "tankHp"
  | "heliMissiles"
  | "heliRange"
  | "heliGunFireRate"
  | "infantryProd"
  | "tankSplash"
  | "tankFireRate"
  | "turretRange"
  | "turretRegen";

/** Unit icon for the research card (never the producing building). */
export const UPGRADE_SUBJECT: Record<UpgradeId, ThumbId> = {
  supplySpeed: "supplyTruck",
  infantryAccuracy: "rifleman",
  tankHp: "tank",
  heliMissiles: "helicopter",
  heliRange: "helicopter",
  heliGunFireRate: "helicopter",
  infantryProd: "rifleman",
  tankSplash: "tank",
  tankFireRate: "tank",
  turretRange: "turret",
  turretRegen: "turret",
};

export interface UpgradeDef {
  id: UpgradeId;
  label: string;
  blurb: string;
  /** Coin cost to start research. */
  cost: number;
  /** Research time in seconds. */
  durationSec: number;
  /** Max times this upgrade can be completed (1 = unique). */
  maxLevel: number;
  /** Cost added per already-owned level (stackable only). */
  costPerLevel?: number;
}

/** +% coin mint rate per Logistics Surge level (stacks additively). */
export const SUPPLY_SPEED_BONUS_PER_LEVEL = 0.25;
/** Marksman Drills multiplies infantry hit chance. */
export const INFANTRY_ACCURACY_MUL = 1.35;
/** Reinforced Armor multiplies tank max/current HP. */
export const TANK_HP_MUL = 1.5;
/**
 * Rapid Deployment: +0.4× spawn rate per level (÷ interval).
 * Level 5 → 3× original barracks production.
 */
export const INFANTRY_PROD_BONUS_PER_LEVEL = 0.4;
/** Heavy Shells multiplies tank splash radius. */
export const TANK_SPLASH_MUL = 2;
/** Autoloaders doubles tank fire rate. */
export const TANK_FIRE_RATE_MUL = 2;
/** Extended Optics multiplies turret engagement range. */
export const TURRET_RANGE_MUL = 1.5;
/**
 * Rotary Feed: +15% heli chin-gun fire rate per level (stacks additively).
 * Level 5 → 1.75× original gun cadence.
 */
export const HELI_GUN_FIRE_RATE_BONUS_PER_LEVEL = 0.15;
/** Sky Radar: +10% heli weapon range per level (stacks additively). */
export const HELI_RANGE_BONUS_PER_LEVEL = 0.1;

/** Barracks spawn-rate multiplier from Rapid Deployment stacks (1 at level 0). */
export function infantryProdMul(level: number): number {
  if (level <= 0) return 1;
  return 1 + INFANTRY_PROD_BONUS_PER_LEVEL * level;
}

/** Heli chin-gun fire-rate multiplier from Rotary Feed stacks (1 at level 0). */
export function heliGunFireRateMul(level: number): number {
  if (level <= 0) return 1;
  return 1 + HELI_GUN_FIRE_RATE_BONUS_PER_LEVEL * level;
}

/** Heli weapon-range multiplier from Sky Radar stacks (1 at level 0). */
export function heliRangeMul(level: number): number {
  if (level <= 0) return 1;
  return 1 + HELI_RANGE_BONUS_PER_LEVEL * level;
}

export const UPGRADE_DEFS: Record<UpgradeId, UpgradeDef> = {
  supplySpeed: {
    id: "supplySpeed",
    label: "Logistics Surge",
    blurb: "+25% coin rate from trucks.",
    cost: 80,
    durationSec: 20,
    maxLevel: 5,
    costPerLevel: 30,
  },
  infantryAccuracy: {
    id: "infantryAccuracy",
    label: "Marksman Drills",
    blurb: "Infantry +35% accuracy.",
    cost: 120,
    durationSec: 22,
    maxLevel: 1,
  },
  tankHp: {
    id: "tankHp",
    label: "Reinforced Armor",
    blurb: "Tanks +50% max HP.",
    cost: 200,
    durationSec: 24,
    maxLevel: 1,
  },
  heliMissiles: {
    id: "heliMissiles",
    label: "Hellfire Protocol",
    blurb: "Helis fire missiles vs vehicles.",
    cost: 200,
    durationSec: 30,
    maxLevel: 1,
  },
  heliRange: {
    id: "heliRange",
    label: "Sky Radar",
    blurb: "+10% heli weapon range.",
    cost: 250,
    durationSec: 20,
    maxLevel: 5,
    costPerLevel: 80,
  },
  heliGunFireRate: {
    id: "heliGunFireRate",
    label: "Rotary Feed",
    blurb: "+15% heli gun fire rate.",
    cost: 110,
    durationSec: 16,
    maxLevel: 5,
    costPerLevel: 45,
  },
  infantryProd: {
    id: "infantryProd",
    label: "Rapid Deployment",
    blurb: "+40% barracks spawn rate.",
    cost: 200,
    durationSec: 30,
    maxLevel: 5,
    costPerLevel: 70,
  },
  tankSplash: {
    id: "tankSplash",
    label: "Heavy Shells",
    blurb: "Tank splash ×2.",
    cost: 190,
    durationSec: 25,
    maxLevel: 1,
  },
  tankFireRate: {
    id: "tankFireRate",
    label: "Autoloaders",
    blurb: "Tanks fire 2× faster.",
    cost: 300,
    durationSec: 20,
    maxLevel: 1,
  },
  turretRange: {
    id: "turretRange",
    label: "Extended Optics",
    blurb: "Turrets +50% range.",
    cost: 120,
    durationSec: 30,
    maxLevel: 1,
  },
  turretRegen: {
    id: "turretRegen",
    label: "Auto-Repair Nanites",
    blurb: "Turrets regen HP out of combat.",
    cost: 100,
    durationSec: 12,
    maxLevel: 1,
  },
};

/** Display / research-board order — grouped by unit type affected. */
export const UPGRADE_IDS: UpgradeId[] = [
  // Supply truck
  "supplySpeed",
  // Rifleman
  "infantryAccuracy",
  "infantryProd",
  // Tank
  "tankHp",
  "tankSplash",
  "tankFireRate",
  // Helicopter
  "heliMissiles",
  "heliRange",
  "heliGunFireRate",
  // Turret
  "turretRange",
  "turretRegen",
];

/** HP restored per second while no enemy targets the turret. */
export const TURRET_REGEN_HP_PER_SEC = 20;
/** Seconds after last damage before regen starts. */
export const TURRET_REGEN_DELAY_SEC = 2.5;

export function upgradeCost(def: UpgradeDef, currentLevel: number): number {
  return def.cost + (def.costPerLevel ?? 0) * currentLevel;
}

export function createTeamTechLevels(): Record<UpgradeId, number> {
  return {
    supplySpeed: 0,
    infantryAccuracy: 0,
    tankHp: 0,
    heliMissiles: 0,
    heliRange: 0,
    heliGunFireRate: 0,
    infantryProd: 0,
    tankSplash: 0,
    tankFireRate: 0,
    turretRange: 0,
    turretRegen: 0,
  };
}
