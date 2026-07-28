import type { BuildingKind } from "../buildings/types";
import { BUILDING_COST } from "./stats";
import {
  UPGRADE_DEFS,
  UPGRADE_IDS,
  upgradeCost,
  type UpgradeId,
} from "./upgrades";

/** Lightweight slot snapshot for AI planning (no Babylon handles). */
export interface AiSlotView {
  index: number;
  x: number;
  /** Living building kind, or null if empty / collapsing wreck still occupying. */
  kind: BuildingKind | null;
  /** True when a building is present and not destroyed (can be collapsed). */
  canCollapse: boolean;
}

export interface AiSnapshot {
  coins: number;
  counts: Record<BuildingKind, number>;
  empty: AiSlotView[];
  occupied: AiSlotView[];
  researching: boolean;
  tech: Record<UpgradeId, number>;
  /** Seconds since match start — used for phase timing. */
  elapsed: number;
}

export type AiAction =
  | { type: "research"; id: UpgradeId }
  | { type: "build"; kind: BuildingKind; slotIndex: number }
  | { type: "collapse"; slotIndex: number; rebuildAs?: BuildingKind }
  | { type: "noop" };

export type AiStrategyId =
  | "barracksRush"
  | "barracksRushLab"
  | "supplyTank"
  | "supplyTurret"
  | "supplyLogistics"
  | "infantryTank"
  | "infantryHeli"
  | "balanced";

export interface AiBrain {
  readonly strategyId: AiStrategyId;
  readonly label: string;
  decide: (snap: AiSnapshot) => AiAction;
}

type SlotBias = "center" | "sides" | "any";

interface StratState {
  phase: number;
  /** After collapsing, insist on this rebuild when a pad frees up. */
  pendingRebuild: BuildingKind | null;
  /** Coins threshold already crossed for mid-game transition. */
  transitionArmed: boolean;
}

function pickWeighted<T extends string>(
  weights: Record<T, number>,
): T {
  const entries = Object.entries(weights) as [T, number][];
  let total = 0;
  for (const [, w] of entries) total += Math.max(0, w);
  let r = Math.random() * total;
  for (const [id, w] of entries) {
    r -= Math.max(0, w);
    if (r <= 0) return id;
  }
  return entries[entries.length - 1][0];
}

