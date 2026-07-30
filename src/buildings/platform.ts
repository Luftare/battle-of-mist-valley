import { Color3, Scene, TransformNode, Vector3, type Mesh } from "@babylonjs/core";
import { TEAM_COLORS, WORLD_COLORS, type Team } from "../theme/colors";
import { box, colorMat } from "../theme/materials";

const FLOOR_W = 2.75;
const FLOOR_D = 2.55;

const FLOOR_H = 0.1;

export interface PlatformHandle {
  root: TransformNode;
  pickMesh: Mesh;
  team: Team;
  slotIndex: number;
  setHighlight: (on: boolean) => void;
  /** Show/hide the dirt pad + stakes (hidden while a building occupies the slot). */
  setSiteVisible: (visible: boolean) => void;
  /** Soft pad glow to draw the eye (build intro). */
  setAttention: (on: boolean) => void;
  update: (dt: number, time: number) => void;
  dispose: () => void;
}

/**
 * Build site: brown floor slab + gravel rim + corner stakes.
 * Floor is a thick box on an unscaled base node so it always renders on top of grass.
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
  const accentHex = palette.secondary;
  const accentColor = Color3.FromHexString(accentHex);

  // Floor / rim never scaled — only stakes spin for team facing
  const base = new TransformNode(`${name}_base`, scene);
  base.parent = root;

  const facing = new TransformNode(`${name}_facing`, scene);
  facing.parent = root;
  facing.rotation.y = team === "red" ? Math.PI : 0;

  const floorMat = colorMat(scene, "platform_floor", WORLD_COLORS.dirt);
  floorMat.backFaceCulling = false;
  const gravelMat = colorMat(scene, "platform_gravel", "#7a6a52");
  const edgeMat = colorMat(scene, "platform_edge", "#5a4a38");
  const stakeMat = colorMat(scene, "platform_stake", WORLD_COLORS.bark);
  const flagMat = colorMat(scene, `${name}_flag`, palette.primary);
  const accentMat = colorMat(scene, `${name}_accent`, accentHex);
  const highlightMat = colorMat(scene, `${name}_hi`, accentHex, {
    specular: 0,
    emissive: 0.35,
  });
  highlightMat.transparencyMode = 2; // ALPHA_BLEND
  highlightMat.alpha = 0.72;

  const floor = box(
    scene,
    `${name}_floor`,
    { w: FLOOR_W, h: FLOOR_H, d: FLOOR_D },
    new Vector3(0, FLOOR_H * 0.5, 0),
    floorMat,
    base,
  );
  floor.isPickable = true;
  floor.receiveShadows = true;

  const pickMesh = floor;

  const rimY = FLOOR_H + 0.03;
  box(
    scene,
    `${name}_rimN`,
    { w: FLOOR_W, h: 0.06, d: 0.14 },
    new Vector3(0, rimY, FLOOR_D * 0.5 - 0.05),
    gravelMat,
    base,
  );
  box(
    scene,
    `${name}_rimS`,
    { w: FLOOR_W, h: 0.06, d: 0.14 },
    new Vector3(0, rimY, -FLOOR_D * 0.5 + 0.05),
    gravelMat,
    base,
  );
  box(
    scene,
    `${name}_rimE`,
    { w: 0.14, h: 0.06, d: FLOOR_D },
    new Vector3(FLOOR_W * 0.5 - 0.05, rimY, 0),
    gravelMat,
    base,
  );
  box(
    scene,
    `${name}_rimW`,
    { w: 0.14, h: 0.06, d: FLOOR_D },
    new Vector3(-FLOOR_W * 0.5 + 0.05, rimY, 0),
    gravelMat,
    base,
  );

  box(
    scene,
    `${name}_trenchA`,
    { w: 2.2, h: 0.04, d: 0.12 },
    new Vector3(0, rimY + 0.02, 0.55),
    edgeMat,
    base,
  );
  box(
    scene,
    `${name}_trenchB`,
    { w: 2.2, h: 0.04, d: 0.12 },
    new Vector3(0, rimY + 0.02, -0.55),
    edgeMat,
    base,
  );
  box(
    scene,
    `${name}_trenchC`,
    { w: 0.12, h: 0.04, d: 1.5 },
    new Vector3(0.7, rimY + 0.02, 0),
    edgeMat,
    base,
  );

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
    stake.parent = facing;
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

  const hi = box(
    scene,
    `${name}_highlight`,
    { w: FLOOR_W + 0.1, h: 0.03, d: FLOOR_D + 0.1 },
    new Vector3(0, rimY + 0.04, 0),
    highlightMat,
    base,
  );
  hi.isPickable = false;
  hi.setEnabled(false);

  let attention = false;
  let highlightForced = false;

  function applyHighlightVisibility(): void {
    hi.setEnabled(highlightForced || attention);
    if (!attention) {
      highlightMat.emissiveColor = accentColor.scale(0.35);
      highlightMat.alpha = 0.72;
      hi.visibility = 1;
    }
  }

  return {
    root,
    pickMesh,
    team,
    slotIndex,
    setHighlight: (on) => {
      highlightForced = on;
      applyHighlightVisibility();
    },
    setSiteVisible: (visible) => {
      base.setEnabled(visible);
      facing.setEnabled(visible);
      if (!visible) {
        attention = false;
        hi.setEnabled(false);
      } else {
        applyHighlightVisibility();
      }
    },
    setAttention: (on) => {
      attention = on;
      applyHighlightVisibility();
    },
    update: (_dt, time) => {
      if (!facing.isEnabled()) return;
      const t = time + phase;
      for (let i = 0; i < ribbons.length; i++) {
        ribbons[i].rotation.y = Math.sin(t * 2.2 + i * 0.8) * 0.35;
        ribbons[i].rotation.z = Math.sin(t * 1.6 + i) * 0.12;
      }
      if (attention) {
        // Slow tactical pulse — designate pads without bouncing geometry
        const pulse = 0.5 + 0.5 * Math.sin(t * 1.55 + slotIndex * 0.35);
        highlightMat.emissiveColor = accentColor.scale(0.22 + pulse * 0.42);
        highlightMat.alpha = 0.45 + pulse * 0.4;
        hi.visibility = 0.75 + pulse * 0.25;
      }
    },
    dispose: () => {
      root.dispose(false, true);
    },
  };
}
