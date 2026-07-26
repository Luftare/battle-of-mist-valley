import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { TEAM_COLORS, WORLD_COLORS, type Team } from "../theme/colors";
import { box, colorMat, cylinder } from "../theme/materials";
import { createBlobShadow } from "../units/shadow";
import type { BuildingHandle } from "./types";

/**
 * Blocky barracks next to riflemen: door, windows, team banner, waving flag.
 */
export function createBarracks(
  scene: Scene,
  name: string,
  team: Team,
): BuildingHandle {
  const palette = TEAM_COLORS[team];
  const root = new TransformNode(`${name}_root`, scene);
  const phase = Math.random() * Math.PI * 2;

  const wallMat = colorMat(scene, `${name}_wall`, "#8a7a5c");
  const roofMat = colorMat(scene, `${name}_roof`, "#5a4a38");
  const trimMat = colorMat(scene, `${name}_trim`, palette.primary);
  const accentMat = colorMat(scene, `${name}_accent`, palette.secondary);
  const darkMat = colorMat(scene, `${name}_dark`, palette.dark);
  const woodMat = colorMat(scene, `${name}_wood`, WORLD_COLORS.bark);
  const metalMat = colorMat(scene, `${name}_metal`, WORLD_COLORS.metal);
  const windowMat = colorMat(scene, `${name}_window`, "#2a3540", {
    specular: 0.4,
  });

  // Main hall
  box(
    scene,
    `${name}_body`,
    { w: 2.2, h: 1.35, d: 1.55 },
    new Vector3(0, 0.68, 0),
    wallMat,
    root,
  );
  box(
    scene,
    `${name}_roof`,
    { w: 2.45, h: 0.22, d: 1.75 },
    new Vector3(0, 1.45, 0),
    roofMat,
    root,
  );
  // Team stripe along the long wall
  box(
    scene,
    `${name}_stripe`,
    { w: 2.22, h: 0.18, d: 0.06 },
    new Vector3(0, 1.05, 0.78),
    trimMat,
    root,
  );
  box(
    scene,
    `${name}_stripeAccent`,
    { w: 0.55, h: 0.18, d: 0.07 },
    new Vector3(0.7, 1.05, 0.79),
    accentMat,
    root,
  );

  // Door + windows facing forward (+Z)
  box(
    scene,
    `${name}_door`,
    { w: 0.42, h: 0.72, d: 0.08 },
    new Vector3(-0.45, 0.36, 0.8),
    woodMat,
    root,
  );
  box(
    scene,
    `${name}_doorKnob`,
    { w: 0.06, h: 0.06, d: 0.06 },
    new Vector3(-0.28, 0.36, 0.86),
    metalMat,
    root,
  );
  box(
    scene,
    `${name}_winL`,
    { w: 0.32, h: 0.28, d: 0.06 },
    new Vector3(0.35, 0.85, 0.8),
    windowMat,
    root,
  );
  box(
    scene,
    `${name}_winR`,
    { w: 0.32, h: 0.28, d: 0.06 },
    new Vector3(0.85, 0.85, 0.8),
    windowMat,
    root,
  );

  // Side annex
  box(
    scene,
    `${name}_annex`,
    { w: 0.85, h: 0.95, d: 0.9 },
    new Vector3(-1.35, 0.48, -0.15),
    wallMat,
    root,
  );
  box(
    scene,
    `${name}_annexRoof`,
    { w: 0.95, h: 0.14, d: 1.0 },
    new Vector3(-1.35, 1.02, -0.15),
    roofMat,
    root,
  );
  box(
    scene,
    `${name}_annexMark`,
    { w: 0.2, h: 0.35, d: 0.06 },
    new Vector3(-1.35, 0.7, 0.32),
    trimMat,
    root,
  );

  // Chimney
  box(
    scene,
    `${name}_chimney`,
    { w: 0.28, h: 0.55, d: 0.28 },
    new Vector3(0.7, 1.75, -0.35),
    wallMat,
    root,
  );

  // Soft smoke puffs rising from chimney
  const smokeRoot = new TransformNode(`${name}_smoke`, scene);
  smokeRoot.parent = root;
  smokeRoot.position = new Vector3(0.7, 2.05, -0.35);
  const smokeMat = colorMat(scene, `${name}_smoke`, "#c8c8c4", {
    specular: 0,
    emissive: 0.15,
  });
  smokeMat.alpha = 0.45;
  smokeMat.transparencyMode = 2;
  const smokePuffs = [0, 1, 2].map((i) => {
    const puff = box(
      scene,
      `${name}_puff_${i}`,
      { w: 0.22, h: 0.18, d: 0.22 },
      new Vector3(0, i * 0.25, 0),
      smokeMat,
      smokeRoot,
    );
    return puff;
  });

  // Flagpole + multi-segment waving flag
  const pole = cylinder(
    scene,
    `${name}_pole`,
    { height: 2.4, diameter: 0.07, tessellation: 6 },
    new Vector3(1.35, 1.2, 0.55),
    metalMat,
    root,
  );
  void pole;

  const flagPivot = new TransformNode(`${name}_flagPivot`, scene);
  flagPivot.parent = root;
  flagPivot.position = new Vector3(1.35, 2.15, 0.55);

  const flagSegs: TransformNode[] = [];
  for (let i = 0; i < 3; i++) {
    const seg = new TransformNode(`${name}_flagSeg_${i}`, scene);
    seg.parent = i === 0 ? flagPivot : flagSegs[i - 1];
    seg.position = new Vector3(0, 0, i === 0 ? 0 : 0.32);
    const mat = i === 1 ? accentMat : trimMat;
    box(
      scene,
      `${name}_flagCloth_${i}`,
      { w: 0.04, h: 0.42 - i * 0.04, d: 0.34 },
      new Vector3(0, -0.12, 0.16),
      mat,
      seg,
    );
    if (i === 0) {
      box(
        scene,
        `${name}_flagEmblem`,
        { w: 0.05, h: 0.14, d: 0.14 },
        new Vector3(0.02, -0.1, 0.16),
        darkMat,
        seg,
      );
    }
    flagSegs.push(seg);
  }

  // Antenna on roof
  const antenna = new TransformNode(`${name}_antenna`, scene);
  antenna.parent = root;
  antenna.position = new Vector3(-0.6, 1.56, -0.4);
  cylinder(
    scene,
    `${name}_antennaPole`,
    { height: 0.7, diameter: 0.04, tessellation: 5 },
    new Vector3(0, 0.35, 0),
    metalMat,
    antenna,
  );
  box(
    scene,
    `${name}_antennaTip`,
    { w: 0.1, h: 0.06, d: 0.1 },
    new Vector3(0, 0.72, 0),
    accentMat,
    antenna,
  );

  // Outdoor crates
  box(
    scene,
    `${name}_crateA`,
    { w: 0.35, h: 0.28, d: 0.35 },
    new Vector3(0.95, 0.14, 1.15),
    woodMat,
    root,
  );
  box(
    scene,
    `${name}_crateB`,
    { w: 0.28, h: 0.22, d: 0.28 },
    new Vector3(1.25, 0.11, 1.05),
    woodMat,
    root,
  );
  box(
    scene,
    `${name}_crateMark`,
    { w: 0.12, h: 0.08, d: 0.02 },
    new Vector3(0.95, 0.2, 1.34),
    trimMat,
    root,
  );

  const shadow = createBlobShadow(scene, name, root, {
    width: 2.6,
    depth: 2.0,
    opacity: 0.4,
    sizePerHeight: 0.02,
    getCasterHeight: () => 1.2,
    groundY: 0.04,
  });

  return {
    root,
    team,
    kind: "barracks",
    update: (_dt, time) => {
      const t = time + phase;
      // Gentle multi-segment flag wave
      for (let i = 0; i < flagSegs.length; i++) {
        const amp = 0.18 + i * 0.12;
        flagSegs[i].rotation.y = Math.sin(t * 2.4 + i * 0.9) * amp;
        flagSegs[i].rotation.x = Math.sin(t * 1.7 + i * 0.6) * 0.06;
      }
      antenna.rotation.z = Math.sin(t * 1.1) * 0.04;
      antenna.rotation.x = Math.sin(t * 0.9 + 1) * 0.03;

      // Rising, drifting smoke puffs
      for (let i = 0; i < smokePuffs.length; i++) {
        const cycle = ((t * 0.55 + i * 0.45) % 1.2) / 1.2;
        const puff = smokePuffs[i];
        puff.position.y = cycle * 0.85;
        puff.position.x = Math.sin(t * 0.8 + i) * 0.08 * cycle;
        const s = 0.6 + cycle * 1.1;
        puff.scaling.set(s, s * 0.85, s);
        puff.setEnabled(cycle < 0.95);
      }
      shadow.update();
    },
    dispose: () => {
      shadow.dispose();
      root.dispose(false, true);
    },
  };
}
