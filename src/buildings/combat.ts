import { Vector3, type TransformNode } from "@babylonjs/core";
import { createWreckSmoke, type WreckSmokeHandle } from "../fx/wreckSmoke";
import {
  BUILDING_MAX_HP,
  COLLAPSE_DURATION_SEC,
  CORPSE_LIFETIME_SEC,
  type UnitKind,
} from "../game/stats";
import type { Team } from "../theme/colors";
import type { BuildingHandle, BuildingKind } from "./types";

interface BuildingCombatOpts {
  root: TransformNode;
  team: Team;
  kind: BuildingKind;
  spawns: UnitKind | null;
  updateAlive: (dt: number, time: number) => void;
  disposeVisuals: () => void;
}

/**
 * Adds HP, destruction sink, owner collapse, and CombatEntity methods.
 */
export function withBuildingCombat(opts: BuildingCombatOpts): BuildingHandle {
  const maxHp = BUILDING_MAX_HP;
  let hp = maxHp;
  let destroyed = false;
  let collapsing = false;
  let expired = false;
  let sinkAge = 0;
  let collapseAge = 0;
  const baseY = opts.root.position.y;
  const baseScale = opts.root.scaling.x;
  const hitPoint = new Vector3();
  let shake = 0;
  let smoke: WreckSmokeHandle | null = null;

  function startWreckSmoke(): void {
    if (smoke) return;
    smoke = createWreckSmoke(opts.root.getScene(), opts.root, {
      rate: 42,
      scale: 1.45,
    });
    smoke.start();
  }

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
    get collapsing() {
      return collapsing;
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
      if (collapsing) return;
      shake = Math.min(0.35, shake + strength * 0.04);
    },
    takeDamage: (amount) => {
      if (destroyed || collapsing || amount <= 0) return;
      hp = Math.max(0, hp - amount);
      if (hp <= 0) {
        destroyed = true;
        sinkAge = 0;
        startWreckSmoke();
      }
    },
    beginCollapse: () => {
      if (destroyed || collapsing || expired) return;
      collapsing = true;
      collapseAge = 0;
      // Stop counting as a living structure for combat / win checks
      destroyed = true;
      hp = 0;
      startWreckSmoke();
    },
    update: (dt, time) => {
      if (collapsing) {
        collapseAge += dt;
        const t = Math.min(1, collapseAge / COLLAPSE_DURATION_SEC);
        // Tear down: sink + shrink + wobble
        opts.root.position.y = baseY - t * 1.6;
        const s = baseScale * (1 - t * 0.85);
        opts.root.scaling.setAll(s);
        opts.root.rotation.z = Math.sin(time * 18) * 0.08 * (1 - t);
        opts.root.rotation.x = Math.cos(time * 14) * 0.05 * (1 - t);
        smoke?.update();
        if (collapseAge >= COLLAPSE_DURATION_SEC) expired = true;
        return;
      }

      if (destroyed) {
        sinkAge += dt;
        const t = Math.min(1, sinkAge / CORPSE_LIFETIME_SEC);
        opts.root.position.y = baseY - t * 2.4;
        smoke?.update();
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
      smoke?.dispose();
      smoke = null;
      opts.disposeVisuals();
    },
  };
}
