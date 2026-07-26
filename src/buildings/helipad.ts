import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { TEAM_COLORS, WORLD_COLORS, type Team } from "../theme/colors";
import { box, colorMat, cylinder } from "../theme/materials";
import { createBlobShadow } from "../units/shadow";
import { withBuildingCombat } from "./combat";
import type { BuildingHandle } from "./types";

/**
 * Blocky helicopter landing pad: marked pad, control hut, windsock, rotating beacon.
 */
export function createHelipad(
  scene: Scene,
  name: string,
  team: Team,
): BuildingHandle {
  const palette = TEAM_COLORS[team];
  const root = new TransformNode(`${name}_root`, scene);
  const phase = Math.random() * Math.PI * 2;

  const padMat = colorMat(scene, `${name}_pad`, "#5a5a54");
  const padDark = colorMat(scene, `${name}_padDark`, "#3a3a36");
  const trimMat = colorMat(scene, `${name}_trim`, palette.primary);
  const accentMat = colorMat(scene, `${name}_accent`, palette.secondary);
  const darkMat = colorMat(scene, `${name}_dark`, palette.dark);
  const wallMat = colorMat(scene, `${name}_wall`, "#7a7258");
  const roofMat = colorMat(scene, `${name}_roof`, "#4a4438");
  const metalMat = colorMat(scene, `${name}_metal`, WORLD_COLORS.metal);
  const metalDark = colorMat(scene, `${name}_metalDark`, WORLD_COLORS.metalDark);
  const beaconMat = colorMat(scene, `${name}_beacon`, "#f0e080", {
    specular: 0,
    emissive: 0.85,
  });

  // Raised pad platform
  box(
    scene,
    `${name}_pad`,
    { w: 2.4, h: 0.12, d: 2.4 },
    new Vector3(0, 0.06, 0),
    padMat,
    root,
  );
  box(
    scene,
    `${name}_padRing`,
    { w: 2.15, h: 0.04, d: 2.15 },
    new Vector3(0, 0.13, 0),
    padDark,
    root,
  );
  // Team-colored outer ring
  box(
    scene,
    `${name}_ringN`,
    { w: 1.6, h: 0.05, d: 0.12 },
    new Vector3(0, 0.14, 1.05),
    trimMat,
    root,
  );
  box(
    scene,
    `${name}_ringS`,
    { w: 1.6, h: 0.05, d: 0.12 },
    new Vector3(0, 0.14, -1.05),
    trimMat,
    root,
  );
  box(
    scene,
    `${name}_ringE`,
    { w: 0.12, h: 0.05, d: 1.6 },
    new Vector3(1.05, 0.14, 0),
    trimMat,
    root,
  );
  box(
    scene,
    `${name}_ringW`,
    { w: 0.12, h: 0.05, d: 1.6 },
    new Vector3(-1.05, 0.14, 0),
    trimMat,
    root,
  );

  // H marking
  box(
    scene,
    `${name}_hLeft`,
    { w: 0.18, h: 0.06, d: 0.85 },
    new Vector3(-0.28, 0.15, 0),
    accentMat,
    root,
  );
  box(
    scene,
    `${name}_hRight`,
    { w: 0.18, h: 0.06, d: 0.85 },
    new Vector3(0.28, 0.15, 0),
    accentMat,
    root,
  );
  box(
    scene,
    `${name}_hBar`,
    { w: 0.56, h: 0.06, d: 0.18 },
    new Vector3(0, 0.15, 0),
    accentMat,
    root,
  );

  // Perimeter landing lights (unique mats for chase-pulse)
  const lightPositions = [
    [1.05, 1.05],
    [-1.05, 1.05],
    [1.05, -1.05],
    [-1.05, -1.05],
    [0, 1.15],
    [0, -1.15],
    [1.15, 0],
    [-1.15, 0],
  ] as const;
  const padLightMats = lightPositions.map((_, i) =>
    colorMat(scene, `${name}_light_${i}`, palette.accent, {
      specular: 0,
      emissive: 0.7,
    }),
  );
  for (let i = 0; i < lightPositions.length; i++) {
    const [lx, lz] = lightPositions[i];
    box(
      scene,
      `${name}_padLight_${i}`,
      { w: 0.12, h: 0.08, d: 0.12 },
      new Vector3(lx, 0.18, lz),
      padLightMats[i],
      root,
    );
  }

  // Small control hut
  box(
    scene,
    `${name}_hut`,
    { w: 0.95, h: 0.85, d: 0.8 },
    new Vector3(-1.55, 0.42, -1.35),
    wallMat,
    root,
  );
  box(
    scene,
    `${name}_hutRoof`,
    { w: 1.1, h: 0.14, d: 0.95 },
    new Vector3(-1.55, 0.92, -1.35),
    roofMat,
    root,
  );
  box(
    scene,
    `${name}_hutDoor`,
    { w: 0.28, h: 0.48, d: 0.06 },
    new Vector3(-1.55, 0.24, -0.94),
    darkMat,
    root,
  );
  box(
    scene,
    `${name}_hutWindow`,
    { w: 0.28, h: 0.22, d: 0.05 },
    new Vector3(-1.2, 0.55, -1.35),
    metalDark,
    root,
  );
  box(
    scene,
    `${name}_hutStripe`,
    { w: 0.97, h: 0.12, d: 0.05 },
    new Vector3(-1.55, 0.7, -0.94),
    trimMat,
    root,
  );

  // Beacon tower
  const tower = new TransformNode(`${name}_tower`, scene);
  tower.parent = root;
  tower.position = new Vector3(1.45, 0, -1.4);
  cylinder(
    scene,
    `${name}_towerPole`,
    { height: 1.6, diameter: 0.12, tessellation: 6 },
    new Vector3(0, 0.8, 0),
    metalMat,
    tower,
  );
  box(
    scene,
    `${name}_towerBase`,
    { w: 0.35, h: 0.2, d: 0.35 },
    new Vector3(0, 0.1, 0),
    metalDark,
    tower,
  );
  box(
    scene,
    `${name}_towerBand`,
    { w: 0.18, h: 0.14, d: 0.18 },
    new Vector3(0, 1.15, 0),
    trimMat,
    tower,
  );

  const beaconArm = new TransformNode(`${name}_beaconArm`, scene);
  beaconArm.parent = tower;
  beaconArm.position = new Vector3(0, 1.65, 0);
  box(
    scene,
    `${name}_beaconHousing`,
    { w: 0.22, h: 0.16, d: 0.22 },
    new Vector3(0, 0, 0),
    metalDark,
    beaconArm,
  );
  box(
    scene,
    `${name}_beaconLight`,
    { w: 0.14, h: 0.12, d: 0.28 },
    new Vector3(0, 0.02, 0.12),
    beaconMat,
    beaconArm,
  );

  // Windsock (pole + cloth segments)
  cylinder(
    scene,
    `${name}_sockPole`,
    { height: 1.35, diameter: 0.06, tessellation: 5 },
    new Vector3(-1.55, 0.95, -0.7),
    metalMat,
    root,
  );

  const sockPivot = new TransformNode(`${name}_sockPivot`, scene);
  sockPivot.parent = root;
  sockPivot.position = new Vector3(-1.55, 1.55, -0.7);

  const sockSegs: TransformNode[] = [];
  for (let i = 0; i < 3; i++) {
    const seg = new TransformNode(`${name}_sockSeg_${i}`, scene);
    seg.parent = i === 0 ? sockPivot : sockSegs[i - 1];
    seg.position = new Vector3(0, 0, i === 0 ? 0 : 0.28 - i * 0.02);
    const mat = i % 2 === 0 ? trimMat : accentMat;
    const w = 0.22 - i * 0.04;
    box(
      scene,
      `${name}_sockCloth_${i}`,
      { w, h: w * 0.7, d: 0.3 - i * 0.04 },
      new Vector3(0, 0, 0.14),
      mat,
      seg,
    );
    sockSegs.push(seg);
  }

  // Fuel drums with team mark
  box(
    scene,
    `${name}_drumA`,
    { w: 0.28, h: 0.4, d: 0.28 },
    new Vector3(1.55, 0.2, 1.15),
    metalMat,
    root,
  );
  box(
    scene,
    `${name}_drumB`,
    { w: 0.28, h: 0.4, d: 0.28 },
    new Vector3(1.2, 0.2, 1.25),
    metalDark,
    root,
  );
  box(
    scene,
    `${name}_drumMark`,
    { w: 0.3, h: 0.1, d: 0.02 },
    new Vector3(1.55, 0.28, 1.3),
    trimMat,
    root,
  );

  const shadow = createBlobShadow(scene, name, root, {
    width: 2.8,
    depth: 2.8,
    opacity: 0.38,
    sizePerHeight: 0.015,
    getCasterHeight: () => 0.6,
    groundY: 0.03,
  });

  return withBuildingCombat({
    root,
    team,
    kind: "helipad",
    spawns: "helicopter",
    updateAlive: (_dt, time) => {
      const t = time + phase;

      beaconArm.rotation.y = t * 2.8;
      const pulse = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 6));
      beaconMat.emissiveColor.copyFrom(beaconMat.diffuseColor.scale(pulse));

      for (let i = 0; i < padLightMats.length; i++) {
        const glow =
          0.25 +
          0.75 *
            Math.max(
              0,
              Math.sin(t * 2.5 - i * ((Math.PI * 2) / padLightMats.length)),
            );
        const mat = padLightMats[i];
        mat.emissiveColor.copyFrom(mat.diffuseColor.scale(glow));
      }

      sockPivot.rotation.y = Math.sin(t * 0.6) * 0.35 + 0.4;
      for (let i = 0; i < sockSegs.length; i++) {
        sockSegs[i].rotation.x = Math.sin(t * 2.8 + i * 0.8) * (0.15 + i * 0.08);
        sockSegs[i].rotation.y = Math.sin(t * 2.2 + i * 0.7) * (0.12 + i * 0.1);
      }

      shadow.update();
    },
    disposeVisuals: () => {
      shadow.dispose();
      root.dispose(false, true);
    },
  });
}
