import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { WORLD_COLORS } from "../theme/colors";
import { box, colorMat } from "../theme/materials";

export interface MissileOptions {
  /** Horizontal distance at which the missile begins diving at the target. */
  diveRange?: number;
  /** Distance at which the missile is considered to have hit. */
  hitRange?: number;
  /** World-space cruise altitude (helicopter height). */
  cruiseY: number;
  speed: number;
}

export interface MissileHandle {
  root: TransformNode;
  /** Advance chase/dive. Returns false once the missile should be removed. */
  update: (dt: number) => boolean;
  dispose: () => void;
}

/**
 * Guided missile: cruises at launch altitude toward the target, then dives in close.
 */
export function createMissile(
  scene: Scene,
  name: string,
  origin: Vector3,
  getTargetPos: () => Vector3 | null,
  opts: MissileOptions,
): MissileHandle {
  const diveRange = opts.diveRange ?? 2.2;
  const hitRange = opts.hitRange ?? 0.45;
  const speed = opts.speed;

  const bodyMat = colorMat(scene, `${name}_body`, WORLD_COLORS.metalDark);
  const tipMat = colorMat(scene, `${name}_tip`, "#8a4030");
  const finMat = colorMat(scene, `${name}_fin`, WORLD_COLORS.metal);
  const exhaustMat = colorMat(scene, `${name}_exhaust`, "#ffb060", {
    specular: 0,
    emissive: 0.9,
  });

  const root = new TransformNode(`${name}_root`, scene);
  root.position.copyFrom(origin);

  box(scene, `${name}_body`, { w: 0.1, h: 0.1, d: 0.42 }, new Vector3(0, 0, 0), bodyMat, root);
  box(scene, `${name}_nose`, { w: 0.08, h: 0.08, d: 0.12 }, new Vector3(0, 0, 0.24), tipMat, root);
  box(scene, `${name}_finV`, { w: 0.04, h: 0.16, d: 0.1 }, new Vector3(0, 0, -0.14), finMat, root);
  box(scene, `${name}_finH`, { w: 0.16, h: 0.04, d: 0.1 }, new Vector3(0, 0, -0.14), finMat, root);

  const exhaust = box(
    scene,
    `${name}_flame`,
    { w: 0.07, h: 0.07, d: 0.18 },
    new Vector3(0, 0, -0.28),
    exhaustMat,
    root,
  );

  const vel = new Vector3(0, 0, 1);
  const tmp = new Vector3();
  const desired = new Vector3();
  let alive = true;
  let age = 0;

  // Seed an initial forward from origin toward target XZ (or +Z if unknown)
  const first = getTargetPos();
  if (first) {
    tmp.set(first.x - origin.x, 0, first.z - origin.z);
    if (tmp.lengthSquared() > 1e-6) tmp.normalizeToRef(vel);
  }

  return {
    root,
    update: (dt) => {
      if (!alive) return false;
      age += dt;

      const target = getTargetPos();
      if (!target) {
        // Keep flying last heading briefly, then drop
        root.position.addInPlaceFromFloats(vel.x * speed * dt, -2 * dt, vel.z * speed * dt);
        if (age > 6 || root.position.y < 0.1) {
          alive = false;
          return false;
        }
        faceVelocity(root, vel);
        flickerExhaust(exhaust, age);
        return true;
      }

      const dx = target.x - root.position.x;
      const dz = target.z - root.position.z;
      const horiz = Math.hypot(dx, dz);
      const diving = horiz < diveRange;

      if (diving) {
        desired.set(target.x, target.y + 0.35, target.z);
      } else {
        desired.set(target.x, opts.cruiseY, target.z);
      }

      desired.subtractToRef(root.position, tmp);
      const dist = tmp.length();
      if (dist < hitRange) {
        alive = false;
        return false;
      }

      if (dist > 1e-5) {
        tmp.scaleInPlace(1 / dist);
        // Ease onto the seek heading so turns feel physical
        const turn = Math.min(1, 4.5 * dt);
        Vector3.LerpToRef(vel, tmp, turn, vel);
        if (vel.lengthSquared() > 1e-8) vel.normalize();
      }

      root.position.addInPlaceFromFloats(vel.x * speed * dt, vel.y * speed * dt, vel.z * speed * dt);
      faceVelocity(root, vel);
      flickerExhaust(exhaust, age);
      return true;
    },
    dispose: () => {
      alive = false;
      root.dispose(false, true);
    },
  };
}

function faceVelocity(node: TransformNode, vel: Vector3): void {
  if (vel.lengthSquared() < 1e-8) return;
  node.rotation.y = Math.atan2(vel.x, vel.z);
  node.rotation.x = -Math.atan2(vel.y, Math.hypot(vel.x, vel.z));
}

function flickerExhaust(
  exhaust: { scaling: Vector3; visibility: number },
  age: number,
): void {
  const pulse = 0.75 + Math.sin(age * 40) * 0.25;
  exhaust.scaling.set(pulse, pulse, 0.8 + Math.random() * 0.5);
  exhaust.visibility = 0.7 + Math.random() * 0.3;
}
