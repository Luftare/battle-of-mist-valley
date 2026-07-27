import { Mesh, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { TEAM_COLORS, WORLD_COLORS, type Team } from "../theme/colors";
import { box, colorMat } from "../theme/materials";

export interface PlatformHandle {
  root: TransformNode;
  /** Pickable pad mesh used for click selection. */
  pickMesh: Mesh;
  team: Team;
  slotIndex: number;
  setHighlight: (on: boolean) => void;
  update: (dt: number, time: number) => void;
  dispose: () => void;
}

/**
 * Empty build site — packed earth, gravel outline, team corner stakes.
 * Looks like groundwork already poured for a future building.
 */
export function createPlatform(
  scene: Scene,
  name: string,
  team: Team,
  slotIndex: number,
): PlatformHandle {
  const palette = TEAM_COLORS[team];
  const root = new TransformNode(`${name}_root`, scene);
  const phase = Math.random() * Math.PI * 2;

  const dirtMat = colorMat(scene, `${name}_dirt`, WORLD_COLORS.dirt);
  const gravelMat = colorMat(scene, `${name}_gravel`, "#7a6a52");
  const edgeMat = colorMat(scene, `${name}_edge`, "#5a4a38");
  const stakeMat = colorMat(scene, `${name}_stake`, WORLD_COLORS.bark);
  const flagMat = colorMat(scene, `${name}_flag`, palette.primary);
  const accentMat = colorMat(scene, `${name}_accent`, palette.secondary);
  const highlightMat = colorMat(scene, `${name}_hi`, palette.secondary, {
    specular: 0,
    emissive: 0.35,
  });

  // Packed earth pad (pickable)
  const pad = box(
    scene,
    `${name}_pad`,
    { w: 2.6, h: 0.1, d: 2.4 },
    new Vector3(0, 0.05, 0),
    dirtMat,
    root,
  );
  pad.isPickable = true;

  // Gravel / foundation ring
  box(
    scene,
    `${name}_ring`,
    { w: 2.75, h: 0.06, d: 2.55 },
    new Vector3(0, 0.02, 0),
    gravelMat,
    root,
  );
  // Inner trench lines (groundwork)
  box(
    scene,
    `${name}_trenchA`,
    { w: 2.2, h: 0.04, d: 0.12 },
    new Vector3(0, 0.1, 0.55),
    edgeMat,
    root,
  );
  box(
    scene,
    `${name}_trenchB`,
    { w: 2.2, h: 0.04, d: 0.12 },
    new Vector3(0, 0.1, -0.55),
    edgeMat,
    root,
  );
  box(
    scene,
    `${name}_trenchC`,
    { w: 0.12, h: 0.04, d: 1.5 },
    new Vector3(0.7, 0.1, 0),
    edgeMat,
    root,
  );

  // Corner stakes with team ribbons
  const corners: [number, number][] = [
    [-1.15, -1.05],
    [1.15, -1.05],
    [-1.15, 1.05],
    [1.15, 1.05],
  ];
  const ribbons: TransformNode[] = [];
  for (let i = 0; i < corners.length; i++) {
    const [cx, cz] = corners[i];
    const stake = new TransformNode(`${name}_stake_${i}`, scene);
    stake.parent = root;
    stake.position.set(cx, 0, cz);
    box(
      scene,
      `${name}_post_${i}`,
      { w: 0.08, h: 0.55, d: 0.08 },
      new Vector3(0, 0.28, 0),
      stakeMat,
      stake,
    );
    const ribbon = new TransformNode(`${name}_ribbon_${i}`, scene);
    ribbon.parent = stake;
    ribbon.position.set(0.06, 0.42, 0);
    box(
      scene,
      `${name}_ribbonBox_${i}`,
      { w: 0.22, h: 0.1, d: 0.04 },
      new Vector3(0.1, 0, 0),
      i % 2 === 0 ? flagMat : accentMat,
      ribbon,
    );
    ribbons.push(ribbon);
  }

  // Soft highlight rim (toggled on hover / select)
  const hi = box(
    scene,
    `${name}_highlight`,
    { w: 2.85, h: 0.03, d: 2.65 },
    new Vector3(0, 0.12, 0),
    highlightMat,
    root,
  );
  hi.isPickable = false;
  hi.setEnabled(false);

  return {
    root,
    pickMesh: pad,
    team,
    slotIndex,
    setHighlight: (on) => {
      hi.setEnabled(on);
    },
    update: (_dt, time) => {
      const t = time + phase;
      for (let i = 0; i < ribbons.length; i++) {
        ribbons[i].rotation.y = Math.sin(t * 2.2 + i * 0.8) * 0.35;
        ribbons[i].rotation.z = Math.sin(t * 1.6 + i) * 0.12;
      }
    },
    dispose: () => {
      root.dispose(false, true);
    },
  };
}
