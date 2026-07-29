import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

const HP_FILL = "#3dff4a";
const FILL_HALF_W = 0.34;

export interface HpBarHandle {
  root: TransformNode;
  setRatio: (ratio: number) => void;
  setVisible: (visible: boolean) => void;
  update: (worldPos: Vector3, height: number, cameraPos: Vector3) => void;
  dispose: () => void;
}

let backMat: StandardMaterial | null = null;
let fillMat: StandardMaterial | null = null;

function getHpBarMaterials(scene: Scene): {
  back: StandardMaterial;
  fill: StandardMaterial;
} {
  if (!backMat) {
    backMat = new StandardMaterial("hpBarBack", scene);
    backMat.diffuseColor = new Color3(0.08, 0.1, 0.08);
    backMat.emissiveColor = new Color3(0.05, 0.06, 0.05);
    backMat.specularColor = Color3.Black();
    backMat.disableLighting = true;
  }
  if (!fillMat) {
    const tint = Color3.FromHexString(HP_FILL);
    fillMat = new StandardMaterial("hpBarFill", scene);
    fillMat.diffuseColor = tint;
    fillMat.emissiveColor = tint.scale(0.75);
    fillMat.specularColor = Color3.Black();
    fillMat.disableLighting = true;
  }
  return { back: backMat, fill: fillMat };
}

/**
 * World-space HP bar that billboards toward the player camera.
 * Fill is bright green for every team and depletes from the right
 * (remaining health stays on the left).
 */
export function createHpBar(scene: Scene, name: string): HpBarHandle {
  const root = new TransformNode(`${name}_hp`, scene);
  const { back: backMaterial, fill: fillMaterial } = getHpBarMaterials(scene);

  const back = MeshBuilder.CreateBox(
    `${name}_hpBackMesh`,
    { width: 0.72, height: 0.08, depth: 0.04 },
    scene,
  );
  back.material = backMaterial;
  back.parent = root;
  back.isPickable = false;

  const fill = MeshBuilder.CreateBox(
    `${name}_hpFillMesh`,
    { width: FILL_HALF_W * 2, height: 0.055, depth: 0.05 },
    scene,
  ) as Mesh;
  fill.material = fillMaterial;
  fill.parent = root;
  fill.position.z = 0.01;
  fill.isPickable = false;

  let ratio = 1;

  return {
    root,
    setRatio: (r) => {
      ratio = Math.max(0, Math.min(1, r));
      fill.scaling.x = Math.max(0.001, ratio);
      // Keep the left edge fixed so the bar empties toward the left
      // (from the camera, local +X reads as screen-left after billboarding).
      fill.position.x = FILL_HALF_W * (1 - ratio);
      fill.setEnabled(ratio > 0.001);
    },
    setVisible: (visible) => {
      root.setEnabled(visible);
    },
    update: (worldPos, height, cameraPos) => {
      root.position.set(worldPos.x, worldPos.y + height, worldPos.z);
      const dx = cameraPos.x - root.position.x;
      const dy = cameraPos.y - root.position.y;
      const dz = cameraPos.z - root.position.z;
      root.rotation.y = Math.atan2(dx, dz);
      // Tip the bar to face the camera so it stays readable from top-down
      root.rotation.x = -Math.atan2(dy, Math.hypot(dx, dz));
      root.rotation.z = 0;
    },
    dispose: () => {
      root.dispose(false, false);
    },
  };
}
