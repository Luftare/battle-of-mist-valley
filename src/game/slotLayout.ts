import {
  PLAY_DEPTH,
  PLAY_WIDTH,
  SLOT_COUNT,
  TURRETS_PER_TEAM,
  TURRET_FORWARD_FROM_BASE,
} from "./stats";
import type { Team } from "../theme/colors";

/** World half-width / half-depth of each brown slot pad. */
export const PLATFORM_PAD_HALF_W = 1.45;
export const PLATFORM_PAD_HALF_D = 1.35;
export const PLATFORM_PAD_W = PLATFORM_PAD_HALF_W * 2;
export const PLATFORM_PAD_D = PLATFORM_PAD_HALF_D * 2;

/** Keep trees/rocks at least this far from each map turret. */
export const TURRET_PROP_CLEARANCE = 5.2;

export interface SlotPosition {
  x: number;
  z: number;
  team: Team;
  index: number;
}

export function buildingLineZ(halfZ = PLAY_DEPTH * 0.5): number {
  return halfZ - 2.4;
}

function buildingXSpan(halfX = PLAY_WIDTH * 0.5): { xMin: number; xMax: number } {
  return { xMin: -halfX + 2.2, xMax: halfX - 2.2 };
}

/** All 16 build-slot centers (8 per team, north & south rows). */
export function getBuildingSlotPositions(
  halfX = PLAY_WIDTH * 0.5,
  halfZ = PLAY_DEPTH * 0.5,
): SlotPosition[] {
  const zLine = buildingLineZ(halfZ);
  const { xMin, xMax } = buildingXSpan(halfX);
  const slots: SlotPosition[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const t = i / Math.max(1, SLOT_COUNT - 1);
    const x = xMin + (xMax - xMin) * t;
    slots.push({ x, z: -zLine, team: "blue", index: i });
    slots.push({ x, z: zLine, team: "red", index: i });
  }
  return slots;
}

/** Fixed defensive turret centers (space-around along each base line). */
export function getTurretPositions(
  halfX = PLAY_WIDTH * 0.5,
  halfZ = PLAY_DEPTH * 0.5,
): { x: number; z: number }[] {
  const zLine = buildingLineZ(halfZ);
  const { xMin, xMax } = buildingXSpan(halfX);
  const positions: { x: number; z: number }[] = [];
  for (const zSign of [-1, 1] as const) {
    const tz = zSign * (zLine - TURRET_FORWARD_FROM_BASE);
    for (let i = 0; i < TURRETS_PER_TEAM; i++) {
      const t = (i + 0.5) / TURRETS_PER_TEAM;
      positions.push({ x: xMin + (xMax - xMin) * t, z: tz });
    }
  }
  return positions;
}

/** Keep trees / rocks / grass off the building rows. */
export function inBuildingBand(
  x: number,
  z: number,
  halfX = PLAY_WIDTH * 0.5,
  halfZ = PLAY_DEPTH * 0.5,
): boolean {
  const zLine = buildingLineZ(halfZ);
  const { xMin, xMax } = buildingXSpan(halfX);
  const zBand = 7.2;
  return (
    Math.abs(z) > zLine - zBand &&
    Math.abs(z) < halfZ - 0.6 &&
    x >= xMin - 1.5 &&
    x <= xMax + 1.5
  );
}

/** True when a prop would sit too close to a map turret. */
export function nearTurret(
  x: number,
  z: number,
  halfX = PLAY_WIDTH * 0.5,
  halfZ = PLAY_DEPTH * 0.5,
  clearance = TURRET_PROP_CLEARANCE,
): boolean {
  for (const t of getTurretPositions(halfX, halfZ)) {
    if (Math.hypot(t.x - x, t.z - z) < clearance) return true;
  }
  return false;
}

/** True when a world XZ point lies on a slot pad footprint. */
export function inSlotFootprint(
  x: number,
  z: number,
  halfX = PLAY_WIDTH * 0.5,
  halfZ = PLAY_DEPTH * 0.5,
): boolean {
  for (const slot of getBuildingSlotPositions(halfX, halfZ)) {
    if (
      Math.abs(x - slot.x) <= PLATFORM_PAD_HALF_W &&
      Math.abs(z - slot.z) <= PLATFORM_PAD_HALF_D
    ) {
      return true;
    }
  }
  return false;
}
