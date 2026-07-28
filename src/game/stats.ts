import type { BuildingKind } from "../buildings/types";

export type UnitKind = "rifleman" | "tank" | "helicopter" | "supplyTruck";

export interface UnitStats {
  maxHp: number;
  damage: number;
  shootRange: number;
  moveSpeed: number;
  fireRateHz: number;
  radius: number;
  hpBarHeight: number;
}

export const UNIT_STATS: Record<UnitKind, UnitStats> = {
  rifleman: {
    maxHp: 100,
    damage: 8,
    shootRange: 6.75,
    moveSpeed: 1.15,
    fireRateHz: 2,
    radius: 0.35,
    hpBarHeight: 1.55,
  },
  tank: {
    maxHp: 200,
    damage: 35,
    shootRange: 7.5,
    moveSpeed: 0.95,
    fireRateHz: 0.5,
    radius: 0.75,
    hpBarHeight: 1.35,
  },
  helicopter: {
    maxHp: 45,
    damage: 55,
    shootRange: 11,
    moveSpeed: 1.35,
    fireRateHz: 0.2,
    radius: 0.55,
    hpBarHeight: 3.4,
  },
  /** Soft logistics target — same durability as heli, no weapon. */
  supplyTruck: {
    maxHp: 45,
    damage: 0,
    shootRange: 0,
    moveSpeed: 1.05,
    fireRateHz: 0,
    radius: 0.55,
    hpBarHeight: 1.45,
  },
};

/** Chin-gun damage / rate when heli engages soft targets. */
export const HELI_GUN_DAMAGE = 11;
export const HELI_GUN_FIRE_HZ = 5.5;
/** Chin-gun reach: 80% of rifleman range. */
export const HELI_GUN_RANGE = UNIT_STATS.rifleman.shootRange * 0.8;

/** Splash radii for areal weapons (tank shell / heli missile). */
export const TANK_SPLASH_RADIUS = 2.2;
export const MISSILE_SPLASH_RADIUS = 2.8;

/**
 * Hitscan / shell hit chance vs range.
 * 100% at point-blank, 50% at the weapon's max engage range (linear in between).
 * Missiles ignore this and always hit.
 */
export const ACCURACY_AT_POINT_BLANK = 1;
export const ACCURACY_AT_MAX_RANGE = 0.5;
/** How far a miss lands from the aim point (world units). */
export const MISS_SCATTER_RADIUS = 1.85;

/** Fixed map turrets: tank range, rifle cadence, 1.25× rifle damage, 2× tank HP. */
export const TURRET_SHOOT_RANGE = UNIT_STATS.tank.shootRange;
export const TURRET_FIRE_HZ = UNIT_STATS.rifleman.fireRateHz;
export const TURRET_DAMAGE = UNIT_STATS.rifleman.damage * 1.25;
export const TURRET_MAX_HP = UNIT_STATS.tank.maxHp * 2;
export const TURRET_BOUNTY = 25;
export const TURRET_HP_BAR_HEIGHT = 1.85;

export const BUILDING_MAX_HP = 320;
export const BUILDING_RADIUS = 1.15;
/** World-space HP bar height above the building root. */
export const BUILDING_HP_BAR_HEIGHT = 2.15;
export const SPAWN_INTERVAL_SEC = 15;
/** Barracks produce infantry twice as fast as other buildings. */
export const BARRACKS_SPAWN_INTERVAL_SEC = SPAWN_INTERVAL_SEC / 2;
export const CORPSE_LIFETIME_SEC = 15;
/** East–west playfield width (building rows span this). */
export const PLAY_WIDTH = 36;
/** North–south playfield depth — 2× original width stretch on the long axis. */
export const PLAY_DEPTH = 56;
/** @deprecated Prefer PLAY_WIDTH — kept as width alias. */
export const PLAY_SIZE = PLAY_WIDTH;
export const SLOT_COUNT = 10;
/** Turrets per team, spaced across the building line. */
export const TURRETS_PER_TEAM = 3;
/** How far in front of the building row turrets sit (toward midfield). */
export const TURRET_FORWARD_FROM_BASE = 6.8;

/** Central hill footprint (height stays fixed in the heightmap). */
export const HILL_RADIUS = 13;
export const HILL_HEIGHT = 3.4;
/** Capture zone is half the hill radius. */
export const FLAG_CAPTURE_RADIUS = HILL_RADIUS * 0.5;
/** Coins/sec awarded to the team that solely holds the flag zone. */
export const FLAG_COINS_PER_SEC = 2;

/** Passive income for each team. */
export const COINS_PER_SEC = 2;
export const STARTING_COINS = 80;

/** Supply trucks mint coins while alive. */
export const SUPPLY_TRUCK_COIN_INTERVAL_SEC = 1;
export const SUPPLY_TRUCK_COIN_AMOUNT = 1;

/** Owner-initiated teardown duration (seconds). */
export const COLLAPSE_DURATION_SEC = 4.5;

/** Enemy AI thinks on this cadence. */
export const AI_DECISION_INTERVAL_SEC = 10;

/**
 * Build costs — barracks cheapest, helipad most expensive.
 * Depot sits between barracks and factory as an economy play.
 */
export const BUILDING_COST: Record<BuildingKind, number> = {
  barracks: 50,
  depot: 75,
  factory: 120,
  helipad: 180,
};

export const BUILDING_LABEL: Record<BuildingKind, string> = {
  barracks: "Barracks",
  depot: "Supply Depot",
  factory: "Factory",
  helipad: "Helipad",
};

export const UNIT_LABEL: Record<UnitKind, string> = {
  rifleman: "Rifleman",
  tank: "Tank",
  helicopter: "Helicopter",
  supplyTruck: "Supply Truck",
};

export const BUILDING_BLURB: Record<BuildingKind, string> = {
  barracks: "Fast infantry. Strong vs helicopters.",
  depot: "Spawns supply trucks that mint coins.",
  factory: "Heavy armor. Strong vs infantry.",
  helipad: "Air support. Strong vs tanks.",
};

export const BUILDING_TO_UNIT: Record<BuildingKind, UnitKind> = {
  barracks: "rifleman",
  depot: "supplyTruck",
  factory: "tank",
  helipad: "helicopter",
};

export const UNIT_TO_BUILDING: Record<UnitKind, BuildingKind> = {
  rifleman: "barracks",
  supplyTruck: "depot",
  tank: "factory",
  helicopter: "helipad",
};

export const UNIT_KINDS: UnitKind[] = [
  "rifleman",
  "tank",
  "helicopter",
  "supplyTruck",
];

export const BUILDING_KINDS: BuildingKind[] = [
  "barracks",
  "depot",
  "factory",
  "helipad",
];
