import { Vector3, type TransformNode } from "@babylonjs/core";
import { BUILDING_MAX_HP, CORPSE_LIFETIME_SEC, type UnitKind } from "../game/stats";
import type { Team } from "../theme/colors";
import type { BuildingHandle, BuildingKind } from "./types";

interface BuildingCombatOpts {
  root: TransformNode;
  team: Team;
  kind: BuildingKind;
  spawns: UnitKind;
  updateAlive: (dt: number, time: number) => void;
  disposeVisuals: () => void;
}

/**
 * Adds HP, destruction sink, and CombatEntity methods around a visual building.
 */
export function withBuildingCombat(opts: BuildingCombatOpts): BuildingHandle {
  const maxHp = BUILDING_MAX_HP;
  let hp = maxHp;
  let destroyed = false;
  let expired = false;
  let sinkAge = 0;
  const baseY = opts.root.position.y;
  const hitPoint = new Vector3();
  let shake = 0;

  return {
    root: opts.root,
    team: opts.team,
    kind: opts.kind,
    spawns: opts.spawns,
    get hp() {
      return hp;
    },
    get maxHp() {
      return maxHp;
    },
    get destroyed() {
      return destroyed;
    },
    get expired() {
      return expired;
    },
    getHitPoint: (out?: Vector3) => {
      const p = out ?? hitPoint;
      p.copyFrom(opts.root.getAbsolutePosition());
      p.y += 0.85;
      return p;
    },
    applyImpact: (_fromX, _fromZ, strength) => {
      shake = Math.min(0.35, shake + strength * 0.04);
    },
    takeDamage: (amount) => {
      if (destroyed || amount <= 0) return;
      hp = Math.max(0, hp - amount);
      if (hp <= 0) {
        destroyed = true;
        sinkAge = 0;
      }
    },
    update: (dt, time) => {
      if (destroyed) {
        sinkAge += dt;
        const t = Math.min(1, sinkAge / CORPSE_LIFETIME_SEC);
        opts.root.position.y = baseY - t * 2.4;
        if (sinkAge >= CORPSE_LIFETIME_SEC) expired = true;
        return;
      }
      if (shake > 0.001) {
        opts.root.rotation.z = Math.sin(time * 40) * shake * 0.15;
        opts.root.rotation.x = Math.cos(time * 32) * shake * 0.1;
        shake = Math.max(0, shake - dt * 1.8);
      } else {
        opts.root.rotation.z = 0;
        opts.root.rotation.x = 0;
      }
      opts.updateAlive(dt, time);
    },
    dispose: () => {
      opts.disposeVisuals();
    },
  };
}
