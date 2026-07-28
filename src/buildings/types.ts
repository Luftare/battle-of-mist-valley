import type { TransformNode } from "@babylonjs/core";
import type { Team } from "../theme/colors";
import type { CombatEntity } from "../game/combatEntity";
import type { UnitKind } from "../game/stats";

export type BuildingKind =
  | "barracks"
  | "factory"
  | "helipad"
  | "depot"
  | "researchLab";

export interface BuildingHandle extends CombatEntity {
  root: TransformNode;
  team: Team;
  kind: BuildingKind;
  /** Unit type this building produces, or null for non-production buildings. */
  spawns: UnitKind | null;
  hp: number;
  maxHp: number;
  takeDamage: (amount: number) => void;
  /** Owner-initiated teardown (no refund). */
  beginCollapse: () => void;
  readonly collapsing: boolean;
  /** True while the structure is still being erected (not yet operational). */
  readonly constructing: boolean;
  readonly destroyed: boolean;
  readonly expired: boolean;
  update: (dt: number, time: number) => void;
  dispose: () => void;
}
