export function distXZ(
  ax: number,
  az: number,
  bx: number,
  bz: number,
): number {
  return Math.hypot(ax - bx, az - bz);
}

export function shortestAngleDelta(from: number, to: number): number {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function approach(current: number, target: number, maxDelta: number): number {
  const d = target - current;
  if (Math.abs(d) <= maxDelta) return target;
  return current + Math.sign(d) * maxDelta;
}

export function hitYForKind(kind: string): number {
  if (kind === "helicopter") return 2.7;
  if (kind === "tank") return 0.7;
  if (kind === "supplyTruck") return 0.55;
  if (kind === "turret") return 0.78;
  if (kind === "building") return 0.85;
  return 1.0;
}
