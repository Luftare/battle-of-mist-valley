import {
  Color3,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { WORLD_COLORS } from "../theme/colors";
import { box, colorMat, cylinder } from "../theme/materials";
import { createBlobShadow, type BlobShadowHandle } from "../units/shadow";

export interface TerrainHandle {
  root: TransformNode;
  update: (dt: number, time: number) => void;
  dispose: () => void;
}

interface AnimatedProp {
  node: TransformNode;
  phase: number;
  kind: "tree" | "grass" | "rock";
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

  // Blocky canopy layers
  box(scene, `${name}_canopy1`, { w: 1.4, h: 0.7, d: 1.4 }, new Vector3(0, 1.4, 0), foliage, tree);
  box(scene, `${name}_canopy2`, { w: 1.0, h: 0.6, d: 1.0 }, new Vector3(0, 1.95, 0), foliageLight, tree);
  box(scene, `${name}_canopy3`, { w: 0.55, h: 0.45, d: 0.55 }, new Vector3(0, 2.35, 0), foliage, tree);

  // Small bark nub
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

function sampleGroundY(x: number, z: number): number {
  return (
    Math.sin(x * 0.25) * Math.cos(z * 0.2) * 0.35 +
    Math.sin(x * 0.55 + 1.2) * Math.sin(z * 0.4) * 0.15
  );
}

/**
 * Meadow terrain: undulating grass ground, scattered trees, rocks, and grass tufts.
 * Idle motion: canopy sway, grass rustle, subtle rock settling.
 */
export function createTerrain(scene: Scene, size = 36): TerrainHandle {
  const root = new TransformNode("terrain", scene);
  const animated: AnimatedProp[] = [];
  const shadows: BlobShadowHandle[] = [];
  const rand = seededRandom(42);

  // Ground plane with slight vertex noise via multiple overlapping patches for blocky feel
  const groundMat = new StandardMaterial("groundMat", scene);
  groundMat.diffuseColor = Color3.FromHexString(WORLD_COLORS.grass);
  groundMat.specularColor = new Color3(0.05, 0.08, 0.04);

  const ground = MeshBuilder.CreateGround(
    "ground",
    { width: size, height: size, subdivisions: 24 },
    scene,
  );
  ground.material = groundMat;
  ground.parent = root;
  ground.receiveShadows = true;

  // Gently warp ground vertices for soft hills
  const positions = ground.getVerticesData("position");
  if (positions) {
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const z = positions[i + 2];
      positions[i + 1] = sampleGroundY(x, z);
    }
    ground.updateVerticesData("position", positions);
    ground.createNormals(true);
  }

  // Dirt patches (blocky darker areas)
  const dirtMat = colorMat(scene, "dirt", WORLD_COLORS.dirt);
  for (let i = 0; i < 8; i++) {
    const patch = MeshBuilder.CreateGround(
      `dirt_${i}`,
      { width: 2 + rand() * 2.5, height: 1.5 + rand() * 2 },
      scene,
    );
    patch.material = dirtMat;
    patch.parent = root;
    patch.position.x = (rand() - 0.5) * size * 0.85;
    patch.position.z = (rand() - 0.5) * size * 0.85;
    patch.position.y = 0.02;
    patch.rotation.y = rand() * Math.PI;
  }

  // Trees — keep lab staging corridor clear for units + buildings
  const treeCount = 18;
  const inStagingLane = (x: number, z: number) =>
    Math.abs(x) < 9.5 && Math.abs(z) < 6.5;
  for (let i = 0; i < treeCount; i++) {
    let x = 0;
    let z = 0;
    let attempts = 0;
    do {
      x = (rand() - 0.5) * size * 0.9;
      z = (rand() - 0.5) * size * 0.9;
      attempts++;
    } while ((Math.hypot(x, z) < 9 || inStagingLane(x, z)) && attempts < 30);

    const scale = 0.7 + rand() * 0.7;
    const tree = createTree(scene, `tree_${i}`, root, scale);
    tree.position.x = x;
    tree.position.z = z;
    tree.position.y = sampleGroundY(x, z);
    tree.rotation.y = rand() * Math.PI * 2;
    animated.push({ node: tree, phase: rand() * Math.PI * 2, kind: "tree" });

    shadows.push(
      createBlobShadow(scene, `tree_${i}`, tree, {
        width: 1.35,
        depth: 1.35,
        opacity: 0.42,
        sizePerHeight: 0.04,
        getCasterHeight: () => 1.5,
        groundY: () => sampleGroundY(tree.position.x, tree.position.z) + 0.05,
      }),
    );
  }

  // Rocks
  for (let i = 0; i < 14; i++) {
    let x = 0;
    let z = 0;
    let attempts = 0;
    do {
      x = (rand() - 0.5) * size * 0.88;
      z = (rand() - 0.5) * size * 0.88;
      attempts++;
    } while ((Math.hypot(x, z) < 8 || inStagingLane(x, z)) && attempts < 30);

    const scale = 0.4 + rand() * 0.8;
    const rock = createRock(scene, `rock_${i}`, root, scale);
    rock.position.x = x;
    rock.position.z = z;
    rock.position.y = sampleGroundY(x, z);
    rock.rotation.y = rand() * Math.PI * 2;
    animated.push({ node: rock, phase: rand() * Math.PI * 2, kind: "rock" });

    shadows.push(
      createBlobShadow(scene, `rock_${i}`, rock, {
        width: 1.0,
        depth: 0.85,
        opacity: 0.48,
        sizePerHeight: 0.05,
        getCasterHeight: () => 0.35,
        groundY: () => sampleGroundY(rock.position.x, rock.position.z) + 0.05,
      }),
    );
  }

  // Grass tufts (more dense near viewing area)
  for (let i = 0; i < 60; i++) {
    const x = (rand() - 0.5) * size * 0.92;
    const z = (rand() - 0.5) * size * 0.92;
    const scale = 0.6 + rand() * 0.9;
    const tuft = createGrassTuft(scene, `grass_${i}`, root, scale);
    tuft.position.x = x;
    tuft.position.z = z;
    tuft.position.y = sampleGroundY(x, z);
    tuft.rotation.y = rand() * Math.PI * 2;
    animated.push({ node: tuft, phase: rand() * Math.PI * 2, kind: "grass" });
  }

  return {
    root,
    update: (_dt, time) => {
      for (const prop of animated) {
        const t = time + prop.phase;
        if (prop.kind === "tree") {
          prop.node.rotation.z = Math.sin(t * 0.7) * 0.025;
          prop.node.rotation.x = Math.sin(t * 0.55 + 1) * 0.018;
        } else if (prop.kind === "grass") {
          prop.node.rotation.z = Math.sin(t * 2.2) * 0.12;
          prop.node.rotation.x = Math.sin(t * 1.8 + 0.5) * 0.08;
        } else if (prop.kind === "rock") {
          prop.node.position.y =
            sampleGroundY(prop.node.position.x, prop.node.position.z) +
            Math.sin(t * 0.3) * 0.004;
        }
      }
      for (const shadow of shadows) shadow.update();
    },
    dispose: () => {
      for (const shadow of shadows) shadow.dispose();
      root.dispose(false, true);
    },
  };
}
