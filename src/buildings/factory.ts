import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { TEAM_COLORS, WORLD_COLORS, type Team } from "../theme/colors";
import { box, colorMat, cylinder } from "../theme/materials";
import { createBlobShadow } from "../units/shadow";
import { withBuildingCombat } from "./combat";
import type { BuildingHandle } from "./types";

/**
 * Blocky industry / armory for tanks: smokestacks, spinning gear, conveyor crates.
 */
export function createFactory(
  scene: Scene,
  name: string,
  team: Team,
): BuildingHandle {
  const palette = TEAM_COLORS[team];
  const root = new TransformNode(`${name}_root`, scene);
  const phase = Math.random() * Math.PI * 2;

  const wallMat = colorMat(scene, `${name}_wall`, "#6a6a62");
  const roofMat = colorMat(scene, `${name}_roof`, "#3e3e3a");
  const trimMat = colorMat(scene, `${name}_trim`, palette.primary);
  const accentMat = colorMat(scene, `${name}_accent`, palette.secondary);
  const darkMat = colorMat(scene, `${name}_dark`, palette.dark);
  const metalMat = colorMat(scene, `${name}_metal`, WORLD_COLORS.metal);
  const metalDark = colorMat(scene, `${name}_metalDark`, WORLD_COLORS.metalDark);
  const rustMat = colorMat(scene, `${name}_rust`, "#7a5438");
  const windowMat = colorMat(scene, `${name}_window`, "#1e2830", {
    specular: 0.35,
  });
  const lampMat = colorMat(scene, `${name}_lamp`, palette.accent, {
    specular: 0,
    emissive: 0.55,
  });

  // Main workshop hall
  box(
    scene,
    `${name}_hall`,
    { w: 2.6, h: 1.55, d: 1.7 },
    new Vector3(0, 0.78, 0),
    wallMat,
    root,
  );
  box(
    scene,
    `${name}_roof`,
    { w: 2.75, h: 0.2, d: 1.85 },
    new Vector3(0, 1.65, 0),
    roofMat,
    root,
  );
  // Sawtooth roof ridge
  box(
    scene,
    `${name}_ridge`,
    { w: 2.4, h: 0.28, d: 0.35 },
    new Vector3(0, 1.85, -0.35),
    roofMat,
    root,
  );

  // Team chevron / stripe
  box(
    scene,
    `${name}_stripe`,
    { w: 2.62, h: 0.22, d: 0.06 },
    new Vector3(0, 1.25, 0.86),
    trimMat,
    root,
  );
  box(
    scene,
    `${name}_chevron`,
    { w: 0.45, h: 0.35, d: 0.07 },
    new Vector3(-0.85, 0.75, 0.87),
    accentMat,
    root,
  );
  box(
    scene,
    `${name}_badge`,
    { w: 0.28, h: 0.28, d: 0.07 },
    new Vector3(0.95, 0.85, 0.87),
    darkMat,
    root,
  );

  // Loading bay opening
  box(
    scene,
    `${name}_bay`,
    { w: 0.95, h: 0.85, d: 0.1 },
    new Vector3(0.15, 0.42, 0.88),
    metalDark,
    root,
  );
  // Row of factory windows
  for (let i = 0; i < 3; i++) {
    box(
      scene,
      `${name}_win_${i}`,
      { w: 0.28, h: 0.32, d: 0.05 },
      new Vector3(-1.0 + i * 0.38, 1.15, 0.88),
      windowMat,
      root,
    );
  }

  // Twin smokestacks
  const stackA = cylinder(
    scene,
    `${name}_stackA`,
    { height: 1.4, diameter: 0.32, tessellation: 8 },
    new Vector3(-0.7, 2.35, -0.35),
    rustMat,
    root,
  );
  const stackB = cylinder(
    scene,
    `${name}_stackB`,
    { height: 1.1, diameter: 0.26, tessellation: 8 },
    new Vector3(-0.25, 2.2, -0.45),
    rustMat,
    root,
  );
  void stackA;
  void stackB;
  box(
    scene,
    `${name}_stackCapA`,
    { w: 0.38, h: 0.1, d: 0.38 },
    new Vector3(-0.7, 3.05, -0.35),
    metalDark,
    root,
  );
  box(
    scene,
    `${name}_stackCapB`,
    { w: 0.32, h: 0.08, d: 0.32 },
    new Vector3(-0.25, 2.78, -0.45),
    metalDark,
    root,
  );

  const smokeMat = colorMat(scene, `${name}_smoke`, "#b0b0aa", {
    specular: 0,
    emissive: 0.12,
  });
  smokeMat.alpha = 0.4;
  smokeMat.transparencyMode = 2;
  const smokeGroups = [
    { x: -0.7, z: -0.35, y: 3.15, puffs: [] as ReturnType<typeof box>[] },
    { x: -0.25, z: -0.45, y: 2.9, puffs: [] as ReturnType<typeof box>[] },
  ];
  for (let g = 0; g < smokeGroups.length; g++) {
    const group = smokeGroups[g];
    const smokeRoot = new TransformNode(`${name}_smoke_${g}`, scene);
    smokeRoot.parent = root;
    smokeRoot.position = new Vector3(group.x, group.y, group.z);
    for (let i = 0; i < 3; i++) {
      group.puffs.push(
        box(
          scene,
          `${name}_smoke_${g}_${i}`,
          { w: 0.28, h: 0.22, d: 0.28 },
          new Vector3(0, i * 0.2, 0),
          smokeMat,
          smokeRoot,
        ),
      );
    }
  }

  // Spinning industrial gear on the side
  const gear = new TransformNode(`${name}_gear`, scene);
  gear.parent = root;
  gear.position = new Vector3(1.45, 0.85, 0);
  cylinder(
    scene,
    `${name}_gearHub`,
    { height: 0.18, diameter: 0.35, tessellation: 8 },
    new Vector3(0, 0, 0),
    metalMat,
    gear,
  );
  for (let i = 0; i < 6; i++) {
    const tooth = box(
      scene,
      `${name}_tooth_${i}`,
      { w: 0.16, h: 0.14, d: 0.55 },
      Vector3.Zero(),
      metalDark,
      gear,
    );
    tooth.rotation.z = (i / 6) * Math.PI;
  }

  // Side silo / tank
  cylinder(
    scene,
    `${name}_silo`,
    { height: 1.3, diameter: 0.7, tessellation: 8 },
    new Vector3(1.55, 0.65, -0.55),
    wallMat,
    root,
  );
  box(
    scene,
    `${name}_siloBand`,
    { w: 0.72, h: 0.12, d: 0.72 },
    new Vector3(1.55, 0.9, -0.55),
    trimMat,
    root,
  );
  box(
    scene,
    `${name}_siloTop`,
    { w: 0.55, h: 0.12, d: 0.55 },
    new Vector3(1.55, 1.35, -0.55),
    metalDark,
    root,
  );

  // Conveyor belt with moving crates
  const conveyor = new TransformNode(`${name}_conveyor`, scene);
  conveyor.parent = root;
  conveyor.position = new Vector3(0.1, 0.12, 1.35);
  box(
    scene,
    `${name}_belt`,
    { w: 1.6, h: 0.12, d: 0.45 },
    new Vector3(0, 0, 0),
    metalDark,
    conveyor,
  );
  box(
    scene,
    `${name}_beltRailL`,
    { w: 1.6, h: 0.08, d: 0.06 },
    new Vector3(0, 0.08, 0.22),
    metalMat,
    conveyor,
  );
  box(
    scene,
    `${name}_beltRailR`,
    { w: 1.6, h: 0.08, d: 0.06 },
    new Vector3(0, 0.08, -0.22),
    metalMat,
    conveyor,
  );

  const crates: TransformNode[] = [];
  for (let i = 0; i < 3; i++) {
    const crate = new TransformNode(`${name}_crate_${i}`, scene);
    crate.parent = conveyor;
    box(
      scene,
      `${name}_crateBox_${i}`,
      { w: 0.28, h: 0.22, d: 0.28 },
      new Vector3(0, 0.17, 0),
      rustMat,
      crate,
    );
    box(
      scene,
      `${name}_crateMark_${i}`,
      { w: 0.12, h: 0.08, d: 0.02 },
      new Vector3(0, 0.2, 0.15),
      trimMat,
      crate,
    );
    crates.push(crate);
  }

  // Blinking roof beacon
  box(
    scene,
    `${name}_beacon`,
    { w: 0.16, h: 0.16, d: 0.16 },
    new Vector3(0.9, 1.95, 0.4),
    lampMat,
    root,
  );

  const shadow = createBlobShadow(scene, name, root, {
    width: 3.0,
    depth: 2.4,
    opacity: 0.42,
    sizePerHeight: 0.02,
    getCasterHeight: () => 1.4,
    groundY: 0.04,
  });

  return withBuildingCombat({
    root,
    team,
    kind: "factory",
    spawns: "tank",
    updateAlive: (_dt, time) => {
      const t = time + phase;
      gear.rotation.z = t * 1.15;

      for (let i = 0; i < crates.length; i++) {
        const cycle = ((t * 0.35 + i / crates.length) % 1 + 1) % 1;
        crates[i].position.x = -0.65 + cycle * 1.3;
        crates[i].position.y = Math.sin(t * 8 + i) * 0.008;
      }

      for (let g = 0; g < smokeGroups.length; g++) {
        const puffs = smokeGroups[g].puffs;
        for (let i = 0; i < puffs.length; i++) {
          const cycle = ((t * 0.5 + g * 0.3 + i * 0.4) % 1.35) / 1.35;
          const puff = puffs[i];
          puff.position.y = cycle * 1.1;
          puff.position.x = Math.sin(t * 0.7 + i + g) * 0.12 * cycle;
          const s = 0.55 + cycle * 1.35;
          puff.scaling.set(s, s * 0.8, s);
          puff.setEnabled(cycle < 0.92);
        }
      }

      const blink = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 3.2));
      lampMat.emissiveColor.copyFrom(lampMat.diffuseColor.scale(blink));
      shadow.update();
    },
    disposeVisuals: () => {
      shadow.dispose();
      root.dispose(false, true);
    },
  });
}
