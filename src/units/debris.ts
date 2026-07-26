import { Quaternion, TransformNode, Vector3 } from "@babylonjs/core";

export interface DebrisPiece {
  node: TransformNode;
  vel: Vector3;
  angVel: Vector3;
  settled: boolean;
}

export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function randSign(): number {
  return Math.random() < 0.5 ? -1 : 1;
}

/** Random velocity burst with optional bias. */
export function randBurst(
  speedMin: number,
  speedMax: number,
  bias?: Partial<{ x: number; y: number; z: number }>,
): Vector3 {
  const speed = randRange(speedMin, speedMax);
  return new Vector3(
    (randRange(-1, 1) + (bias?.x ?? 0)) * speed,
    (randRange(0.2, 1) + (bias?.y ?? 0)) * speed,
    (randRange(-1, 1) + (bias?.z ?? 0)) * speed,
  );
}

export function randSpin(min = 2, max = 10): Vector3 {
  return new Vector3(
    randRange(min, max) * randSign(),
    randRange(min, max) * randSign(),
    randRange(min, max) * randSign(),
  );
}

/** Detach a node into world space, preserving its current transform. */
export function detachWorld(node: TransformNode): void {
  node.computeWorldMatrix(true);
  const world = node.getWorldMatrix();
  const pos = new Vector3();
  const rot = new Quaternion();
  const scl = new Vector3();
  world.decompose(scl, rot, pos);
  node.parent = null;
  node.position.copyFrom(pos);
  node.rotationQuaternion = rot;
  node.rotation.setAll(0);
  node.scaling.copyFrom(scl);
}

export function makeDebris(
  node: TransformNode,
  vel: Vector3,
  angVel?: Vector3,
): DebrisPiece {
  detachWorld(node);
  return {
    node,
    vel,
    angVel: angVel ?? randSpin(),
    settled: false,
  };
}

/**
 * Integrate debris with gravity and a soft ground bounce.
 * Ground Y is approximate (flat meadow).
 */
export function stepDebris(
  pieces: DebrisPiece[],
  dt: number,
  groundY = 0.05,
  gravity = 14,
): void {
  for (const p of pieces) {
    if (p.settled) continue;

    p.vel.y -= gravity * dt;
    p.node.position.x += p.vel.x * dt;
    p.node.position.y += p.vel.y * dt;
    p.node.position.z += p.vel.z * dt;

    if (!p.node.rotationQuaternion) {
      p.node.rotationQuaternion = Quaternion.Identity();
    }
    const dq = Quaternion.FromEulerAngles(
      p.angVel.x * dt,
      p.angVel.y * dt,
      p.angVel.z * dt,
    );
    p.node.rotationQuaternion = dq.multiply(p.node.rotationQuaternion);

    if (p.node.position.y <= groundY) {
      p.node.position.y = groundY;
      if (Math.abs(p.vel.y) < 1.2 && p.vel.length() < 1.5) {
        p.vel.setAll(0);
        p.angVel.scaleInPlace(0.2);
        p.settled = true;
      } else {
        p.vel.y *= -0.35;
        p.vel.x *= 0.65;
        p.vel.z *= 0.65;
        p.angVel.scaleInPlace(0.55);
      }
    }
  }
}
