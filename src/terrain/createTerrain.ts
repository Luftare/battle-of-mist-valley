import {
  Color3,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { PLAY_SIZE } from "../game/stats";
import {
  getBuildingSlotPositions,
  inBuildingBand,
  PLATFORM_PAD_HALF_D,
  PLATFORM_PAD_HALF_W,
} from "../game/slotLayout";
import { WORLD_COLORS } from "../theme/colors";
import { box, colorMat, cylinder } from "../theme/materials";
import { createBlobShadow, type BlobShadowHandle } from "../units/shadow";

export interface Obstacle {
  x: number;
  z: number;
  radius: number;
}

export interface TerrainTree {
  x: number;
  z: number;
  radius: number;
  readonly standing: boolean;
  /**
   * Tank ram: tip the tree away from (fromX, fromZ), then sink.
   * No-op if already felled.
   */
  ram: (fromX: number, fromZ: number) => void;
}

export interface TerrainHandle {
  root: TransformNode;
  size: number;
  /**
   * Live obstacle list for pathfinding (standing trees + rocks).
   * Felled trees are removed automatically.
   */
  obstacles: readonly Obstacle[];
  /** Rocks only — tanks path around these but ram trees. */
  rockObstacles: readonly Obstacle[];
  trees: readonly TerrainTree[];
  sampleGroundY: (x: number, z: number) => number;
  /** Height of the rendered ground mesh at world XZ (matches hills visually). */
  getGroundYAt: (x: number, z: number) => number;
  /** Max mesh height under a circular footprint (for pads on slopes). */
  getGroundYAtFootprint: (x: number, z: number, radius: number) => number;
  /** Knock over any standing tree the tank overlaps. */
  ramTreesAt: (x: number, z: number, radius: number) => void;
  update: (dt: number, time: number) => void;
  dispose: () => void;
}

interface AnimatedProp {
  node: TransformNode;
  phase: number;
  kind: "tree" | "grass" | "rock";
}

type TreeState = "standing" | "falling" | "sinking" | "gone";

interface TreeRuntime {
  node: TransformNode;
  shadow: BlobShadowHandle;
  obstacle: Obstacle;
  handle: TerrainTree;
  state: TreeState;
  /** Tip axis in XZ (tree falls along this direction). */
  fallX: number;
  fallZ: number;
  tip: number;
  sink: number;
  phase: number;
  baseY: number;
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function createTree(
  scene: Scene,
  name: string,
  parent: TransformNode,
  scale: number,
): TransformNode {
  const tree = new TransformNode(name, scene);
  tree.parent = parent;
  tree.scaling.setAll(scale);

  const bark = colorMat(scene, "bark", WORLD_COLORS.bark);
  const barkDark = colorMat(scene, "barkDark", WORLD_COLORS.barkDark);
  const foliage = colorMat(scene, "foliage", WORLD_COLORS.foliage);
  const foliageLight = colorMat(scene, "foliageLight", WORLD_COLORS.foliageLight);

  cylinder(
    scene,
    `${name}_trunk`,
    { height: 1.2, diameter: 0.28, tessellation: 6 },
    new Vector3(0, 0.6, 0),
    bark,
    tree,
  );

  box(scene, `${name}_canopy1`, { w: 1.4, h: 0.7, d: 1.4 }, new Vector3(0, 1.4, 0), foliage, tree);
  box(scene, `${name}_canopy2`, { w: 1.0, h: 0.6, d: 1.0 }, new Vector3(0, 1.95, 0), foliageLight, tree);
  box(scene, `${name}_canopy3`, { w: 0.55, h: 0.45, d: 0.55 }, new Vector3(0, 2.35, 0), foliage, tree);
  box(scene, `${name}_nub`, { w: 0.18, h: 0.18, d: 0.35 }, new Vector3(0.15, 0.9, 0), barkDark, tree);

  return tree;
}

function createRock(
  scene: Scene,
  name: string,
  parent: TransformNode,
  scale: number,
): TransformNode {
  const rock = new TransformNode(name, scene);
  rock.parent = parent;
  rock.scaling.setAll(scale);

  const rockMat = colorMat(scene, "rock", WORLD_COLORS.rock);
  const rockDark = colorMat(scene, "rockDark", WORLD_COLORS.rockDark);
  const rockLight = colorMat(scene, "rockLight", WORLD_COLORS.rockLight);

  const a = box(scene, `${name}_a`, { w: 0.9, h: 0.55, d: 0.7 }, new Vector3(0, 0.25, 0), rockMat, rock);
  a.rotation.y = 0.3;
  const b = box(scene, `${name}_b`, { w: 0.5, h: 0.4, d: 0.55 }, new Vector3(0.3, 0.18, 0.15), rockDark, rock);
  b.rotation.y = -0.5;
  box(scene, `${name}_c`, { w: 0.35, h: 0.28, d: 0.35 }, new Vector3(-0.25, 0.4, -0.1), rockLight, rock);

  return rock;
}

function createGrassTuft(
  scene: Scene,
  name: string,
  parent: TransformNode,
  scale: number,
): TransformNode {
  const tuft = new TransformNode(name, scene);
  tuft.parent = parent;
  tuft.scaling.setAll(scale);

  const grass = colorMat(scene, "grassBlade", WORLD_COLORS.grassLight);
  const grassDark = colorMat(scene, "grassBladeDark", WORLD_COLORS.grassDark);

  const blades = [
    { x: 0, z: 0, h: 0.35, w: 0.06, mat: grass },
    { x: 0.08, z: 0.04, h: 0.28, w: 0.05, mat: grassDark },
    { x: -0.07, z: 0.05, h: 0.3, w: 0.05, mat: grass },
    { x: 0.02, z: -0.08, h: 0.25, w: 0.045, mat: grassDark },
  ] as const;

  for (let i = 0; i < blades.length; i++) {
    const b = blades[i];
    box(
      scene,
      `${name}_blade_${i}`,
      { w: b.w, h: b.h, d: b.w * 0.5 },
      new Vector3(b.x, b.h / 2, b.z),
      b.mat,
      tuft,
    );
  }

  return tuft;
}

/**
 * Flat meadow with a single soft hill in the center.
 */
function sampleHeightMap(x: number, z: number): number {
  const dist = Math.hypot(x, z);
  const radius = 5.5;
  const t = Math.max(0, 1 - dist / radius);
  // Smoothstep falloff so the mound blends into flat ground
  const falloff = t * t * (3 - 2 * t);
  return falloff * 1.35;
}

const GROUND_SUBDIVISIONS = 72;

/** Bilinear height lookup from the baked ground mesh vertices. */
function buildGroundHeightLookup(
  positions: number[],
  size: number,
): (x: number, z: number) => number {
  const half = size * 0.5;
  const n = GROUND_SUBDIVISIONS + 1;
  const grid: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const z = positions[i + 2];
    const y = positions[i + 1];
    const col = Math.round(((x + half) / size) * GROUND_SUBDIVISIONS);
    const row = Math.round(((z + half) / size) * GROUND_SUBDIVISIONS);
    if (row >= 0 && row < n && col >= 0 && col < n) {
      grid[row][col] = y;
    }
  }

  return (x: number, z: number) => {
    const colF = ((x + half) / size) * GROUND_SUBDIVISIONS;
    const rowF = ((z + half) / size) * GROUND_SUBDIVISIONS;
    const col0 = Math.max(0, Math.min(GROUND_SUBDIVISIONS - 1, Math.floor(colF)));
    const row0 = Math.max(0, Math.min(GROUND_SUBDIVISIONS - 1, Math.floor(rowF)));
    const col1 = Math.min(col0 + 1, GROUND_SUBDIVISIONS);
    const row1 = Math.min(row0 + 1, GROUND_SUBDIVISIONS);
    const tx = colF - col0;
    const tz = rowF - row0;

    const h = (row: number, col: number) => grid[row][col] ?? 0;
    const y00 = h(row0, col0);
    const y10 = h(row0, col1);
    const y01 = h(row1, col0);
    const y11 = h(row1, col1);
    const y0 = y00 + (y10 - y00) * tx;
    const y1 = y01 + (y11 - y01) * tx;
    return y0 + (y1 - y0) * tz;
  };
}

/** Highest ground under a circular footprint — keeps wide pads flush on slopes. */
function buildGroundYAtFootprint(
  getGroundYAt: (x: number, z: number) => number,
): (x: number, z: number, radius: number) => number {
  return (x, z, radius) => {
    let maxY = getGroundYAt(x, z);
    const ringCount = 8;
    for (let ring = 0.5; ring <= 1; ring += 0.5) {
      const r = radius * ring;
      for (let i = 0; i < ringCount; i++) {
        const a = (i / ringCount) * Math.PI * 2;
        maxY = Math.max(maxY, getGroundYAt(x + Math.cos(a) * r, z + Math.sin(a) * r));
      }
    }
    return maxY;
  };
}

/**
 * Flatten each build-slot pad to its own local heightmap height so platforms
 * sit flush without painting dirt over the grass.
 */
function flattenSlotPads(
  positions: number[],
  half: number,
  heightFn: (x: number, z: number) => number,
): void {
  const slots = getBuildingSlotPositions(half);
  const padYs = slots.map((s) => heightFn(s.x, s.z));
  for (let i = 0; i < positions.length; i += 3) {
    const vx = positions[i];
    const vz = positions[i + 2];
    for (let s = 0; s < slots.length; s++) {
      const slot = slots[s];
      if (
        Math.abs(vx - slot.x) <= PLATFORM_PAD_HALF_W &&
        Math.abs(vz - slot.z) <= PLATFORM_PAD_HALF_D
      ) {
        positions[i + 1] = padYs[s];
        break;
      }
    }
  }
}

const FALL_DURATION = 0.55;
const SINK_DURATION = 10;
const FALL_ANGLE = Math.PI / 2 - 0.08;

/**
 * Square meadow battlefield. Grass tufts are decorative only.
 * Trees block infantry; tanks ram them over. Rocks block everyone on foot.
 */
export function createTerrain(scene: Scene, size = PLAY_SIZE): TerrainHandle {
  const root = new TransformNode("terrain", scene);
  const animated: AnimatedProp[] = [];
  const shadows: BlobShadowHandle[] = [];
  const rockObstacles: Obstacle[] = [];
  const obstacles: Obstacle[] = [];
  const treeRuntimes: TreeRuntime[] = [];
  const treeHandles: TerrainTree[] = [];
  const rand = seededRandom(42);
  const half = size * 0.5;

  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = Color3.FromHexString(WORLD_COLORS.grass);
  groundMat.specularColor = new Color3(0.05, 0.08, 0.04);

  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: size, height: size, subdivisions: GROUND_SUBDIVISIONS },
    scene,
  );
  ground.material = groundMat;
  ground.parent = root;
  ground.receiveShadows = true;

  let getGroundYAt: (x: number, z: number) => number = sampleHeightMap;
  let getGroundYAtFootprint: (x: number, z: number, radius: number) => number =
    (x, z) => sampleHeightMap(x, z);
  const positions = ground.getVerticesData("position");
  if (positions) {
    const pos = positions as number[];
    for (let i = 0; i < pos.length; i += 3) {
      pos[i + 1] = sampleHeightMap(pos[i], pos[i + 2]);
    }
    flattenSlotPads(pos, half, sampleHeightMap);
    ground.updateVerticesData("position", pos);
    ground.createNormals(true);
    getGroundYAt = buildGroundHeightLookup(pos, size);
    getGroundYAtFootprint = buildGroundYAtFootprint(getGroundYAt);
  }

  function removeObstacle(obs: Obstacle): void {
    const i = obstacles.indexOf(obs);
    if (i >= 0) obstacles.splice(i, 1);
  }

  function beginFall(runtime: TreeRuntime, fromX: number, fromZ: number): void {
    if (runtime.state !== "standing") return;
    let fx = runtime.node.position.x - fromX;
    let fz = runtime.node.position.z - fromZ;
    const len = Math.hypot(fx, fz);
    if (len < 1e-4) {
      // Head-on / overlapping center — tip along tank "forward" away randomly
      const a = Math.random() * Math.PI * 2;
      fx = Math.cos(a);
      fz = Math.sin(a);
    } else {
      fx /= len;
      fz /= len;
    }
    runtime.fallX = fx;
    runtime.fallZ = fz;
    runtime.tip = 0;
    runtime.state = "falling";
    removeObstacle(runtime.obstacle);
  }

  const treeCount = 14;
  for (let i = 0; i < treeCount; i++) {
    let x = 0;
    let z = 0;
    let attempts = 0;
    do {
      x = (rand() - 0.5) * size * 0.72;
      z = (rand() - 0.5) * size * 0.85;
      attempts++;
    } while ((Math.abs(x) < 2.2 || inBuildingBand(x, z, half)) && attempts < 40);

    const scale = 0.65 + rand() * 0.55;
    const tree = createTree(scene, `tree_${i}`, root, scale);
    tree.position.x = x;
    tree.position.z = z;
    tree.position.y = getGroundYAt(x, z);
    tree.rotation.y = rand() * Math.PI * 2;

    const radius = 0.14 * scale + 0.08;
    const obstacle: Obstacle = { x, z, radius };
    obstacles.push(obstacle);

    const shadow = createBlobShadow(scene, `tree_${i}`, tree, {
      width: 1.35,
      depth: 1.35,
      opacity: 0.42,
      sizePerHeight: 0.04,
      getCasterHeight: () => 1.5,
      groundY: () => getGroundYAt(tree.position.x, tree.position.z) + 0.05,
    });
    shadows.push(shadow);

    const runtime: TreeRuntime = {
      node: tree,
      shadow,
      obstacle,
      handle: null as unknown as TerrainTree,
      state: "standing",
      fallX: 0,
      fallZ: 1,
      tip: 0,
      sink: 0,
      phase: rand() * Math.PI * 2,
      baseY: tree.position.y,
    };

    const handle: TerrainTree = {
      x,
      z,
      radius,
      get standing() {
        return runtime.state === "standing";
      },
      ram: (fromX, fromZ) => beginFall(runtime, fromX, fromZ),
    };
    runtime.handle = handle;
    treeRuntimes.push(runtime);
    treeHandles.push(handle);
    animated.push({ node: tree, phase: runtime.phase, kind: "tree" });
  }

  for (let i = 0; i < 12; i++) {
    let x = 0;
    let z = 0;
    let attempts = 0;
    do {
      x = (rand() - 0.5) * size * 0.7;
      z = (rand() - 0.5) * size * 0.85;
      attempts++;
    } while ((Math.abs(x) < 1.8 || inBuildingBand(x, z, half)) && attempts < 40);

    const scale = 0.35 + rand() * 0.7;
    const rock = createRock(scene, `rock_${i}`, root, scale);
    rock.position.x = x;
    rock.position.z = z;
    rock.position.y = getGroundYAt(x, z);
    rock.rotation.y = rand() * Math.PI * 2;
    animated.push({ node: rock, phase: rand() * Math.PI * 2, kind: "rock" });
    const obs: Obstacle = { x, z, radius: 0.32 * scale + 0.12 };
    rockObstacles.push(obs);
    obstacles.push(obs);

    shadows.push(
      createBlobShadow(scene, `rock_${i}`, rock, {
        width: 1.0,
        depth: 0.85,
        opacity: 0.48,
        sizePerHeight: 0.05,
        getCasterHeight: () => 0.35,
        groundY: () => getGroundYAt(rock.position.x, rock.position.z) + 0.05,
      }),
    );
  }

  // Decorative only — never added to obstacles
  for (let i = 0; i < 50; i++) {
    let x = 0;
    let z = 0;
    let attempts = 0;
    do {
      x = (rand() - 0.5) * size * 0.9;
      z = (rand() - 0.5) * size * 0.9;
      attempts++;
    } while (inBuildingBand(x, z, half) && attempts < 40);

    const scale = 0.55 + rand() * 0.85;
    const tuft = createGrassTuft(scene, `grass_${i}`, root, scale);
    tuft.position.x = x;
    tuft.position.z = z;
    tuft.position.y = getGroundYAt(x, z);
    tuft.rotation.y = rand() * Math.PI * 2;
    animated.push({ node: tuft, phase: rand() * Math.PI * 2, kind: "grass" });
  }

  return {
    root,
    size,
    obstacles,
    rockObstacles,
    trees: treeHandles,
    sampleGroundY: getGroundYAt,
    getGroundYAt,
    getGroundYAtFootprint,
    ramTreesAt: (x, z, radius) => {
      for (const runtime of treeRuntimes) {
        if (runtime.state !== "standing") continue;
        const d = Math.hypot(runtime.node.position.x - x, runtime.node.position.z - z);
        if (d <= radius + runtime.obstacle.radius) {
          beginFall(runtime, x, z);
        }
      }
    },
    update: (dt, time) => {
      for (const prop of animated) {
        if (prop.kind === "grass") {
          const t = time + prop.phase;
          prop.node.rotation.z = Math.sin(t * 2.2) * 0.12;
          prop.node.rotation.x = Math.sin(t * 1.8 + 0.5) * 0.08;
        } else if (prop.kind === "rock") {
          const t = time + prop.phase;
          prop.node.position.y =
            getGroundYAt(prop.node.position.x, prop.node.position.z) +
            Math.sin(t * 0.3) * 0.004;
        }
      }

      for (const runtime of treeRuntimes) {
        const node = runtime.node;
        if (runtime.state === "standing") {
          const t = time + runtime.phase;
          node.rotation.z = Math.sin(t * 0.7) * 0.025;
          node.rotation.x = Math.sin(t * 0.55 + 1) * 0.018;
          runtime.shadow.update();
          continue;
        }

        if (runtime.state === "falling") {
          runtime.tip = Math.min(1, runtime.tip + dt / FALL_DURATION);
          const ease = 1 - (1 - runtime.tip) ** 2;
          const angle = ease * FALL_ANGLE;
          // Tip away from the tank: rotate around axis perpendicular to fall dir
          node.rotation.x = -runtime.fallZ * angle;
          node.rotation.z = runtime.fallX * angle;
          // Slight slide outward as it goes down
          node.position.x =
            runtime.obstacle.x + runtime.fallX * ease * 0.35;
          node.position.z =
            runtime.obstacle.z + runtime.fallZ * ease * 0.35;
          node.position.y = runtime.baseY;
          runtime.shadow.mesh.visibility = Math.max(
            0.08,
            0.42 * (1 - ease * 0.7),
          );
          runtime.shadow.update();
          if (runtime.tip >= 1) {
            runtime.state = "sinking";
            runtime.sink = 0;
          }
          continue;
        }

        if (runtime.state === "sinking") {
          runtime.sink = Math.min(1, runtime.sink + dt / SINK_DURATION);
          const s = runtime.sink;
          node.position.y = runtime.baseY - s * 1.6;
          node.position.x =
            runtime.obstacle.x + runtime.fallX * (0.35 + s * 0.1);
          node.position.z =
            runtime.obstacle.z + runtime.fallZ * (0.35 + s * 0.1);
          // Keep fully tipped
          node.rotation.x = -runtime.fallZ * FALL_ANGLE;
          node.rotation.z = runtime.fallX * FALL_ANGLE;
          runtime.shadow.mesh.visibility = Math.max(0, 0.12 * (1 - s));
          runtime.shadow.update();
          if (runtime.sink >= 1) {
            runtime.state = "gone";
            node.setEnabled(false);
            runtime.shadow.mesh.visibility = 0;
          }
        }
      }
    },
    dispose: () => {
      for (const shadow of shadows) shadow.dispose();
      root.dispose(false, true);
    },
  };
}
