import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { TEAM_COLORS, WORLD_COLORS, type Team } from "../theme/colors";
import { box, colorMat, cylinder } from "../theme/materials";
import { createBlobShadow } from "../units/shadow";
import { withBuildingCombat } from "./combat";
import type { BuildingHandle } from "./types";

/**
 * Supply depot: crate stacks, loading ramp, and a small office hut.
 * Spawns soft logistics trucks that mint coins while alive.
 */
export function createDepot(
  scene: Scene,
  name: string,
  team: Team,
): BuildingHandle {
  const palette = TEAM_COLORS[team];
  const root = new TransformNode(`${name}_root`, scene);
  const phase = Math.random() * Math.PI * 2;

  const wallMat = colorMat(scene, `${name}_wall`, "#7a6e52");
  const roofMat = colorMat(scene, `${name}_roof`, "#4a4030");
  const crateMat = colorMat(scene, `${name}_crate`, "#8a7048");
  const crateDark = colorMat(scene, `${name}_crateDark`, "#5a4830");
  const trimMat = colorMat(scene, `${name}_trim`, palette.primary);
  const accentMat = colorMat(scene, `${name}_accent`, palette.secondary);
  const darkMat = colorMat(scene, `${name}_dark`, palette.dark);
  const metalMat = colorMat(scene, `${name}_metal`, WORLD_COLORS.metal);
  const dirtMat = colorMat(scene, `${name}_dirt`, WORLD_COLORS.dirt);
  const woodMat = colorMat(scene, `${name}_wood`, WORLD_COLORS.bark);

  // Yard pad
  box(
    scene,
    `${name}_pad`,
    { w: 2.5, h: 0.1, d: 2.2 },
    new Vector3(0, 0.05, 0),
    dirtMat,
    root,
  );

  // Office hut
  box(
    scene,
    `${name}_hut`,
    { w: 1.1, h: 1.05, d: 0.95 },
    new Vector3(-0.75, 0.58, -0.35),
    wallMat,
    root,
  );
  box(
    scene,
    `${name}_hutRoof`,
    { w: 1.25, h: 0.14, d: 1.1 },
    new Vector3(-0.75, 1.18, -0.35),
    roofMat,
    root,
  );
  box(
    scene,
    `${name}_hutStripe`,
    { w: 1.12, h: 0.14, d: 0.06 },
    new Vector3(-0.75, 0.85, 0.15),
    trimMat,
    root,
  );
  box(
    scene,
    `${name}_door`,
    { w: 0.32, h: 0.55, d: 0.06 },
    new Vector3(-0.75, 0.32, 0.15),
    woodMat,
    root,
  );
  box(
    scene,
    `${name}_window`,
    { w: 0.28, h: 0.22, d: 0.05 },
    new Vector3(-0.4, 0.75, 0.15),
    darkMat,
    root,
  );

  // Loading ramp
  box(
    scene,
    `${name}_ramp`,
    { w: 0.9, h: 0.18, d: 1.1 },
    new Vector3(0.7, 0.2, 0.35),
    metalMat,
    root,
  );
  box(
    scene,
    `${name}_rampLip`,
    { w: 0.95, h: 0.08, d: 0.12 },
    new Vector3(0.7, 0.12, 0.95),
    darkMat,
    root,
  );

  // Crate stacks
  const crateNodes: TransformNode[] = [];
  const crateLayout: [number, number, number, number][] = [
    [0.55, 0.28, -0.55, 0],
    [0.95, 0.28, -0.55, 0.2],
    [0.75, 0.62, -0.55, -0.1],
    [0.2, 0.28, -0.7, 0.15],
  ];
  for (let i = 0; i < crateLayout.length; i++) {
    const [x, y, z, rot] = crateLayout[i];
    const crate = new TransformNode(`${name}_crate_${i}`, scene);
    crate.parent = root;
    crate.position.set(x, y, z);
    crate.rotation.y = rot;
    box(
      scene,
      `${name}_crateBox_${i}`,
      { w: 0.42, h: 0.38, d: 0.42 },
      Vector3.Zero(),
      i % 2 === 0 ? crateMat : crateDark,
      crate,
    );
    box(
      scene,
      `${name}_crateBand_${i}`,
      { w: 0.44, h: 0.06, d: 0.44 },
      new Vector3(0, 0.05, 0),
      accentMat,
      crate,
    );
    crateNodes.push(crate);
  }

  // Coin / supply marker pole
  const pole = cylinder(
    scene,
    `${name}_pole`,
    { height: 1.15, diameter: 0.08, tessellation: 6 },
    new Vector3(1.05, 0.65, 0.85),
    metalMat,
    root,
  );
  const coinSign = box(
    scene,
    `${name}_coinSign`,
    { w: 0.35, h: 0.35, d: 0.06 },
    new Vector3(1.05, 1.25, 0.85),
    accentMat,
    root,
  );
  box(
    scene,
    `${name}_coinMark`,
    { w: 0.18, h: 0.18, d: 0.07 },
    new Vector3(1.05, 1.25, 0.9),
    colorMat(scene, `${name}_gold`, "#d4a84b", { emissive: 0.25 }),
    root,
  );

  const shadow = createBlobShadow(scene, name, root, {
    width: 1.35,
    depth: 1.15,
    opacity: 0.38,
    sizePerHeight: 0.02,
    getCasterHeight: () => 1.0,
    groundY: 0.04,
  });

  return withBuildingCombat({
    root,
    team,
    kind: "depot",
    spawns: "supplyTruck",
    updateAlive: (_dt, time) => {
      const t = time + phase;
      for (let i = 0; i < crateNodes.length; i++) {
        crateNodes[i].position.y =
          crateLayout[i][1] + Math.sin(t * 1.2 + i * 0.7) * 0.012;
      }
      coinSign.rotation.y = Math.sin(t * 1.4) * 0.15;
      pole.rotation.z = Math.sin(t * 0.9) * 0.02;
      shadow.update();
    },
    disposeVisuals: () => {
      shadow.dispose();
      root.dispose(false, true);
    },
  });
}
