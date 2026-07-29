import {
  ArcRotateCamera,
  Color3,
  Color4,
  CreateScreenshotUsingRenderTargetAsync,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Scene,
  Vector3,
  type TransformNode,
} from "@babylonjs/core";
import { purgeMaterialCache } from "../theme/materials";
import {
  resolveThumbDefs,
  type ThumbDef,
  type ThumbHandle,
} from "./registry";
import type { ThumbMap } from "./types";

const THUMB_PREFIX = "thumb_";
const THUMB_SIZE = 192;

/**
 * Shared hero framing for menu icons:
 * - Low human POV (mild frog / look-up — not worm's-eye)
 * - Subject faces the viewer with a slight three-quarter yaw
 */
/**
 * Shared hero framing for menu icons:
 * - Low human POV (camera near ground, looking at mid-torso — soft frog on tall props)
 * - Subject faces the viewer with a slight three-quarter yaw
 */
export const THUMB_VIEW = {
  /**
   * Horizontal orbit angle for the camera on the XZ circle.
   * π/2 = from +X; the +0.42 offset gives a three-quarter front.
   */
  orbitYaw: Math.PI / 2 + 0.42,
  /**
   * Model yaw so local +Z points toward the camera’s orbit centerline (+X),
   * leaving the orbit offset to create the side angle.
   */
  faceYaw: Math.PI / 2,
  /** Distance multiplier from subject AABB diagonal. */
  radiusPad: 1.05,
  minRadius: 1.8,
  /** Camera height above the subject’s ground (low human). */
  cameraHeight: 0.48,
  /** Look-at height as a fraction of subject AABB height. */
  lookAtHeightFrac: 0.45,
  fov: 0.75,
} as const;

export type BakeThumbnailsOpts = {
  /** Subset of registry ids. Defaults to every registered subject. */
  ids?: string[];
  size?: number;
};

function hideShadows(root: TransformNode): void {
  for (const mesh of root.getChildMeshes(true)) {
    const n = mesh.name.toLowerCase();
    if (n.includes("shadow") || n.includes("blob")) {
      mesh.setEnabled(false);
    }
  }
}

function worldBounds(root: TransformNode): {
  min: Vector3;
  max: Vector3;
  center: Vector3;
  extent: Vector3;
} | null {
  root.computeWorldMatrix(true);
  const min = new Vector3(
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
    Number.POSITIVE_INFINITY,
  );
  const max = new Vector3(
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
  );
  let any = false;

  for (const mesh of root.getChildMeshes(true)) {
    if (!mesh.isEnabled()) continue;
    mesh.computeWorldMatrix(true);
    const bb = mesh.getBoundingInfo().boundingBox;
    min.minimizeInPlace(bb.minimumWorld);
    max.maximizeInPlace(bb.maximumWorld);
    any = true;
  }

  if (!any) return null;
  return {
    min,
    max,
    center: Vector3.Center(min, max),
    extent: max.subtract(min),
  };
}

function frameCamera(
  camera: ArcRotateCamera,
  root: TransformNode,
  def: ThumbDef,
): void {
  const bounds = worldBounds(root);
  const groundY = bounds?.min.y ?? 0;
  const height = Math.max(bounds?.extent.y ?? 1.2, 0.5);
  const width = Math.max(bounds?.extent.x ?? 1, bounds?.extent.z ?? 1, 0.5);
  const center = bounds?.center.clone() ?? new Vector3(0, 0.7, 0);

  const lookAt = new Vector3(
    center.x,
    groundY + height * THUMB_VIEW.lookAtHeightFrac,
    center.z,
  );

  // Stay low, but rise a little on tall props so we don’t sit under their eaves
  const camY = groundY + Math.min(0.9, Math.max(THUMB_VIEW.cameraHeight, height * 0.18));

  // Low angle needs more distance to fit full height in the vertical FOV
  const scale = def.frameScale ?? 1;
  const fitHeight =
    ((Math.abs(lookAt.y - camY) + height * 0.8) / Math.tan(THUMB_VIEW.fov * 0.4)) * scale;
  const fitWidth = width * 1.75 * scale;
  const fitDiag = (bounds?.extent.length() ?? 2) * THUMB_VIEW.radiusPad * scale;
  const dist = Math.max(
    (def.frameRadius ?? 0) * scale,
    fitHeight,
    fitWidth,
    fitDiag,
    THUMB_VIEW.minRadius,
  );

  const yaw = THUMB_VIEW.orbitYaw;
  camera.position.set(
    lookAt.x + dist * Math.sin(yaw),
    camY,
    lookAt.z + dist * Math.cos(yaw),
  );
  camera.setTarget(lookAt);
  camera.fov = THUMB_VIEW.fov;
  camera.rebuildAnglesAndRadius();
  camera.lowerRadiusLimit = camera.radius;
  camera.upperRadiusLimit = camera.radius;
}

function yieldFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

function poseSubject(subject: ThumbHandle, def: ThumbDef): void {
  subject.root.position.set(0, 0, 0);
  subject.root.rotation.y = THUMB_VIEW.faceYaw + (def.yawOffset ?? 0);
  hideShadows(subject.root);
  const prep = def.prepare?.(subject);
  if (prep !== false) {
    subject.update?.(0, 0);
  }
}

/**
 * Dedicated single-scene bake (no live game). Returns PNG data-URLs keyed by id.
 *
 * Add models in `registry.ts`, then:
 *   npm run bake-thumbs
 *   npm run bake-thumbs -- rifleman tank   # subset
 */
export async function bakeThumbnails(
  opts: BakeThumbnailsOpts = {},
): Promise<ThumbMap> {
  const defs = resolveThumbDefs(opts.ids);
  const size = opts.size ?? THUMB_SIZE;

  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  canvas.style.cssText =
    "position:fixed;inset:0;width:100%;height:100%;background:#000";
  document.body.appendChild(canvas);

  const engine = new Engine(canvas, true, {
    preserveDrawingBuffer: true,
    stencil: false,
    alpha: true,
    adaptToDeviceRatio: false,
  });

  const scene = new Scene(engine);
  scene.autoClear = true;
  scene.clearColor = new Color4(0, 0, 0, 0);
  scene.ambientColor = new Color3(0.4, 0.42, 0.38);
  scene.fogMode = Scene.FOGMODE_NONE;

  const camera = new ArcRotateCamera(
    "thumbCam",
    THUMB_VIEW.orbitYaw,
    Math.PI / 2,
    6,
    new Vector3(0, 0.7, 0),
    scene,
  );
  camera.minZ = 0.05;
  camera.maxZ = 80;
  camera.fov = THUMB_VIEW.fov;
  scene.activeCamera = camera;

  const hemi = new HemisphericLight("thumbHemi", new Vector3(0.15, 0.6, 0.35), scene);
  hemi.intensity = 0.7;
  hemi.groundColor = new Color3(0.32, 0.34, 0.28);
  hemi.diffuse = new Color3(0.95, 0.95, 0.9);

  // Key light from above-front so low POV still has readable form
  const sun = new DirectionalLight(
    "thumbSun",
    new Vector3(-0.35, -0.55, -0.55),
    scene,
  );
  sun.position = new Vector3(6, 10, 10);
  sun.intensity = 1.05;
  sun.diffuse = new Color3(1, 0.97, 0.9);

  let baking = true;
  engine.runRenderLoop(() => {
    if (baking) scene.render();
  });

  const thumbs: ThumbMap = {};

  try {
    for (let i = 0; i < 8; i++) await yieldFrame();

    for (const def of defs) {
      const name = `${THUMB_PREFIX}${def.id}`;
      const subject = def.create(scene, name);
      poseSubject(subject, def);
      frameCamera(camera, subject.root, def);

      await yieldFrame();
      await yieldFrame();

      thumbs[def.id as keyof ThumbMap] = await CreateScreenshotUsingRenderTargetAsync(
        engine,
        camera,
        { width: size, height: size },
        "image/png",
        1,
        false,
      );

      subject.dispose();
      for (const mesh of [...scene.meshes]) {
        if (mesh.name.startsWith(THUMB_PREFIX)) mesh.dispose(false, true);
      }
      await yieldFrame();
    }
  } finally {
    baking = false;
    engine.stopRenderLoop();
    scene.dispose();
    engine.dispose();
    canvas.remove();
    purgeMaterialCache(THUMB_PREFIX);
  }

  return thumbs;
}
