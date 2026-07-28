import { Mesh, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { TEAM_COLORS, WORLD_COLORS, type Team } from "../theme/colors";
import { box, colorMat, cylinder } from "../theme/materials";
import { createBlobShadow } from "../units/shadow";
import { withBuildingCombat } from "./combat";
import type { BuildingHandle } from "./types";

export interface ResearchLabHandle extends BuildingHandle {
  kind: "researchLab";
  /** Drive dish spin / glow intensity while a project is running. */
  setResearching: (active: boolean, progress01?: number) => void;
}

/**
 * Research lab: dome observatory, spinning dish, glowing tubes.
 * Does not spawn units — unlocks team-wide upgrades.
 */
export function createResearchLab(
  scene: Scene,
  name: string,
  team: Team,
): ResearchLabHandle {
  const palette = TEAM_COLORS[team];
  const root = new TransformNode(`${name}_root`, scene);
  const phase = Math.random() * Math.PI * 2;

  const wallMat = colorMat(scene, `${name}_wall`, "#6a7080");
  const roofMat = colorMat(scene, `${name}_roof`, "#3a4050");
  const trimMat = colorMat(scene, `${name}_trim`, palette.primary);
  const accentMat = colorMat(scene, `${name}_accent`, palette.secondary);
  const darkMat = colorMat(scene, `${name}_dark`, palette.dark);
  const metalMat = colorMat(scene, `${name}_metal`, WORLD_COLORS.metal);
  const metalDark = colorMat(scene, `${name}_metalDark`, WORLD_COLORS.metalDark);
  const glassMat = colorMat(scene, `${name}_glass`, "#4a90c8", {
    specular: 0.7,
    emissive: 0.12,
  });
  const glowMat = colorMat(scene, `${name}_glow`, "#7ec8ff", {
    specular: 0,
    emissive: 0.55,
  });
  const tubeMat = colorMat(scene, `${name}_tube`, "#a8e06a", {
    specular: 0.3,
    emissive: 0.35,
  });
  const sparkMat = colorMat(scene, `${name}_spark`, "#fff0a0", {
    specular: 0,
    emissive: 1,
  });

  // Concrete pad
  box(
    scene,
    `${name}_pad`,
    { w: 2.4, h: 0.1, d: 2.2 },
    new Vector3(0, 0.05, 0),
    colorMat(scene, `${name}_padMat`, "#5a5a58"),
    root,
  );

  // Main lab block
  box(
    scene,
    `${name}_body`,
    { w: 1.7, h: 1.05, d: 1.45 },
    new Vector3(-0.15, 0.58, -0.1),
    wallMat,
    root,
  );
  box(
    scene,
    `${name}_stripe`,
    { w: 1.72, h: 0.14, d: 0.06 },
    new Vector3(-0.15, 0.85, 0.65),
    trimMat,
    root,
  );
  box(
    scene,
    `${name}_door`,
    { w: 0.36, h: 0.58, d: 0.06 },
    new Vector3(-0.55, 0.34, 0.65),
    darkMat,
    root,
  );

  // Glowing lab windows
  const windowL = box(
    scene,
    `${name}_winL`,
    { w: 0.32, h: 0.28, d: 0.05 },
    new Vector3(0.25, 0.72, 0.66),
    glassMat,
    root,
  ) as Mesh;
  const windowR = box(
    scene,
    `${name}_winR`,
    { w: 0.28, h: 0.22, d: 0.05 },
    new Vector3(0.7, 0.7, 0.66),
    glassMat,
    root,
  ) as Mesh;

  // Dome observatory
  const dome = cylinder(
    scene,
    `${name}_dome`,
    { height: 0.55, diameter: 1.15, tessellation: 10 },
    new Vector3(-0.15, 1.35, -0.15),
    roofMat,
    root,
  );
  dome.scaling.y = 0.55;
  box(
    scene,
    `${name}_domeCap`,
    { w: 0.55, h: 0.12, d: 0.55 },
    new Vector3(-0.15, 1.62, -0.15),
    metalDark,
    root,
  );

  // Rotating satellite dish
  const dishPivot = new TransformNode(`${name}_dishPivot`, scene);
  dishPivot.parent = root;
  dishPivot.position.set(0.85, 1.55, 0.55);

  cylinder(
    scene,
    `${name}_mast`,
    { height: 0.85, diameter: 0.08, tessellation: 6 },
    new Vector3(0, -0.35, 0),
    metalMat,
    dishPivot,
  );
  const dish = cylinder(
    scene,
    `${name}_dish`,
    { height: 0.08, diameter: 0.85, tessellation: 12 },
    new Vector3(0, 0.05, 0),
    metalMat,
    dishPivot,
  );
  dish.rotation.x = -0.55;
  box(
    scene,
    `${name}_feed`,
    { w: 0.08, h: 0.08, d: 0.28 },
    new Vector3(0, 0.18, 0.22),
    accentMat,
    dishPivot,
  );
  const dishGlow = box(
    scene,
    `${name}_dishGlow`,
    { w: 0.55, h: 0.04, d: 0.55 },
    new Vector3(0, 0.08, 0),
    glowMat,
    dishPivot,
  ) as Mesh;
  dishGlow.rotation.x = -0.55;
  dishGlow.visibility = 0.35;

  // Chemical tubes rack
  const tubeNodes: Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const tube = cylinder(
      scene,
      `${name}_tube_${i}`,
      { height: 0.42 + i * 0.08, diameter: 0.12, tessellation: 6 },
      new Vector3(0.55 + i * 0.22, 0.35 + i * 0.04, -0.75),
      tubeMat,
      root,
    ) as Mesh;
    tubeNodes.push(tube);
    box(
      scene,
      `${name}_tubeCap_${i}`,
      { w: 0.14, h: 0.05, d: 0.14 },
      new Vector3(0.55 + i * 0.22, 0.55 + i * 0.08, -0.75),
      metalDark,
      root,
    );
  }

  // Antenna spark tip
  const spark = box(
    scene,
    `${name}_spark`,
    { w: 0.1, h: 0.1, d: 0.1 },
    new Vector3(-0.15, 1.85, -0.15),
    sparkMat,
    root,
  ) as Mesh;
  spark.visibility = 0;

  const shadow = createBlobShadow(scene, name, root, {
    width: 1.3,
    depth: 1.15,
    opacity: 0.4,
    sizePerHeight: 0.02,
    getCasterHeight: () => 1.2,
    groundY: 0.04,
  });

  let researching = false;
  let progress = 0;
  let dishSpin = Math.random() * Math.PI * 2;

  const handle = withBuildingCombat({
    root,
    team,
    kind: "researchLab",
    spawns: null,
    updateAlive: (_dt, time) => {
      const t = time + phase;
      const intensity = researching ? 0.55 + progress * 0.45 : 0.2;
      const spinRate = researching ? 1.8 + progress * 2.2 : 0.55;
      dishSpin += _dt * spinRate;
      dishPivot.rotation.y = dishSpin;
      dishPivot.rotation.z = Math.sin(t * 0.8) * 0.06;

      // Windows pulse while researching
      const pulse = researching
        ? 0.55 + Math.sin(t * 8) * 0.35 * (0.4 + progress)
        : 0.35 + Math.sin(t * 1.2) * 0.08;
      windowL.visibility = pulse;
      windowR.visibility = pulse * 0.9;

      dishGlow.visibility = 0.2 + intensity * 0.65;
      dishGlow.scaling.setAll(0.9 + Math.sin(t * 6) * 0.08 * intensity);

      for (let i = 0; i < tubeNodes.length; i++) {
        const bob = Math.sin(t * 2.4 + i * 1.1) * 0.015;
        tubeNodes[i].position.y = 0.35 + i * 0.04 + bob;
        tubeNodes[i].scaling.y = 1 + (researching ? Math.sin(t * 5 + i) * 0.06 * progress : 0);
      }

      if (researching) {
        spark.visibility = Math.max(0, Math.sin(t * 14) * 0.9);
        spark.scaling.setAll(0.7 + Math.random() * 0.8);
      } else {
        spark.visibility = Math.max(0, Math.sin(t * 3) * 0.15);
      }

      shadow.update();
    },
    disposeVisuals: () => {
      shadow.dispose();
      root.dispose(false, true);
    },
  }) as ResearchLabHandle;

  handle.setResearching = (active, progress01 = 0) => {
    researching = active;
    progress = Math.min(1, Math.max(0, progress01));
  };

  return handle;
}
