import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

/** Matches lab sun direction so blob shadows lean the same way. */
const LIGHT_DIR = new Vector3(-0.45, -0.85, -0.3).normalize();

export interface BlobShadowHandle {
  mesh: Mesh;
  update: () => void;
  dispose: () => void;
}

export interface BlobShadowOptions {
  /** Base ellipse size on the ground (X = width, Z = depth/length). */
  width: number;
  depth: number;
  /**
   * Local Y used as the caster height.
   * If omitted, shadow sits under the root with almost no cast offset.
   */
  getCasterHeight?: () => number;
  /** Opacity at ground level (0–1). */
  opacity?: number;
  /**
   * How size changes with caster height.
   * Negative = shrink when higher (good for flying units).
   */
  sizePerHeight?: number;
  /** Extra Y lift above y=0 to reduce z-fighting with the ground. */
  groundY?: number | (() => number);
  /** Yaw in radians; defaults to follow.rotation.y. */
  getYaw?: () => number;
}

let shadowMat: StandardMaterial | null = null;

function getShadowMaterial(scene: Scene): StandardMaterial {
  if (shadowMat) return shadowMat;
  shadowMat = new StandardMaterial("blobShadow", scene);
  shadowMat.diffuseColor = new Color3(0.05, 0.07, 0.04);
  shadowMat.emissiveColor = new Color3(0, 0, 0);
  shadowMat.specularColor = new Color3(0, 0, 0);
  shadowMat.alpha = 0.35;
  shadowMat.transparencyMode = 2; // ALPHA_BLEND
  shadowMat.backFaceCulling = false;
  shadowMat.disableLighting = true;
  shadowMat.zOffset = 2;
  return shadowMat;
}

/**
 * Flat elliptical ground blob. Approximate cast offset from height + sun dir.
 */
export function createBlobShadow(
  scene: Scene,
  name: string,
  follow: TransformNode,
  opts: BlobShadowOptions,
): BlobShadowHandle {
  const mat = getShadowMaterial(scene);
  const mesh = MeshBuilder.CreateGround(
    `${name}_shadow`,
    { width: opts.width, height: opts.depth, subdivisions: 1 },
    scene,
  );
  mesh.material = mat;
  mesh.isPickable = false;
  mesh.receiveShadows = false;

  const baseOpacity = opts.opacity ?? 0.4;
  const sizePerHeight = opts.sizePerHeight ?? 0.08;
  const getHeight = opts.getCasterHeight;

  const update = () => {
    const scale = follow.scaling.x;
    const world = follow.getAbsolutePosition();
    const casterH = getHeight ? getHeight() * scale : 0.15 * scale;

    const t = casterH / Math.max(0.001, -LIGHT_DIR.y);
    mesh.position.x = world.x + LIGHT_DIR.x * t;
    mesh.position.z = world.z + LIGHT_DIR.z * t;
    const gy = opts.groundY;
    mesh.position.y =
      typeof gy === "function" ? gy() : typeof gy === "number" ? gy : 0.04;

    const altitudeFade = 1 / (1 + casterH * 0.35);
    const sizeScale = Math.max(0.25, 1 + casterH * sizePerHeight);
    mesh.scaling.x = scale * sizeScale;
    mesh.scaling.z = scale * sizeScale;
    mesh.scaling.y = 1;
    mesh.visibility = Math.min(1, baseOpacity * altitudeFade * 1.4);
    mesh.rotation.y = opts.getYaw ? opts.getYaw() : follow.rotation.y;
  };

  update();

  return {
    mesh,
    update,
    dispose: () => mesh.dispose(),
  };
}

/** @deprecated Prefer createBlobShadow — kept for unit call sites. */
export const createUnitShadow = createBlobShadow;
export type UnitShadowHandle = BlobShadowHandle;
export type UnitShadowOptions = BlobShadowOptions;
