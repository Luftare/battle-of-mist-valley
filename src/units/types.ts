import { Scene, TransformNode } from "@babylonjs/core";
import type { Team } from "../theme/colors";

export interface UnitHandle {
  root: TransformNode;
  team: Team;
  kind: string;
  /**
   * Shots per second while in combat.
   * Rifleman defaults to 2; tank fires at 0.5 once aimed. Helicopter unused for now.
   */
  fireRateHz: number;
  /** Enter or leave combat animation (shooting pose / aim+fire). */
  setCombat: (active: boolean) => void;
  /** Enable locomotion animation (walk / drive roll) while root is translated externally. */
  setMoving: (active: boolean) => void;
  /** Play randomized destruction animation (no-op if already destroyed). */
  destroy: () => void;
  readonly destroyed: boolean;
  update: (dt: number, time: number) => void;
  dispose: () => void;
}

export type UnitFactory = (
  scene: Scene,
  name: string,
  team: Team,
) => UnitHandle;

/** Shortest signed delta from `from` to `to` in radians. */
export function shortestAngleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}