function shuffleInPlace<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function sortByBias(slots: AiSlotView[], bias: SlotBias): AiSlotView[] {
  const copy = [...slots];
  if (bias === "center") {
    copy.sort((a, b) => Math.abs(a.x) - Math.abs(b.x));
  } else if (bias === "sides") {
    copy.sort((a, b) => Math.abs(b.x) - Math.abs(a.x));
  } else {
    shuffleInPlace(copy);
  }
  // Tiny jitter so equal distances don't always pick the same pad
  if (bias !== "any" && copy.length > 1 && Math.random() < 0.35) {
    const i = Math.floor(Math.random() * Math.min(3, copy.length));
    const j = Math.floor(Math.random() * Math.min(3, copy.length));
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}

function canAfford(coins: number, kind: BuildingKind): boolean {
  return coins >= BUILDING_COST[kind];
}

function tryBuild(
  snap: AiSnapshot,
  kind: BuildingKind,
  bias: SlotBias,
): AiAction | null {
  if (!canAfford(snap.coins, kind) || snap.empty.length === 0) return null;
  const slot = sortByBias(snap.empty, bias)[0];
  return { type: "build", kind, slotIndex: slot.index };
}

function findCollapseCandidate(
  snap: AiSnapshot,
  kind: BuildingKind,
): AiSlotView | null {
  // Must keep at least one living building
  if (snap.occupied.length <= 1) return null;
  const matches = snap.occupied.filter(
    (s) => s.kind === kind && s.canCollapse,
  );
  if (!matches.length) return null;
  // Prefer outer pads when sacrificing (center stays for combat pressure)
  return sortByBias(matches, "sides")[0];
}

function tryCollapseFor(
  snap: AiSnapshot,
  sacrifice: BuildingKind,
  rebuildAs: BuildingKind,
): AiAction | null {
  if (snap.empty.length > 0) {
    // Pad already free — just build
    return tryBuild(snap, rebuildAs, "any");
  }
  if (!canAfford(snap.coins, rebuildAs) && snap.coins < BUILDING_COST[rebuildAs] + 15) {
    return null;
  }
  // Need buffer for rebuild after collapse (no refund)
  if (snap.coins < BUILDING_COST[rebuildAs] + 25) return null;
  const slot = findCollapseCandidate(snap, sacrifice);
  if (!slot) return null;
  return { type: "collapse", slotIndex: slot.index, rebuildAs };
}

function researchPriority(
  snap: AiSnapshot,
  preferred: UpgradeId[],
): AiAction | null {
  if (snap.researching || snap.counts.researchLab < 1) return null;
  // Try preferred order first, then remaining upgrades so coins don't idle
  const ordered = [
    ...preferred,
    ...UPGRADE_IDS.filter((id) => !preferred.includes(id)),
  ];
  const affordable: UpgradeId[] = [];
  for (const id of ordered) {
    const def = UPGRADE_DEFS[id];
    const level = snap.tech[id] ?? 0;
    if (level >= def.maxLevel) continue;
    const cost = upgradeCost(def, level);
    if (snap.coins < cost) continue;
    affordable.push(id);
  }
  if (!affordable.length) return null;
  // Prefer list order, but occasionally skip ahead for variety
  let pick = affordable[0];
  if (affordable.length > 1 && Math.random() < 0.22) {
    pick = affordable[Math.floor(Math.random() * Math.min(3, affordable.length))];
  }
  return { type: "research", id: pick };
}

function mixBuild(
  snap: AiSnapshot,
  weights: Partial<Record<BuildingKind, number>>,
  bias: SlotBias,
): AiAction | null {
  const kinds = (Object.keys(weights) as BuildingKind[]).filter(
    (k) => (weights[k] ?? 0) > 0 && canAfford(snap.coins, k),
  );
  if (!kinds.length || snap.empty.length === 0) return null;
  // Prefer underrepresented kinds relative to weights
  const scored = kinds.map((k) => {
    const w = weights[k] ?? 1;
    const have = snap.counts[k] ?? 0;
    const score = w / (1 + have) + Math.random() * 0.15;
    return { k, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return tryBuild(snap, scored[0].k, bias);
}

function makeBrain(
  strategyId: AiStrategyId,
  label: string,
  step: (snap: AiSnapshot, state: StratState) => AiAction,
): AiBrain {
  const state: StratState = {
    phase: 0,
    pendingRebuild: null,
    transitionArmed: false,
  };
  return {
    strategyId,
    label,
    decide: (snap) => {
      // Honor pending rebuild from a prior sacrifice as soon as a pad is free
      if (state.pendingRebuild && snap.empty.length > 0) {
        const kind = state.pendingRebuild;
        if (canAfford(snap.coins, kind)) {
          state.pendingRebuild = null;
          const act = tryBuild(snap, kind, "any");
          if (act) return act;
        }
      }
      const action = step(snap, state);
      if (action.type === "collapse" && action.rebuildAs) {
        state.pendingRebuild = action.rebuildAs;
      }
      return action;
    },
  };
}

/** Early center barracks, expand sides, then tanks + helis. */
function createBarracksRush(withLabVariant: boolean): AiBrain {
  const id: AiStrategyId = withLabVariant ? "barracksRushLab" : "barracksRush";
  const label = withLabVariant
    ? "Barracks rush → infantry lab → armor/air"
    : "Barracks rush → tanks & helicopters";
  const targetBarracks = withLabVariant ? 3 + Math.floor(Math.random() * 2) : 4 + Math.floor(Math.random() * 2);
  const transitionCoins = 180 + Math.floor(Math.random() * 80);

  return makeBrain(id, label, (snap, state) => {
    // Lab path: after a few barracks, sacrifice one for lab + infantry tech
    if (withLabVariant && state.phase < 2 && snap.counts.researchLab === 0) {
      if (snap.counts.barracks >= 2 && snap.coins >= BUILDING_COST.researchLab + 30) {
        const act = tryCollapseFor(snap, "barracks", "researchLab");
        if (act) {
          state.phase = Math.max(state.phase, 1);
          return act;
        }
      }
    }

    const infantryTech = researchPriority(snap, [
      "infantryProd",
      "infantryAccuracy",
      "heliMissiles",
      "tankFireRate",
      "tankHp",
    ]);
    // Spend on tech when lab is up and we have spare coins
    if (infantryTech && (snap.counts.researchLab > 0) && snap.coins >= 100) {
      if (Math.random() < 0.7 || snap.empty.length === 0) return infantryTech;
    }

    if (!state.transitionArmed && snap.coins >= transitionCoins) {
      state.transitionArmed = true;
      state.phase = Math.max(state.phase, 2);
    }
    if (snap.counts.barracks >= targetBarracks) {
      state.phase = Math.max(state.phase, 2);
    }

    // Early / mid: fill barracks center → sides
    if (state.phase < 2) {
      const bias: SlotBias =
        snap.counts.barracks < 2 ? "center" : Math.random() < 0.55 ? "sides" : "center";
      const act = tryBuild(snap, "barracks", bias);
      if (act) return act;
      if (infantryTech) return infantryTech;
      return { type: "noop" };
    }

    // Transition: mix factories and helipads (and a depot if broke-ish)
    if (snap.counts.depot === 0 && snap.coins >= BUILDING_COST.depot && Math.random() < 0.35) {
      const act = tryBuild(snap, "depot", "sides");
      if (act) return act;
    }
    const mix = mixBuild(
      snap,
      {
        factory: 1.2,
        helipad: 1.0,
        barracks: snap.counts.barracks < 2 ? 0.4 : 0.15,
        depot: snap.counts.depot < 1 ? 0.5 : 0.1,
      },
      "any",
    );
    if (mix) return mix;
    if (infantryTech) return infantryTech;
    return { type: "noop" };
  });
}

type SupplyVariant = "tanks" | "turrets" | "logistics";

function createSupplyRush(variant: SupplyVariant): AiBrain {
  const idMap: Record<SupplyVariant, AiStrategyId> = {
    tanks: "supplyTank",
    turrets: "supplyTurret",
    logistics: "supplyLogistics",
  };
  const labels: Record<SupplyVariant, string> = {
    tanks: "Supply rush → all-in tanks",
    turrets: "Supply rush → turret tech → armor/air",
    logistics: "Supply + logistics tech → tanks & helicopters",
  };
  const targetDepots = 2 + Math.floor(Math.random() * 2);
  const transitionCoins =
    variant === "logistics" ? 220 + Math.floor(Math.random() * 60) : 160 + Math.floor(Math.random() * 70);

  return makeBrain(idMap[variant], labels[variant], (snap, state) => {
    const upgradeOrder: UpgradeId[] =
      variant === "tanks"
        ? ["tankHp", "tankFireRate", "tankSplash", "supplySpeed", "heliMissiles"]
        : variant === "turrets"
          ? ["turretRange", "turretRegen", "supplySpeed", "tankHp", "heliMissiles"]
          : ["supplySpeed", "supplySpeed", "tankFireRate", "heliMissiles", "tankHp"];

    // Get a lab early for this archetype
    if (snap.counts.researchLab === 0 && snap.counts.depot >= 1) {
      if (snap.coins >= BUILDING_COST.researchLab) {
        const build = tryBuild(snap, "researchLab", "center");
        if (build) return build;
        if (snap.counts.depot >= 2) {
          const collapse = tryCollapseFor(snap, "depot", "researchLab");
          if (collapse) return collapse;
        }
      }
    }

    const tech = researchPriority(
      snap,
      variant === "logistics"
        ? ["supplySpeed", "heliMissiles", "tankFireRate", "tankHp", "tankSplash"]
        : upgradeOrder,
    );
    // Logistics variant stacks supply aggressively
    if (
      tech &&
      tech.type === "research" &&
      variant === "logistics" &&
      tech.id === "supplySpeed" &&
      snap.coins >= upgradeCost(UPGRADE_DEFS.supplySpeed, snap.tech.supplySpeed)
    ) {
      return tech;
    }
    if (tech && Math.random() < 0.65 && snap.counts.researchLab > 0) {
      // Prefer researching over expanding when we have spare cash
      if (snap.empty.length === 0 || snap.coins > 140) return tech;
    }

    if (!state.transitionArmed && snap.coins >= transitionCoins) {
      state.transitionArmed = true;
      state.phase = 2;
    }
    if (snap.counts.depot >= targetDepots) state.phase = Math.max(state.phase, 1);

    if (state.phase < 2) {
      const bias: SlotBias = snap.counts.depot < 1 ? "center" : "any";
      const depotAct = tryBuild(snap, "depot", bias);
      if (depotAct && snap.counts.depot < targetDepots) return depotAct;
      if (variant === "tanks") {
        const tank = tryBuild(snap, "factory", "any");
        if (tank) return tank;
      }
      if (tech) return tech;
      return depotAct ?? { type: "noop" };
    }

    // Late: tanks and/or helicopters
    const mix =
      variant === "tanks"
        ? mixBuild(snap, { factory: 1.6, helipad: 0.5, depot: 0.2 }, "any")
        : mixBuild(snap, { factory: 1.0, helipad: 1.1, depot: 0.25 }, "any");
    if (mix) return mix;
    if (tech) return tech;
    return { type: "noop" };
  });
}

function createInfantryTank(): AiBrain {
  const labCoins = 200 + Math.floor(Math.random() * 80);
  return makeBrain(
    "infantryTank",
    "Infantry + tanks 50/50 → lab",
    (snap, state) => {
      const tech = researchPriority(snap, [
        "tankFireRate",
        "tankHp",
        "infantryAccuracy",
        "tankSplash",
        "infantryProd",
      ]);

      if (
        !state.transitionArmed &&
        snap.coins >= labCoins &&
        snap.counts.barracks + snap.counts.factory >= 3
      ) {
        state.transitionArmed = true;
      }

      if (state.transitionArmed && snap.counts.researchLab === 0) {
        const act =
          tryBuild(snap, "researchLab", "any") ??
          tryCollapseFor(snap, "barracks", "researchLab");
        if (act) return act;
      }

      if (tech && snap.counts.researchLab > 0 && (snap.empty.length === 0 || Math.random() < 0.55)) {
        return tech;
      }

      // Keep barracks ≈ factories
      const b = snap.counts.barracks;
      const f = snap.counts.factory;
      if (b < f) {
        const act = tryBuild(snap, "barracks", b < 2 ? "center" : "any");
        if (act) return act;
      } else if (f < b) {
        const act = tryBuild(snap, "factory", "any");
        if (act) return act;
      } else {
        const act = mixBuild(
          snap,
          { barracks: 1, factory: 1, depot: snap.counts.depot < 1 ? 0.4 : 0 },
          b < 2 ? "center" : "any",
        );
        if (act) return act;
      }
      if (tech) return tech;
      return { type: "noop" };
    },
  );
}

function createInfantryHeli(): AiBrain {
  return makeBrain(
    "infantryHeli",
    "Infantry → lab (missiles) → helicopters",
    (snap, state) => {
      const tech = researchPriority(snap, [
        "heliMissiles",
        "infantryAccuracy",
        "infantryProd",
        "turretRange",
      ]);

      // Barracks foothold first
      if (snap.counts.barracks < 2) {
        const act = tryBuild(snap, "barracks", "center");
        if (act) return act;
      }

      // Lab before any helipad
      if (snap.counts.researchLab === 0) {
        if (snap.counts.helipad === 0) {
          const act =
            tryBuild(snap, "researchLab", "any") ??
            (snap.counts.barracks >= 2
              ? tryCollapseFor(snap, "barracks", "researchLab")
              : null);
          if (act) return act;
        }
      }

      // Research missiles before committing to air
      if (
        snap.counts.researchLab > 0 &&
        snap.tech.heliMissiles < 1 &&
        !snap.researching
      ) {
        const missile = researchPriority(snap, ["heliMissiles"]);
        if (missile) return missile;
      }

      if (snap.tech.heliMissiles >= 1 || snap.counts.helipad > 0) {
        state.phase = 2;
      }

      if (state.phase >= 2 || snap.tech.heliMissiles >= 1) {
        const mix = mixBuild(
          snap,
          {
            helipad: 1.4,
            barracks: 0.7,
            factory: 0.35,
            depot: snap.counts.depot < 1 ? 0.3 : 0,
          },
          "any",
        );
        if (mix) return mix;
      } else {
        const act = tryBuild(snap, "barracks", "sides");
        if (act) return act;
      }

      if (tech) return tech;
      return { type: "noop" };
    },
  );
}

function createBalanced(): AiBrain {
  const labCoins = 240 + Math.floor(Math.random() * 100);
  return makeBrain(
    "balanced",
    "Balanced center open → equal blend → lab",
    (snap, state) => {
      const tech = researchPriority(snap, [
        "heliMissiles",
        "tankFireRate",
        "infantryAccuracy",
        "supplySpeed",
        "tankHp",
        "turretRange",
      ]);

      // Opening: center depot + center barracks
      if (snap.counts.depot < 1) {
        const act = tryBuild(snap, "depot", "center");
        if (act) return act;
      }
      if (snap.counts.barracks < 1) {
        const act = tryBuild(snap, "barracks", "center");
        if (act) return act;
      }

      if (!state.transitionArmed && snap.coins >= labCoins) {
        state.transitionArmed = true;
      }

      if (state.transitionArmed && snap.counts.researchLab === 0) {
        const act =
          tryBuild(snap, "researchLab", "any") ??
          tryCollapseFor(snap, "barracks", "researchLab");
        if (act) return act;
      }

      if (tech && snap.counts.researchLab > 0 && Math.random() < 0.6) {
        return tech;
      }

      // Equal blend of tank / infantry / heli
      const mix = mixBuild(
        snap,
        {
          barracks: 1,
          factory: 1,
          helipad: 1,
          depot: snap.counts.depot < 2 ? 0.35 : 0.05,
        },
        "any",
      );
      if (mix) return mix;
      if (tech) return tech;
      return { type: "noop" };
    },
  );
}

/**
 * Roll a random opening strategy for the enemy AI.
 * Weights favor readable archetypes without making one dominant.
 */
export function createAiBrain(): AiBrain {
  const id = pickWeighted<AiStrategyId>({
    barracksRush: 1.15,
    barracksRushLab: 0.95,
    supplyTank: 0.85,
    supplyTurret: 0.7,
    supplyLogistics: 0.8,
    infantryTank: 1.0,
    infantryHeli: 0.9,
    balanced: 1.1,
  });

  switch (id) {
    case "barracksRush":
      return createBarracksRush(false);
    case "barracksRushLab":
      return createBarracksRush(true);
    case "supplyTank":
      return createSupplyRush("tanks");
    case "supplyTurret":
      return createSupplyRush("turrets");
    case "supplyLogistics":
      return createSupplyRush("logistics");
    case "infantryTank":
      return createInfantryTank();
    case "infantryHeli":
      return createInfantryHeli();
    case "balanced":
    default:
      return createBalanced();
  }
}
