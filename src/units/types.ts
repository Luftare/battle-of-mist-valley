import { Scene, TransformNode } from "@babylonjs/core";
import type { Team } from "../theme/colors";

export interface UnitHandle {
  root: TransformNode;
  team: Team;
  kind: string;
  update: (dt: number, time: number) => void;
  dispose: () => void;
}

export type UnitFactory = (
  scene: Scene,
  name: string,
  team: Team,
) => UnitHandle;
