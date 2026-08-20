import type { BuildingKind } from "../buildings/types";
import type { UnitKind } from "../game/stats";
import type { Team } from "../theme/colors";
import type { UpgradeId } from "../game/upgrades";

export type { BuildingKind, UnitKind, Team, UpgradeId };

export const SIM_HZ = 20;
export const SIM_DT = 1 / SIM_HZ;
export const SNAPSHOT_HZ = 10;

export type PlayerCommand =
  | { type: "build"; slotIndex: number; kind: BuildingKind }
  | { type: "collapse"; slotIndex: number }
  | { type: "research"; id: UpgradeId };

export type FocusKind = "unit" | "building" | "turret";
export type WeaponKind = "rifle" | "tank" | "heliGun" | "turret";

export type MatchEvent =
  | {
      type: "BuildingPlaced";
      team: Team;
      slotIndex: number;
      kind: BuildingKind;
      buildingId: number;
    }
  | {
      type: "ConstructionComplete";
      buildingId: number;
      slotIndex: number;
      team: Team;
    }
  | {
      type: "BuildingCollapsed";
      team: Team;
      slotIndex: number;
      buildingId: number;
    }
  | {
      type: "BuildingDestroyed";
      team: Team;
      slotIndex: number;
      buildingId: number;
    }
  | { type: "PadFreed"; team: Team; slotIndex: number }
  | {
      type: "UnitSpawned";
      unitId: number;
      team: Team;
      kind: UnitKind;
      x: number;
      z: number;
      yaw: number;
      buildingId: number;
    }
  | { type: "UnitDied"; unitId: number }
  | { type: "TurretDied"; turretId: number }
  | {
      type: "UnitFired";
      attackerId: number;
      attackerKind: "unit" | "turret";
      targetId: number;
      targetKind: FocusKind;
      didHit: boolean;
      impactX: number;
      impactY: number;
      impactZ: number;
      weapon: WeaponKind;
    }
  | {
      type: "MissileLaunch";
      missileId: number;
      heliId: number;
      targetId: number;
      targetKind: FocusKind;
      x: number;
      y: number;
      z: number;
    }
  | {
      type: "MissileHit";
      missileId: number;
      targetId: number;
      x: number;
      y: number;
      z: number;
    }
  | { type: "ResearchStarted"; team: Team; id: UpgradeId }
  | { type: "ResearchComplete"; team: Team; id: UpgradeId }
  | { type: "TurretBounty"; turretId: number; killer: Team; amount: number }
  | { type: "TruckCoin"; unitId: number; team: Team; amount: number }
  | { type: "FlagCoin"; team: Team; amount: number }
  | { type: "FlagOwnerChanged"; owner: Team | null }
  | { type: "MatchEnded"; winner: Team };

export interface SlotSnapshot {
  team: Team;
  index: number;
  x: number;
  z: number;
  buildingId: number | null;
  kind: BuildingKind | null;
  hp: number;
  maxHp: number;
  constructing: boolean;
  collapsing: boolean;
  destroyed: boolean;
  constructAge: number;
}

export interface TurretSnapshot {
  id: number;
  team: Team;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  shootRange: number;
  focusId: number | null;
  focusKind: FocusKind | null;
}

export interface UnitSnapshot {
  id: number;
  team: Team;
  kind: UnitKind;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  moving: boolean;
  combat: boolean;
  focusId: number | null;
  focusKind: FocusKind | null;
  missilesEnabled: boolean;
}

export interface MissileSnapshot {
  id: number;
  heliId: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  targetId: number;
}

export interface ResearchSnapshot {
  id: UpgradeId;
  elapsed: number;
  duration: number;
}

export interface MatchSnapshot {
  tick: number;
  elapsed: number;
  coins: Record<Team, number>;
  tech: Record<Team, Record<UpgradeId, number>>;
  research: Record<Team, ResearchSnapshot | null>;
  flagOwner: Team | null;
  gameOver: boolean;
  winner: Team | null;
  slots: SlotSnapshot[];
  turrets: TurretSnapshot[];
  units: UnitSnapshot[];
  missiles: MissileSnapshot[];
}
