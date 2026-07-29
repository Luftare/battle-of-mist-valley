import { TransformNode, Vector3 } from "@babylonjs/core";
import { spawnExplosion } from "../fx/explosion";
import { createWreckSmoke, type WreckSmokeHandle } from "../fx/wreckSmoke";
import {
  BUILD_DURATION_SEC,
  BUILDING_MAX_HP,
  CORPSE_LIFETIME_SEC,
  type UnitKind,
} from "../game/stats";
import type { Team } from "../theme/colors";
import {
  makeDebris,
  randRange,
  randSpin,
  stepDebris,
  type DebrisPiece,
} from "../units/debris";
import type { BuildingHandle, BuildingKind } from "./types";

interface BuildingCombatOpts {
  root: TransformNode;
  team: Team;
  kind: BuildingKind;
  spawns: UnitKind | null;
  updateAlive: (dt: number, time: number) => void;
  disposeVisuals: () => void;
}

/** How deep pieces dig once sinking. */
const DEBRIS_SINK_DEPTH = 2.2;
/** Max wait for bounce settle before forcing the bury phase. */
const DEBRIS_SINK_MAX_WAIT_SEC = 2.8;
/** Brief pause on the ground after settle before burying. */
const DEBRIS_SINK_GROUND_HOLD_SEC = 0.45;

/**
 * Adds HP, construction, explosive destruction, owner collapse, and CombatEntity methods.
 * Combat death and owner collapse both instant-blow the structure into flying chunks
 * that later sink — same language as wrecked tanks / helis.
 */
