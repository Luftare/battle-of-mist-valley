/** Mulberry32 — small, seedable, good enough for combat rolls. */
export interface Rng {
  next: () => number;
  range: (min: number, max: number) => number;
  signed: (scale: number) => number;
  chance: (p: number) => boolean;
  angle: () => number;
}

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  if (a === 0) a = 0x9e3779b9;
  const next = (): number => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    range: (min, max) => min + next() * (max - min),
    signed: (scale) => (next() * 2 - 1) * scale,
    chance: (p) => next() < p,
    angle: () => next() * Math.PI * 2,
  };
}

/** Same LCG terrain uses for tree/rock placement (`seededRandom(42)`). */
export function createTerrainRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
