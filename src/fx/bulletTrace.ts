import {
  Color3,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

export interface BulletTraceOptions {
  /** World units per second. */
  speed?: number;
  /** Streak length along travel. */
  length?: number;
  thickness?: number;
  color?: string;
}

/**
 * Fast tracer streak from muzzle to impact. Self-running — disposes on arrival.
 */
export function spawnBulletTrace(
  scene: Scene,
  from: Vector3,
  to: Vector3,
  opts?: BulletTraceOptions,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const dist = Math.hypot(dx, dy, dz);
  if (dist < 0.15) return;

  const speed = opts?.speed ?? 55;
  const length = opts?.length ?? Math.min(1.6, 0.45 + dist * 0.14);
  const thickness = opts?.thickness ?? 0.07;
  const color = opts?.color ?? "#fff6c8";

  const dirX = dx / dist;
  const dirY = dy / dist;
  const dirZ = dz / dist;

  const root = new TransformNode(`fx_trace_${Math.random().toString(36).slice(2, 8)}`, scene);
  root.position.copyFrom(from);

  const tint = Color3.FromHexString(color);
  const mat = new StandardMaterial(`${root.name}_mat`, scene);
  mat.diffuseColor = tint;
  mat.emissiveColor = tint;
  mat.ambientColor = tint;
  mat.specularColor = Color3.Black();
  mat.disableLighting = true;
  mat.alpha = 1;

  const streak = MeshBuilder.CreateBox(
    `${root.name}_streak`,
    { width: thickness, height: thickness, depth: length },
    scene,
  );
  streak.material = mat;
  streak.parent = root;
  streak.position.z = length * 0.5;
  streak.isPickable = false;

  // Face travel direction (Babylon: local +Z forward)
  root.rotation.y = Math.atan2(dirX, dirZ);
  root.rotation.x = -Math.atan2(dirY, Math.hypot(dirX, dirZ));

  let traveled = 0;
  const travelDist = dist + length * 0.35;

  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
    const step = speed * dt;
    traveled += step;
    root.position.addInPlaceFromFloats(dirX * step, dirY * step, dirZ * step);

    // Stretch slightly as it flies, then fade near the end
    const t = Math.min(1, traveled / travelDist);
    const fade = t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3;
    streak.visibility = Math.max(0, fade);
    streak.scaling.z = 0.85 + Math.random() * 0.25;

    if (traveled >= travelDist) {
      scene.onBeforeRenderObservable.remove(observer);
      mat.dispose();
      root.dispose(false, true);
    }
  });
}