export function withBuildingCombat(opts: BuildingCombatOpts): BuildingHandle {
  const maxHp = BUILDING_MAX_HP;
  let hp = maxHp;
  let destroyed = false;
  let collapsing = false;
  let constructing = true;
  let buildAge = 0;
  let buildSettled = false;
  let expired = false;
  let wreckAge = 0;
  let baseY = opts.root.position.y;
  let baseScale = opts.root.scaling.x;
  /** How far below grade the building starts while erecting. */
  const BUILD_RISE = 2.15;
  const hitPoint = new Vector3();
  let shake = 0;
  let smoke: WreckSmokeHandle | null = null;
  const debris: DebrisPiece[] = [];
  /** Fixed footprint node so smoke stays where the building stood. */
  let wreckAnchor: TransformNode | null = null;
  const sinkBaseY = new Map<DebrisPiece, number>();
  let sinking = false;
  let settledHold = 0;
  let sinkStartAge = 0;
  /** World-space ground under the building footprint. */
  let groundY = 0.06;

  function startWreckSmoke(at: Vector3): void {
    if (smoke) return;
    const scene = opts.root.getScene();
    wreckAnchor = new TransformNode(`${opts.root.name}_wreck`, scene);
    wreckAnchor.position.copyFrom(at);
    wreckAnchor.position.y = Math.max(groundY + 0.2, at.y * 0.35 + groundY);
    smoke = createWreckSmoke(scene, wreckAnchor, {
      rate: 36,
      scale: 1.25,
    });
    smoke.start();
  }

  function collectBlastPieces(): TransformNode[] {
    const pieces: TransformNode[] = [];
    for (const child of opts.root.getChildren()) {
      if (!(child instanceof TransformNode)) continue;
      const n = child.name.toLowerCase();
      if (n.includes("shadow") || n.includes("blob")) continue;
      pieces.push(child);
    }
    return pieces;
  }

  /** Soft pop: pieces nudge apart, land nearby, then bury — tiny flash only. */
  function explode(): void {
    const scene = opts.root.getScene();
    const origin = opts.root.getAbsolutePosition().clone();
    baseY = opts.root.position.y;
    groundY = baseY + 0.04;
    origin.y = groundY + 0.55;

    const pieces = collectBlastPieces();
    for (let i = 0; i < pieces.length; i++) {
      const piece = pieces[i];
      // Mostly sideways scatter; barely any loft so chunks land quickly
      const yaw = Math.random() * Math.PI * 2;
      const outward = randRange(0.55, 1.65);
      const up = randRange(0.35, 1.15);
      debris.push(
        makeDebris(
          piece,
          new Vector3(
            Math.cos(yaw) * outward,
            up,
            Math.sin(yaw) * outward,
          ),
          randSpin(1.2, 4.5),
        ),
      );
    }

    spawnExplosion(scene, origin, {
      scale: 0.45 + randRange(0, 0.12),
      duration: 0.28,
    });

    opts.root.scaling.setAll(baseScale);
    opts.root.rotation.x = 0;
    opts.root.rotation.z = 0;

    startWreckSmoke(origin);
    wreckAge = 0;
    sinking = false;
    settledHold = 0;
    sinkStartAge = 0;
  }

  function stepWreck(dt: number): void {
    wreckAge += dt;

    if (!sinking) {
      stepDebris(debris, dt, groundY, 18);

      const allDown =
        debris.length === 0 || debris.every((p) => p.settled);
      if (allDown) settledHold += dt;
      else settledHold = 0;

      if (
        settledHold >= DEBRIS_SINK_GROUND_HOLD_SEC ||
        wreckAge >= DEBRIS_SINK_MAX_WAIT_SEC
      ) {
        sinking = true;
        sinkStartAge = wreckAge;
        for (const p of debris) {
          // Never bury from mid-air — pin to the footprint ground first
          if (p.node.position.y > groundY + 0.02) {
            p.node.position.y = groundY;
          }
          p.settled = true;
          p.vel.setAll(0);
          p.angVel.scaleInPlace(0.15);
          sinkBaseY.set(p, p.node.position.y);
        }
      }
    } else {
      const sinkT = Math.min(
        1,
        (wreckAge - sinkStartAge) /
          Math.max(0.5, CORPSE_LIFETIME_SEC - sinkStartAge),
      );
      const eased = sinkT * sinkT * (3 - 2 * sinkT);
      for (const p of debris) {
        const by = sinkBaseY.get(p) ?? groundY;
        p.node.position.y = by - eased * DEBRIS_SINK_DEPTH;
      }
    }

    smoke?.update();
    if (wreckAge >= CORPSE_LIFETIME_SEC) expired = true;
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
    get constructing() {
      return constructing;
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
      if (destroyed || constructing) return;
      shake = Math.min(0.35, shake + strength * 0.04);
    },
    takeDamage: (amount) => {
      if (destroyed || amount <= 0) return;
      hp = Math.max(0, hp - amount);
      if (hp <= 0) {
        destroyed = true;
        constructing = false;
        explode();
      }
    },
    beginCollapse: () => {
      if (destroyed || collapsing || expired) return;
      collapsing = true;
      constructing = false;
      destroyed = true;
      hp = 0;
      // Instant demolition — no slow shrink teardown
      explode();
    },
    update: (dt, time) => {
      if (destroyed) {
        stepWreck(dt);
        return;
      }

      if (constructing) {
        // Capture resting pose after placeBuilding sets position/scale
        if (!buildSettled) {
          baseY = opts.root.position.y;
          baseScale = Math.max(0.05, opts.root.scaling.x);
          opts.root.scaling.setAll(baseScale);
          buildSettled = true;
        }
        buildAge += dt;
        const t = Math.min(1, buildAge / BUILD_DURATION_SEC);
        const eased = t * t * (3 - 2 * t);
        opts.root.position.y = baseY - BUILD_RISE * (1 - eased);
        opts.root.scaling.setAll(baseScale);
        if (t >= 1) {
          constructing = false;
          opts.root.position.y = baseY;
        }
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
      wreckAnchor?.dispose();
      wreckAnchor = null;
      for (const d of debris) d.node.dispose(false, true);
      debris.length = 0;
      opts.disposeVisuals();
    },
  };
}
