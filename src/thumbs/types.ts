import type { BuildingKind } from "../buildings/types";
import type { UnitKind } from "../game/stats";
import { THUMB_IDS as REGISTRY_IDS } from "./registry";

/**
 * Subjects used as HUD icons. Prefer adding new models via `registry.ts`;
 * keep this union in sync when a menu needs a typed id.
 */
export type ThumbId = UnitKind | BuildingKind | "turret";

export type ThumbMap = Partial<Record<ThumbId, string>>;

/** All registered bake subjects (string ids from the registry). */
export const THUMB_IDS: string[] = REGISTRY_IDS;
