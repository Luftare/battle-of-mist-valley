import { PLAY_DEPTH, PLAY_WIDTH, SLOT_COUNT } from "./stats";
import type { Team } from "../theme/colors";

/** World half-width / half-depth of each brown slot pad. */
export const PLATFORM_PAD_HALF_W = 1.45;
export const PLATFORM_PAD_HALF_D = 1.35;
export const PLATFORM_PAD_W = PLATFORM_PAD_HALF_W * 2;
export const PLATFORM_PAD_D = PLATFORM_PAD_HALF_D * 2;

export interface SlotPosition {
  x: number;
  z: number;
  team: Team;
  index: number;
}

export function buildingLineZ(halfZ = PLAY_DEPTH * 0.5): number {
  return halfZ - 2.4;
}

/** All 16 build-slot centers (8 per team, north & south rows). */
export function getBuildingSlotPositions(
  halfX = PLAY_WIDTH * 0.5,
  halfZ = PLAY_DEPTH * 0.5,
): SlotPosition[] {
  const zLine = buildingLineZ(halfZ);
  const xMin = -halfX + 2.2;
  const xMax = halfX - 2.2;
  const slots: SlotPosition[] = [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const t = i / Math.max(1, SLOT_COUNT - 1);
    const x = xMin + (xMax - xMin) * t;
    slots.push({ x, z: -zLine, team: "blue", index: i });
    slots.push({ x, z: zLine, team: "red", index: i });
  }
  return slots;
}

/** Keep trees / rocks / grass off the building rows. */
export function inBuildingBand(
  x: number,
  z: number,
  halfX = PLAY_WIDTH * 0.5,
  halfZ = PLAY_DEPTH * 0.5,
): boolean {
  const zLine = buildingLineZ(halfZ);
  const xMin = -halfX + 2.2;
  const xMax = halfX - 2.2;
  const zBand = 7.2;
  return (
    Math.abs(z) > zLine - zBand &&
    Math.abs(z) < halfZ - 0.6 &&
    x >= xMin - 1.5 &&
    x <= xMax + 1.5
  );
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
