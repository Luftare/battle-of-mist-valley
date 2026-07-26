import type { TransformNode, Vector3 } from "@babylonjs/core";
import type { Team } from "../theme/colors";

/** Anything that can be aimed at and damaged (units or buildings). */
export interface CombatEntity {
  root: TransformNode;
  team: Team;
  readonly destroyed: boolean;
  takeDamage: (amount: number) => void;
  /** World-space body center used for aiming / missile dive / hit FX. */
  getHitPoint: (out?: Vector3) => Vector3;
  /** Knock the entity away from an impact origin (XZ). */
  applyImpact: (fromX: number, fromZ: number, strength: number) => void;
}
