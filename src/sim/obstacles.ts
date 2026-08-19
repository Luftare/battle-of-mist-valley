import {
  PLAY_DEPTH,
  PLAY_WIDTH,
} from "../game/stats";
import {
  inBuildingBand,
  nearTurret,
} from "../game/slotLayout";
import type { Obstacle } from "../game/pathfinding";
import { createTerrainRng } from "./rng";

export interface SimTree {
  x: number;
  z: number;
  radius: number;
  standing: boolean;
}

export interface SimObstacleField {
  trees: SimTree[];
  rocks: Obstacle[];
  /** Standing trees + rocks (mutated when tanks ram). */
  obstacles: Obstacle[];
  rockObstacles: Obstacle[];
  ramTreesAt: (x: number, z: number, radius: number) => void;
}

/**
 * Same tree/rock placement as `createTerrain` (seed 42), without meshes.
 */
export function createSimObstacles(
  width = PLAY_WIDTH,
  depth = PLAY_DEPTH,
): SimObstacleField {
  const rand = createTerrainRng(42);
  const halfX = width * 0.5;
  const halfZ = depth * 0.5;
  const propPoints: { x: number; z: number }[] = [];
  const MIN_PROP_SEP = 5.5;

  function tooCloseToProps(x: number, z: number): boolean {
    for (const p of propPoints) {
      if (Math.hypot(p.x - x, p.z - z) < MIN_PROP_SEP) return true;
    }
    return false;
  }

  const trees: SimTree[] = [];
  const rocks: Obstacle[] = [];
  const obstacles: Obstacle[] = [];
  const rockObstacles: Obstacle[] = [];
  const treeObs = new Map<SimTree, Obstacle>();

  const treeCount = 22;
  for (let i = 0; i < treeCount; i++) {
    let x = 0;
    let z = 0;
    let attempts = 0;
    do {
      x = (rand() - 0.5) * width * 0.72;
      z = (rand() - 0.5) * depth * 0.85;
      attempts++;
    } while (
      (Math.abs(x) < 2.2 ||
        inBuildingBand(x, z, halfX, halfZ) ||
        nearTurret(x, z, halfX, halfZ) ||
        tooCloseToProps(x, z)) &&
      attempts < 80
    );
    if (attempts >= 80) continue;
    propPoints.push({ x, z });
    const scale = 0.65 + rand() * 0.55;
    rand(); // rotation.y
    rand(); // idle phase
    const radius = 0.14 * scale + 0.08;
    const tree: SimTree = { x, z, radius, standing: true };
    const obs: Obstacle = { x, z, radius };
    trees.push(tree);
    treeObs.set(tree, obs);
    obstacles.push(obs);
  }

  const rockCount = 9;
  for (let i = 0; i < rockCount; i++) {
    let x = 0;
    let z = 0;
    let attempts = 0;
    do {
      x = (rand() - 0.5) * width * 0.7;
      z = (rand() - 0.5) * depth * 0.85;
      attempts++;
    } while (
      (Math.abs(x) < 1.8 ||
        inBuildingBand(x, z, halfX, halfZ) ||
        nearTurret(x, z, halfX, halfZ) ||
        tooCloseToProps(x, z)) &&
      attempts < 80
    );
    if (attempts >= 80) continue;
    propPoints.push({ x, z });
    const scale = 0.35 + rand() * 0.7;
    rand(); // rotation
    rand(); // phase
    const obs: Obstacle = { x, z, radius: 0.32 * scale + 0.12 };
    rocks.push(obs);
    rockObstacles.push(obs);
    obstacles.push(obs);
  }

  return {
    trees,
    rocks,
    obstacles,
    rockObstacles,
    ramTreesAt: (x, z, radius) => {
      for (const tree of trees) {
        if (!tree.standing) continue;
        if (Math.hypot(tree.x - x, tree.z - z) > radius + tree.radius) continue;
        tree.standing = false;
        const obs = treeObs.get(tree);
        if (!obs) continue;
        const i = obstacles.indexOf(obs);
        if (i >= 0) obstacles.splice(i, 1);
      }
    },
  };
}
