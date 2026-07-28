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
  /** True when a research lab is finished constructing. */
  labReady: boolean;
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
  | "factoryAllIn"
  | "heliAllIn"
  | "escortedSupply"
  | "centerInfantry"
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

function totalBuildings(snap: AiSnapshot): number {
  return (
    snap.counts.barracks +
    snap.counts.depot +
    snap.counts.factory +
    snap.counts.helipad +
    snap.counts.researchLab
  );
}

/** Early economy cap: at most 4 depots; the 5th building must diversify. */
const MAX_EARLY_DEPOTS = 4;

function allowDepot(snap: AiSnapshot): boolean {
  const depots = snap.counts.depot;
  if (depots >= MAX_EARLY_DEPOTS) return false;
  // First four can be depots; placing a 5th building cannot be another depot-only step
  const total = totalBuildings(snap);
  if (total >= 4 && depots === total) return false;
  return true;
}

function tryBuild(
  snap: AiSnapshot,
  kind: BuildingKind,
  bias: SlotBias,
): AiAction | null {
  if (kind === "depot" && !allowDepot(snap)) return null;
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
  if (snap.researching || !snap.labReady) return null;
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

function infantryTechComplete(snap: AiSnapshot): boolean {
  return (
    (snap.tech.infantryAccuracy ?? 0) >= UPGRADE_DEFS.infantryAccuracy.maxLevel &&
    (snap.tech.infantryProd ?? 0) >= UPGRADE_DEFS.infantryProd.maxLevel
  );
}

function mixBuild(
  snap: AiSnapshot,
  weights: Partial<Record<BuildingKind, number>>,
  bias: SlotBias,
): AiAction | null {
  const adjusted = { ...weights };
  if (!allowDepot(snap)) adjusted.depot = 0;
  const kinds = (Object.keys(adjusted) as BuildingKind[]).filter(
    (k) => (adjusted[k] ?? 0) > 0 && canAfford(snap.coins, k),
  );
  if (!kinds.length || snap.empty.length === 0) return null;
  // Prefer underrepresented kinds relative to weights
  const scored = kinds.map((k) => {
    const w = adjusted[k] ?? 1;
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
        if (kind === "depot" && !allowDepot(snap)) {
          state.pendingRebuild = null;
        } else if (canAfford(snap.coins, kind)) {
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
    if (infantryTech && snap.labReady && snap.coins >= 100) {
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
  const targetDepots = Math.min(
    MAX_EARLY_DEPOTS,
    2 + Math.floor(Math.random() * 2),
  );
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
    if (tech && Math.random() < 0.65 && snap.labReady) {
      // Prefer researching over expanding when we have spare cash
      if (snap.empty.length === 0 || snap.coins > 140) return tech;
    }

    if (!state.transitionArmed && snap.coins >= transitionCoins) {
      state.transitionArmed = true;
      state.phase = 2;
    }
    if (snap.counts.depot >= targetDepots) state.phase = Math.max(state.phase, 1);
    // Must diversify by the 5th building — leave the depot-only opening
    if (!allowDepot(snap) && totalBuildings(snap) >= 4) {
      state.phase = Math.max(state.phase, 2);
    }

    if (state.phase < 2) {
      const bias: SlotBias = snap.counts.depot < 1 ? "center" : "any";
      if (allowDepot(snap) && snap.counts.depot < targetDepots) {
        const depotAct = tryBuild(snap, "depot", bias);
        if (depotAct) return depotAct;
      }
      // Diversify once depot target / early cap is hit
      if (variant === "tanks") {
        const tank = tryBuild(snap, "factory", "any");
        if (tank) return tank;
      } else {
        const diversify =
          tryBuild(snap, "factory", "any") ??
          tryBuild(snap, "helipad", "any") ??
          tryBuild(snap, "barracks", "any");
        if (diversify) return diversify;
      }
      if (tech) return tech;
      return { type: "noop" };
    }

    // Late: tanks and/or helicopters (depot weight respected by allowDepot)
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

      if (tech && snap.labReady && (snap.empty.length === 0 || Math.random() < 0.55)) {
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
        snap.labReady &&
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

      if (tech && snap.labReady && Math.random() < 0.6) {
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
 * Pure armor or air spam — no depots. Mid-game: sacrifice one producer for a
 * lab and finish the matching tech tree.
 */
function createAllInProducer(
  producer: "factory" | "helipad",
): AiBrain {
  const isTanks = producer === "factory";
  const id: AiStrategyId = isTanks ? "factoryAllIn" : "heliAllIn";
  const label = isTanks
    ? "All-in factories → tank lab"
    : "All-in helipads → missile lab";
  const targetCount = 3 + Math.floor(Math.random() * 2); // 3–4 producers
  const labCoins =
    BUILDING_COST.researchLab +
    (isTanks ? 160 : 140) +
    Math.floor(Math.random() * 80);
  const upgrades: UpgradeId[] = isTanks
    ? ["tankFireRate", "tankHp", "tankSplash", "turretRange", "turretRegen"]
    : ["heliMissiles", "turretRange", "turretRegen", "tankFireRate"];

  return makeBrain(id, label, (snap, state) => {
    const tech = researchPriority(snap, upgrades);
    const have = snap.counts[producer];

    if (
      !state.transitionArmed &&
      snap.coins >= labCoins &&
      have >= Math.min(2, targetCount)
    ) {
      state.transitionArmed = true;
    }
    if (have >= targetCount && snap.coins >= BUILDING_COST.researchLab + 40) {
      state.transitionArmed = true;
    }

    // Lab via empty pad or by sacrificing one producer — never a depot
    if (state.transitionArmed && snap.counts.researchLab === 0) {
      const act =
        tryBuild(snap, "researchLab", "any") ??
        tryCollapseFor(snap, producer, "researchLab");
      if (act) return act;
    }

    // Burn coins into the full tank / heli tech path once the lab is live
    if (tech && snap.labReady) {
      if (snap.empty.length === 0 || Math.random() < 0.72) return tech;
    }

    // Keep flooding the chosen producer; center first, then anywhere
    const bias: SlotBias = have < 2 ? "center" : Math.random() < 0.4 ? "sides" : "any";
    const build = tryBuild(snap, producer, bias);
    if (build) return build;

    if (tech) return tech;
    return { type: "noop" };
  });
}

/**
 * Barracks escort depots, sacrifice a depot for lab + infantry tech, then
 * convert remaining depots into more barracks.
 */
function createEscortedSupply(): AiBrain {
  const earlyDepots = Math.min(MAX_EARLY_DEPOTS, 2 + Math.floor(Math.random() * 2));
  const labCoins = 170 + Math.floor(Math.random() * 80);

  return makeBrain(
    "escortedSupply",
    "Escorted supply → lab → infantry tech → all barracks",
    (snap, state) => {
      const tech = researchPriority(snap, [
        "infantryProd",
        "infantryAccuracy",
        "turretRange",
        "turretRegen",
      ]);

      // Endgame: strip depots for barracks once infantry tech is done
      if (
        state.phase >= 3 ||
        (snap.labReady && infantryTechComplete(snap) && snap.counts.depot > 0)
      ) {
        state.phase = Math.max(state.phase, 3);
        if (snap.counts.depot > 0) {
          const convert = tryCollapseFor(snap, "depot", "barracks");
          if (convert) return convert;
        }
        const more = tryBuild(snap, "barracks", "any");
        if (more) return more;
        if (tech) return tech;
        return { type: "noop" };
      }

      // Mid: replace a supply depot with the research lab
      if (snap.counts.researchLab === 0) {
        const readyForLab =
          snap.counts.barracks >= 2 &&
          snap.counts.depot >= 1 &&
          snap.coins >= labCoins;
        if (readyForLab) {
          const act =
            tryCollapseFor(snap, "depot", "researchLab") ??
            tryBuild(snap, "researchLab", "any");
          if (act) {
            state.phase = Math.max(state.phase, 1);
            return act;
          }
        }
      } else {
        state.phase = Math.max(state.phase, 1);
      }

      if (tech && snap.labReady && (snap.empty.length === 0 || Math.random() < 0.7)) {
        return tech;
      }

      // Opening: keep barracks escorting depots (roughly barracks ≥ depots)
      const b = snap.counts.barracks;
      const d = snap.counts.depot;
      if (b < 1) {
        const act = tryBuild(snap, "barracks", "center");
        if (act) return act;
      }
      if (allowDepot(snap) && d < earlyDepots && b >= d) {
        const act = tryBuild(snap, "depot", d < 1 ? "center" : "sides");
        if (act) return act;
      }
      if (b < d + 1 || b < 2) {
        const act = tryBuild(snap, "barracks", b < 2 ? "center" : "sides");
        if (act) return act;
      }
      if (allowDepot(snap) && d < earlyDepots) {
        const act = tryBuild(snap, "depot", "any");
        if (act) return act;
      }
      const moreBarracks = tryBuild(snap, "barracks", "any");
      if (moreBarracks) return moreBarracks;
      if (tech) return tech;
      return { type: "noop" };
    },
  );
}

/**
 * Three center barracks, one depot + lab, finish infantry tech, then expand barracks.
 */
function createCenterInfantry(): AiBrain {
  return makeBrain(
    "centerInfantry",
    "3 center barracks + depot/lab → infantry tech → more barracks",
    (snap, state) => {
      const tech = researchPriority(snap, [
        "infantryProd",
        "infantryAccuracy",
        "turretRange",
        "turretRegen",
      ]);

      // 1) Three barracks on center pads
      if (snap.counts.barracks < 3) {
        const act = tryBuild(snap, "barracks", "center");
        if (act) return act;
      }

      // 2) One supply depot
      if (snap.counts.depot < 1 && allowDepot(snap)) {
        const act = tryBuild(snap, "depot", "sides");
        if (act) return act;
      }

      // 3) Research lab
      if (snap.counts.researchLab === 0) {
        const act =
          tryBuild(snap, "researchLab", "any") ??
          (snap.counts.depot >= 1
            ? tryCollapseFor(snap, "depot", "researchLab")
            : null);
        if (act) return act;
      }

      // 4) Full infantry upgrades before sprawling further
      if (snap.labReady && !infantryTechComplete(snap)) {
        if (tech) return tech;
      }

      // 5) More barracks (keep the single depot if still standing)
      if (snap.labReady) {
        state.phase = Math.max(state.phase, 2);
        const act = tryBuild(snap, "barracks", "any");
        if (act) return act;
      }

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
    factoryAllIn: 0.9,
    heliAllIn: 0.85,
    escortedSupply: 0.95,
    centerInfantry: 0.9,
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
    case "factoryAllIn":
      return createAllInProducer("factory");
    case "heliAllIn":
      return createAllInProducer("helipad");
    case "escortedSupply":
      return createEscortedSupply();
    case "centerInfantry":
      return createCenterInfantry();
    case "balanced":
    default:
      return createBalanced();
  }
}
