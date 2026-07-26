import type { TransformNode } from "@babylonjs/core";
import type { Team } from "../theme/colors";

export type BuildingKind = "barracks" | "factory" | "helipad";

export interface BuildingHandle {
  root: TransformNode;
  team: Team;
  kind: BuildingKind;
  update: (dt: number, time: number) => void;
  dispose: () => void;
}
