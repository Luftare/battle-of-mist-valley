import {
  BUILDING_COST,
  COMBAT_UNIT_KINDS,
  UNIT_LABEL,
  UNIT_TO_BUILDING,
  spawnIntervalForUnit,
  type CombatUnitKind,
} from "../game/stats";

/**
 * Required resource-weight ratio: min(sideA, sideB) / max(sideA, sideB).
 * 1 is a perfect match; 0.9 means the leaner side is at least 90% of the heavier.
 */
export const BALANCE_TARGET = 0.9;

/** Cap so the sandbox stays readable if weights are very far apart. */
const MAX_PER_KIND = 16;

export type ArmyCounts = Record<CombatUnitKind, number>;

export interface EncounterPlan {
  blue: ArmyCounts;
  red: ArmyCounts;
  weightBlue: number;
  weightRed: number;
  balance: number;
  totalUnits: number;
  meetsTarget: boolean;
}

/**
 * Production weight of one unit on the field: building cost × spawn interval.
 * Equal spawn + 2× cost → 2 cheap vs 1 expensive. Same plus 2× slower spawn
 * → 4 cheap vs 1 expensive. Each living unit represents that much investment.
 */
export function unitProductionWeight(kind: CombatUnitKind): number {
  const building = UNIT_TO_BUILDING[kind];
  return BUILDING_COST[building] * spawnIntervalForUnit(kind);
}

export function emptyArmy(): ArmyCounts {
  return { rifleman: 0, tank: 0, helicopter: 0 };
}

export function armyWeight(counts: ArmyCounts): number {
  let sum = 0;
  for (const kind of COMBAT_UNIT_KINDS) {
    sum += counts[kind] * unitProductionWeight(kind);
  }
  return sum;
}

export function armySize(counts: ArmyCounts): number {
  let n = 0;
  for (const kind of COMBAT_UNIT_KINDS) n += counts[kind];
  return n;
}

export function resourceBalance(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  return Math.min(a, b) / Math.max(a, b);
}

export function uniqueKinds(kinds: readonly CombatUnitKind[]): CombatUnitKind[] {
  const set = new Set(kinds);
  return COMBAT_UNIT_KINDS.filter((k) => set.has(k));
}

function maxCount(counts: ArmyCounts, kinds: readonly CombatUnitKind[]): number {
  let m = 0;
  for (const kind of kinds) m = Math.max(m, counts[kind]);
  return m;
}

function enumerateArmies(
  kinds: readonly CombatUnitKind[],
  maxEach: number,
): ArmyCounts[] {
  const out: ArmyCounts[] = [];
  const cur = emptyArmy();
  const walk = (i: number) => {
    if (i >= kinds.length) {
      out.push({ ...cur });
      return;
    }
    const kind = kinds[i]!;
    for (let n = 1; n <= maxEach; n++) {
      cur[kind] = n;
      walk(i + 1);
    }
    cur[kind] = 0;
  };
  walk(0);
  return out;
}

function betterPlan(a: EncounterPlan | null, b: EncounterPlan): EncounterPlan {
  if (!a) return b;
  if (b.meetsTarget !== a.meetsTarget) return b.meetsTarget ? b : a;
  if (b.meetsTarget) {
    if (b.totalUnits !== a.totalUnits) {
      return b.totalUnits < a.totalUnits ? b : a;
    }
    if (b.balance !== a.balance) return b.balance > a.balance ? b : a;
    return b.totalUnits <= a.totalUnits ? b : a;
  }
  if (b.balance !== a.balance) return b.balance > a.balance ? b : a;
  return b.totalUnits < a.totalUnits ? b : a;
}

/**
 * Smallest integer armies (no half units) whose production weights meet
 * `target` balance. Each selected kind appears at least once.
 */
export function solveEncounter(
  blueKinds: readonly CombatUnitKind[],
  redKinds: readonly CombatUnitKind[],
  target = BALANCE_TARGET,
): EncounterPlan | null {
  const blueSel = uniqueKinds(blueKinds);
  const redSel = uniqueKinds(redKinds);
  if (blueSel.length === 0 || redSel.length === 0) return null;

  let best: EncounterPlan | null = null;

  for (let maxEach = 1; maxEach <= MAX_PER_KIND; maxEach++) {
    const blues = enumerateArmies(blueSel, maxEach);
    const reds = enumerateArmies(redSel, maxEach);
    let foundThisCap = false;

    for (const blue of blues) {
      for (const red of reds) {
        const used = Math.max(maxCount(blue, blueSel), maxCount(red, redSel));
        if (used < maxEach) continue;

        const weightBlue = armyWeight(blue);
        const weightRed = armyWeight(red);
        const balance = resourceBalance(weightBlue, weightRed);
        const plan: EncounterPlan = {
          blue,
          red,
          weightBlue,
          weightRed,
          balance,
          totalUnits: armySize(blue) + armySize(red),
          meetsTarget: balance + 1e-9 >= target,
        };
        best = betterPlan(best, plan);
        if (plan.meetsTarget) foundThisCap = true;
      }
    }

    if (foundThisCap && best?.meetsTarget) return best;
  }

  return best;
}

/** One unit of each selected kind — ignores cost / spawn weighting. */
export function planOnePerKind(
  blueKinds: readonly CombatUnitKind[],
  redKinds: readonly CombatUnitKind[],
): EncounterPlan | null {
  const blueSel = uniqueKinds(blueKinds);
  const redSel = uniqueKinds(redKinds);
  if (blueSel.length === 0 || redSel.length === 0) return null;

  const blue = emptyArmy();
  const red = emptyArmy();
  for (const kind of blueSel) blue[kind] = 1;
  for (const kind of redSel) red[kind] = 1;

  const weightBlue = armyWeight(blue);
  const weightRed = armyWeight(red);
  return {
    blue,
    red,
    weightBlue,
    weightRed,
    balance: resourceBalance(weightBlue, weightRed),
    totalUnits: armySize(blue) + armySize(red),
    meetsTarget: false,
  };
}

export function formatArmy(counts: ArmyCounts): string {
  const parts: string[] = [];
  for (const kind of COMBAT_UNIT_KINDS) {
    const n = counts[kind];
    if (n <= 0) continue;
    parts.push(`${n}× ${UNIT_LABEL[kind]}`);
  }
  return parts.length > 0 ? parts.join(" + ") : "none";
}

export function formatWeight(weight: number): string {
  return String(Math.round(weight));
}
