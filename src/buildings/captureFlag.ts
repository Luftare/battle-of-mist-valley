import {
  Color3,
  MeshBuilder,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";
import { FLAG_CAPTURE_RADIUS } from "../game/stats";
import { TEAM_COLORS, type Team } from "../theme/colors";
import { box, colorMat, cylinder } from "../theme/materials";

export type FlagOwner = Team | null;

export interface CaptureFlagHandle {
  root: TransformNode;
  setOwner: (owner: FlagOwner) => void;
  update: (dt: number, time: number) => void;
  dispose: () => void;
}

const GRAY = "#8a8a82";

/**
 * Neutral hill-top flag + dotted capture ring.
 * Cloth tint follows the sole team holding the zone (gray if contested/empty).
 */
export function createCaptureFlag(
  scene: Scene,
  getGroundYAt: (x: number, z: number) => number,
): CaptureFlagHandle {
  const peakY = getGroundYAt(0, 0);
  const root = new TransformNode("captureFlag", scene);
  root.position.set(0, peakY, 0);

  const poleMat = colorMat(scene, "flag_pole", "#5a5048");
  const ballMat = colorMat(scene, "flag_ball", "#c8c0b0", { emissive: 0.15 });
  const clothMat = colorMat(scene, "flag_cloth", GRAY, { emissive: 0.12 });
  clothMat.backFaceCulling = false;

  cylinder(
    scene,
    "flag_pole",
    { height: 2.4, diameter: 0.08, tessellation: 6 },
    new Vector3(0, 1.2, 0),
    poleMat,
    root,
  );
  box(
    scene,
    "flag_base",
    { w: 0.35, h: 0.12, d: 0.35 },
    new Vector3(0, 0.06, 0),
    poleMat,
    root,
  );
  cylinder(
    scene,
    "flag_finial",
    { height: 0.12, diameter: 0.14, tessellation: 6 },
    new Vector3(0, 2.42, 0),
    ballMat,
    root,
  );

  const cloth = new TransformNode("flag_clothRoot", scene);
  cloth.parent = root;
  cloth.position.set(0.04, 2.05, 0);
  const clothMesh = box(
    scene,
    "flag_cloth",
    { w: 0.95, h: 0.55, d: 0.04 },
    new Vector3(0.48, -0.1, 0),
    clothMat,
    cloth,
  );

  // Dotted capture ring following the hillside
  const ringPoints: Vector3[] = [];
  const steps = 56;
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const x = Math.cos(a) * FLAG_CAPTURE_RADIUS;
    const z = Math.sin(a) * FLAG_CAPTURE_RADIUS;
    ringPoints.push(new Vector3(x, getGroundYAt(x, z) + 0.08, z));
  }
  const ring = MeshBuilder.CreateDashedLines(
    "flag_range",
    { points: ringPoints, dashSize: 0.5, gapSize: 0.38, dashNb: 80 },
    scene,
  );
  ring.color = new Color3(0.92, 0.9, 0.78);
  ring.isPickable = false;

  let owner: FlagOwner = null;
  const phase = Math.random() * Math.PI * 2;

  function paintCloth(next: FlagOwner): void {
    owner = next;
    const hex = next ? TEAM_COLORS[next].primary : GRAY;
    clothMat.diffuseColor = Color3.FromHexString(hex);
    clothMat.emissiveColor = Color3.FromHexString(hex).scale(next ? 0.22 : 0.1);
    ring.color = next
      ? Color3.FromHexString(TEAM_COLORS[next].secondary)
      : new Color3(0.92, 0.9, 0.78);
  }

  return {
    root,
    setOwner: (next) => {
      if (next === owner) return;
      paintCloth(next);
    },
    update: (_dt, time) => {
      const t = time + phase;
      cloth.rotation.y = Math.sin(t * 2.4) * 0.35;
      cloth.rotation.z = Math.sin(t * 1.7) * 0.08;
      clothMesh.scaling.x = 1 + Math.sin(t * 3.1) * 0.04;
    },
    dispose: () => {
      ring.dispose();
      root.dispose(false, true);
    },
  };
}
