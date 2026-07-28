import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { Team } from "../theme/colors";
import type { CombatEntity } from "../game/combatEntity";

export interface UnitHandle extends CombatEntity {
  root: TransformNode;
  team: Team;
  kind: string;
  /**
   * Shots per second while in combat.
   * Rifleman 2; tank 0.25 once aimed; helicopter 0.2 (missile every 5s).
   */
  fireRateHz: number;
  hp: number;
  maxHp: number;
  shootRange: number;
  moveSpeed: number;
  damage: number;
  /** Scale max and current HP (research upgrades). */
  applyMaxHpBonus: (factor: number) => void;
  /**
   * Helicopter: unlock guided missiles vs vehicles.
   * No-op on other unit kinds.
   */
  setMissilesEnabled: (enabled: boolean) => void;
  /** Enter or leave combat animation (shooting pose / aim+fire). */
  setCombat: (active: boolean) => void;
  /**
   * Guided / turret aim target. Buildings and units both work.
   */
  setAimTarget: (target: CombatEntity | null) => void;
  /** Called whenever this unit fires a hitscan shot (rifleman / tank / heli gun). */
  setOnFire: (cb: (() => void) | null) => void;
  /**
   * Helicopter missiles: called when a missile reaches its aim target.
   * Receives the launch-time target (so wrecked helis still deal damage) and hit position.
   * Hitscan units ignore this.
   */
  setOnMissileHit: (cb: ((target: CombatEntity, hitPos: Vector3) => void) | null) => void;
  /** Enable locomotion animation (walk / drive roll) while root is translated externally. */
  setMoving: (active: boolean) => void;
  /** Play randomized destruction animation (no-op if already destroyed). */
  destroy: () => void;
  readonly destroyed: boolean;
  /** True once the corpse has sunk and can be disposed. */
  readonly expired: boolean;
  takeDamage: (amount: number) => void;
  /** World-space tip of the firing barrel (hitscan muzzle). */
  getMuzzlePoint: (out?: Vector3) => Vector3;
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
