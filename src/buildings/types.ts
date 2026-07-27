import type { TransformNode } from "@babylonjs/core";
import type { Team } from "../theme/colors";
import type { CombatEntity } from "../game/combatEntity";
import type { UnitKind } from "../game/stats";

export type BuildingKind = "barracks" | "factory" | "helipad" | "depot";

export interface BuildingHandle extends CombatEntity {
  root: TransformNode;
  team: Team;
  kind: BuildingKind;
  /** Unit type this building produces. */
  spawns: UnitKind;
  hp: number;
  maxHp: number;
  takeDamage: (amount: number) => void;
  /** Owner-initiated teardown (no refund). */
  beginCollapse: () => void;
  readonly collapsing: boolean;
  readonly destroyed: boolean;
  readonly expired: boolean;
  update: (dt: number, time: number) => void;
  dispose: () => void;
}
