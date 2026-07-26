import type { Obstacle } from "../terrain/createTerrain";

export interface Vec2 {
  x: number;
  z: number;
}

export interface SteerOptions {
  arriveDist?: number;
  /** Unit body radius used for clearance around trunks/rocks. */
  agentRadius?: number;
}

/**
 * Steer toward a goal while sliding around circular obstacles.
 * Only avoids obstacles that actually block the path to the goal,
 * picks the clearer side, and strongly escapes if overlapping.
 */
export function steerToward(
  from: Vec2,
  goal: Vec2,
  obstacles: readonly Obstacle[],
  opts?: SteerOptions,
): Vec2 | null {
  const arriveDist = opts?.arriveDist ?? 0.35;
  const agentR = opts?.agentRadius ?? 0.4;

  const dx = goal.x - from.x;
  const dz = goal.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist <= arriveDist) return null;

  let dirX = dx / dist;
  let dirZ = dz / dist;

  let pushX = 0;
  let pushZ = 0;
  let blocked = false;

  for (const obs of obstacles) {
    const clearR = obs.radius + agentR;
    const toObsX = obs.x - from.x;
    const toObsZ = obs.z - from.z;
    const sep = Math.hypot(toObsX, toObsZ);

    // Overlap / very close: push straight out, hard
    if (sep < clearR + 0.05) {
      blocked = true;
      if (sep < 1e-4) {
        // Degenerate: push perpendicular to goal
        pushX += -dirZ * 3;
        pushZ += dirX * 3;
      } else {
        const escape = (clearR + 0.2 - sep) / clearR;
        pushX -= (toObsX / sep) * (2.5 + escape * 4);
        pushZ -= (toObsZ / sep) * (2.5 + escape * 4);
        // Prefer the side that still advances toward the goal
        const { leftX, leftZ, rightX, rightZ } = tangents(toObsX, toObsZ, sep);
        const leftDot = leftX * dirX + leftZ * dirZ;
        const rightDot = rightX * dirX + rightZ * dirZ;
        if (leftDot > rightDot) {
          pushX += leftX * 1.4;
          pushZ += leftZ * 1.4;
        } else {
          pushX += rightX * 1.4;
          pushZ += rightZ * 1.4;
        }
      }
      continue;
    }

    // Only care about obstacles between us and the goal
    const ahead = toObsX * dirX + toObsZ * dirZ;
    if (ahead < 0.05 || ahead > dist) continue;

    // Lateral distance from the goal-line to the obstacle center
    const closestX = from.x + dirX * ahead;
    const closestZ = from.z + dirZ * ahead;
    const lat = Math.hypot(obs.x - closestX, obs.z - closestZ);
    if (lat >= clearR + 0.12) continue;

    blocked = true;

    // Which way around? Prefer the tangent that stays closest to the goal heading
    const { leftX, leftZ, rightX, rightZ } = tangents(toObsX, toObsZ, sep);
    const leftDot = leftX * dirX + leftZ * dirZ;
    const rightDot = rightX * dirX + rightZ * dirZ;

    // Also bias by which side of our path the obstacle sits on
    const side = toObsX * -dirZ + toObsZ * dirX; // >0 => obs left of heading
    let useLeft = leftDot >= rightDot;
    if (Math.abs(leftDot - rightDot) < 0.15) {
      // Ambiguous: go opposite the obstacle
      useLeft = side < 0;
    }

    const strength = 1 - lat / (clearR + 0.12);
    const urgency = 0.7 + Math.max(0, 1 - ahead / Math.max(1.5, dist)) * 1.4;
    const steer = strength * urgency;

    if (useLeft) {
      pushX += leftX * steer * 2.1;
      pushZ += leftZ * steer * 2.1;
    } else {
      pushX += rightX * steer * 2.1;
      pushZ += rightZ * steer * 2.1;
    }

    // Soft radial so we don't graze the trunk
    const radial = Math.max(0, (clearR + 0.35 - sep) / (clearR + 0.35));
    if (radial > 0) {
      pushX -= (toObsX / sep) * radial * 1.2;
      pushZ -= (toObsZ / sep) * radial * 1.2;
    }
  }

  dirX += pushX;
  dirZ += pushZ;
  const len = Math.hypot(dirX, dirZ);
  if (len < 1e-5) {
    // Completely cancelled — still try to slide sideways
    return blocked ? { x: -dz / dist, z: dx / dist } : { x: dx / dist, z: dz / dist };
  }
  return { x: dirX / len, z: dirZ / len };
}

/** Unit-space tangents around an obstacle (left / right of the vector to it). */
function tangents(
  toObsX: number,
  toObsZ: number,
  sep: number,
): { leftX: number; leftZ: number; rightX: number; rightZ: number } {
  const nx = toObsX / sep;
  const nz = toObsZ / sep;
  return {
    leftX: -nz,
    leftZ: nx,
    rightX: nz,
    rightZ: -nx,
  };
}

/**
 * Compute a bypass waypoint that skirts the nearest blocking obstacle
 * on the clearer side toward the goal. Returns null if nothing blocks.
 */
export function bypassAroundObstacle(
  from: Vec2,
  goal: Vec2,
  obstacles: readonly Obstacle[],
  agentRadius: number,
): Vec2 | null {
  const dx = goal.x - from.x;
  const dz = goal.z - from.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1e-4) return null;
  const dirX = dx / dist;
  const dirZ = dz / dist;

  let best: Obstacle | null = null;
  let bestAhead = Infinity;

  for (const obs of obstacles) {
    const clearR = obs.radius + agentRadius;
    const toObsX = obs.x - from.x;
    const toObsZ = obs.z - from.z;
    const sep = Math.hypot(toObsX, toObsZ);
    const ahead = toObsX * dirX + toObsZ * dirZ;
    if (ahead < -0.2 || ahead > dist + clearR) continue;

    const closestX = from.x + dirX * Math.max(0, ahead);
    const closestZ = from.z + dirZ * Math.max(0, ahead);
    const lat = Math.hypot(obs.x - closestX, obs.z - closestZ);
    if (lat >= clearR + 0.2 && sep > clearR + 0.25) continue;

    if (ahead < bestAhead) {
      bestAhead = ahead;
      best = obs;
    }
  }

  if (!best) return null;

  const toObsX = best.x - from.x;
  const toObsZ = best.z - from.z;
  const sep = Math.hypot(toObsX, toObsZ) || 1;
  const { leftX, leftZ, rightX, rightZ } = tangents(toObsX, toObsZ, sep);
  const leftDot = leftX * dirX + leftZ * dirZ;
  const useLeft = leftDot >= rightX * dirX + rightZ * dirZ;
  const clearR = best.radius + agentRadius + 0.55;
  const sideX = useLeft ? leftX : rightX;
  const sideZ = useLeft ? leftZ : rightZ;

  return {
    x: best.x + sideX * clearR + dirX * 0.4,
    z: best.z + sideZ * clearR + dirZ * 0.4,
  };
}

/** Clamp a point inside the square playfield (margin from edges). */
export function clampToPlayfield(
  x: number,
  z: number,
  halfSize: number,
  margin = 1.2,
): Vec2 {
  const lim = halfSize - margin;
  return {
    x: Math.max(-lim, Math.min(lim, x)),
    z: Math.max(-lim, Math.min(lim, z)),
  };
}
