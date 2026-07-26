import type { BuildingKind } from "../buildings/types";

export type UnitKind = "rifleman" | "tank" | "helicopter";

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
};

/** Chin-gun damage / rate when heli engages soft targets. */
export const HELI_GUN_DAMAGE = 11;
export const HELI_GUN_FIRE_HZ = 5.5;
/** Chin-gun reach: 80% of rifleman range. */
export const HELI_GUN_RANGE = UNIT_STATS.rifleman.shootRange * 0.8;

/** Splash radii for areal weapons (tank shell / heli missile). */
export const TANK_SPLASH_RADIUS = 2.2;
export const MISSILE_SPLASH_RADIUS = 2.8;

export const BUILDING_MAX_HP = 320;
export const BUILDING_RADIUS = 1.15;
export const SPAWN_INTERVAL_SEC = 15;
/** Barracks produce infantry twice as fast as other buildings. */
export const BARRACKS_SPAWN_INTERVAL_SEC = SPAWN_INTERVAL_SEC / 2;
export const CORPSE_LIFETIME_SEC = 15;
export const PLAY_SIZE = 28;
export const SLOT_COUNT = 8;

export const BUILDING_TO_UNIT: Record<BuildingKind, UnitKind> = {
  barracks: "rifleman",
  factory: "tank",
  helipad: "helicopter",
};

export const UNIT_TO_BUILDING: Record<UnitKind, BuildingKind> = {
  rifleman: "barracks",
  tank: "factory",
  helicopter: "helipad",
};

export const UNIT_KINDS: UnitKind[] = ["rifleman", "tank", "helicopter"];
