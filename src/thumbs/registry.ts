import type { Scene } from "@babylonjs/core";
import type { TransformNode } from "@babylonjs/core";
import {
  createBarracks,
  createDepot,
  createFactory,
  createHelipad,
  createResearchLab,
  createTurret,
} from "../buildings";
import {
  createHelicopter,
  createRifleman,
  createSupplyTruck,
  createTank,
} from "../units";

/**
 * Thumbnail subject registry — add a new model here and re-run `npm run bake-thumbs`.
 *
 * 1. Implement `create` (same factory the game uses).
 * 2. Optionally `prepare` for pose / altitude / hide-extra-fx.
 * 3. Optionally `frameRadius` when auto-bounds misbehave (spinning rotors, etc.).
 * 4. Wire the new id into HUD / upgrades if the menu should show it.
 */

export type ThumbHandle = {
  root: TransformNode;
  dispose: () => void;
  update?: (dt: number, t: number) => void;
};

export type ThumbDef = {
  id: string;
  /** Spawn the model in the bake scene (blue team by convention). */
  create: (scene: Scene, name: string) => ThumbHandle;
  /**
   * Pose / tweak after spawn, before framing.
   * Return false to skip the default idle `update(0,0)` call.
   */
  prepare?: (handle: ThumbHandle) => void | false;
  /** Fixed camera radius (skips AABB auto-frame). */
  frameRadius?: number;
  /** Extra distance multiplier (1 = default). Useful for wide pads / tall stacks. */
  frameScale?: number;
  /** Extra yaw on top of the shared face-camera turn (radians). */
  yawOffset?: number;
};

const TEAM = "blue" as const;

/**
 * Source of truth for what gets baked to `public/thumbs/<id>.png`.
 * Order is bake order only — does not affect the game.
 */
export const THUMB_REGISTRY: readonly ThumbDef[] = [
  {
    id: "rifleman",
    create: (scene, name) => createRifleman(scene, name, TEAM),
  },
  {
    id: "tank",
    create: (scene, name) => createTank(scene, name, TEAM),
  },
  {
    id: "helicopter",
    create: (scene, name) => createHelicopter(scene, name, TEAM),
    prepare: (handle) => {
      // Heli cruises high in-game — drop fuselage for a readable icon.
      for (const node of handle.root.getChildTransformNodes(true)) {
        if (node.name.endsWith("_body")) node.position.y = 0.55;
      }
      // Skip idle update — spinning rotors explode the bounding sphere.
      return false;
    },
    frameRadius: 5.2,
  },
  {
    id: "supplyTruck",
    create: (scene, name) => createSupplyTruck(scene, name, TEAM),
  },
  {
    id: "barracks",
    create: (scene, name) => createBarracks(scene, name, TEAM),
    frameScale: 1.45,
  },
  {
    id: "depot",
    create: (scene, name) => createDepot(scene, name, TEAM),
    frameScale: 1.1,
  },
  {
    id: "factory",
    create: (scene, name) => createFactory(scene, name, TEAM),
    frameScale: 1.15,
  },
  {
    id: "researchLab",
    create: (scene, name) => createResearchLab(scene, name, TEAM),
    frameScale: 1.1,
  },
  {
    id: "helipad",
    create: (scene, name) => createHelipad(scene, name, TEAM),
    frameScale: 1.2,
  },
  {
    id: "turret",
    create: (scene, name) => createTurret(scene, name, TEAM),
  },
];

export const THUMB_IDS: string[] = THUMB_REGISTRY.map((d) => d.id);

export function getThumbDef(id: string): ThumbDef | undefined {
  return THUMB_REGISTRY.find((d) => d.id === id);
}

export function resolveThumbDefs(ids?: string[]): ThumbDef[] {
  if (!ids || ids.length === 0) return [...THUMB_REGISTRY];
  const missing = ids.filter((id) => !getThumbDef(id));
  if (missing.length) {
    throw new Error(
      `Unknown thumb id(s): ${missing.join(", ")}. Known: ${THUMB_IDS.join(", ")}`,
    );
  }
  return ids.map((id) => getThumbDef(id)!);
}
