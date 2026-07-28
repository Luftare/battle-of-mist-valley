/**
 * Research Lab tech tree — team-wide upgrades unlocked over time.
 * Durations sit between 5–20s; only supply logistics stacks (×5).
 * Effects are intentionally strong and expensive mid/late-game investments.
 */

export type UpgradeId =
  | "supplySpeed"
  | "infantryAccuracy"
  | "tankHp"
  | "heliMissiles"
  | "infantryProd"
  | "tankSplash"
  | "tankFireRate"
  | "turretRange"
  | "turretRegen";

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
/** Rapid Deployment divides barracks spawn interval. */
export const INFANTRY_PROD_MUL = 1.4;
/** Heavy Shells multiplies tank splash radius. */
export const TANK_SPLASH_MUL = 3;
/** Autoloaders doubles tank fire rate. */
export const TANK_FIRE_RATE_MUL = 2;
/** Extended Optics multiplies turret engagement range. */
export const TURRET_RANGE_MUL = 1.5;

export const UPGRADE_DEFS: Record<UpgradeId, UpgradeDef> = {
  supplySpeed: {
    id: "supplySpeed",
    label: "Logistics Surge",
    blurb: "Supply trucks mint coins +25% faster. Stacks up to 5×.",
    cost: 80,
    durationSec: 10,
    maxLevel: 5,
    costPerLevel: 30,
  },
  infantryAccuracy: {
    id: "infantryAccuracy",
    label: "Marksman Drills",
    blurb: "Infantry shoot +35% more accurately.",
    cost: 120,
    durationSec: 12,
    maxLevel: 1,
  },
  tankHp: {
    id: "tankHp",
    label: "Reinforced Armor",
    blurb: "Tanks gain +50% max HP.",
    cost: 160,
    durationSec: 14,
    maxLevel: 1,
  },
  heliMissiles: {
    id: "heliMissiles",
    label: "Hellfire Protocol",
    blurb: "Helicopters unlock missiles vs all vehicles.",
    cost: 200,
    durationSec: 18,
    maxLevel: 1,
  },
  infantryProd: {
    id: "infantryProd",
    label: "Rapid Deployment",
    blurb: "Barracks produce infantry +40% faster.",
    cost: 200,
    durationSec: 11,
    maxLevel: 1,
  },
  tankSplash: {
    id: "tankSplash",
    label: "Heavy Shells",
    blurb: "Tank splash radius is 3× larger.",
    cost: 170,
    durationSec: 15,
    maxLevel: 1,
  },
  tankFireRate: {
    id: "tankFireRate",
    label: "Autoloaders",
    blurb: "Tanks fire 2× faster.",
    cost: 155,
    durationSec: 14,
    maxLevel: 1,
  },
  turretRange: {
    id: "turretRange",
    label: "Extended Optics",
    blurb: "Turrets gain +50% engagement range.",
    cost: 140,
    durationSec: 13,
    maxLevel: 1,
  },
  turretRegen: {
    id: "turretRegen",
    label: "Auto-Repair Nanites",
    blurb: "Turrets rapidly recover HP when no enemy is targeting them.",
    cost: 100,
    durationSec: 12,
    maxLevel: 1,
  },
};

export const UPGRADE_IDS: UpgradeId[] = [
  "supplySpeed",
  "infantryAccuracy",
  "tankHp",
  "heliMissiles",
  "infantryProd",
  "tankSplash",
  "tankFireRate",
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
    infantryProd: 0,
    tankSplash: 0,
    tankFireRate: 0,
    turretRange: 0,
    turretRegen: 0,
  };
}
