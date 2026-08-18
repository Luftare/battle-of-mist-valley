import { Engine } from "@babylonjs/core";
import {
  BUILDING_COST,
  BUILDING_LABEL,
  COMBAT_UNIT_KINDS,
  UNIT_LABEL,
  UNIT_TO_BUILDING,
  spawnIntervalForUnit,
  type CombatUnitKind,
} from "../game/stats";
import {
  applyMobilePixelCap,
  isMobileDevice,
  MOBILE_TARGET_FPS,
} from "../platform/mobile";
import { createBalanceWorld } from "./createBalanceWorld";
import { ENCOUNTER_PRESETS } from "./encounters";
import {
  BALANCE_TARGET,
  formatArmy,
  formatWeight,
  planOnePerKind,
  solveEncounter,
  unitProductionWeight,
  uniqueKinds,
  type EncounterPlan,
} from "./solveEncounter";

const canvas = document.getElementById("renderCanvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Missing #renderCanvas");
}

function mustEl<T extends HTMLElement>(
  id: string,
  guard: (el: HTMLElement) => el is T,
): T {
  const el = document.getElementById(id);
  if (!el || !guard(el)) throw new Error(`Missing #${id}`);
  return el;
}

const encounterEl = mustEl("encounter", (el): el is HTMLSelectElement => el instanceof HTMLSelectElement);
const planEl = mustEl("plan", (el): el is HTMLElement => el instanceof HTMLElement);
const weightsEl = mustEl("weights", (el): el is HTMLElement => el instanceof HTMLElement);
const statusEl = mustEl("status", (el): el is HTMLElement => el instanceof HTMLElement);
const economyEl = mustEl("economy", (el): el is HTMLElement => el instanceof HTMLElement);
const singlesEl = mustEl("singles", (el): el is HTMLInputElement => el instanceof HTMLInputElement);
const missilesEl = mustEl("missiles", (el): el is HTMLInputElement => el instanceof HTMLInputElement);
const restartEl = mustEl("restart", (el): el is HTMLButtonElement => el instanceof HTMLButtonElement);
const pauseEl = mustEl("pause", (el): el is HTMLButtonElement => el instanceof HTMLButtonElement);

const isMobile = isMobileDevice();
const engine = new Engine(canvas, !isMobile, {
  preserveDrawingBuffer: false,
  stencil: false,
  adaptToDeviceRatio: true,
  powerPreference: isMobile ? "low-power" : "high-performance",
});
applyMobilePixelCap(engine);
if (isMobile) engine.maxFPS = MOBILE_TARGET_FPS;

let paused = false;
let currentPlan: EncounterPlan | null = null;
let fightOver = false;

const world = createBalanceWorld(engine, canvas, {
  onOutcome: (winner, elapsedSec) => {
    fightOver = true;
    const t = elapsedSec.toFixed(1);
    statusEl.classList.remove("is-blue", "is-red");
    if (winner === "draw") {
      statusEl.textContent = `Draw in ${t}s`;
      return;
    }
    statusEl.classList.add(winner === "blue" ? "is-blue" : "is-red");
    statusEl.textContent = `${winner === "blue" ? "Blue" : "Red"} wins in ${t}s`;
  },
  onTick: ({ elapsedSec, livingBlue, livingRed }) => {
    if (fightOver) return;
    statusEl.classList.remove("is-blue", "is-red");
    statusEl.textContent = `${elapsedSec.toFixed(1)}s · ${livingBlue} blue vs ${livingRed} red`;
  },
});

function kindsFromTeam(team: "blue" | "red"): CombatUnitKind[] {
  const boxes = document.querySelectorAll<HTMLInputElement>(
    `input[data-team="${team}"]`,
  );
  const kinds: CombatUnitKind[] = [];
  for (const box of boxes) {
    if (box.checked && COMBAT_UNIT_KINDS.includes(box.value as CombatUnitKind)) {
      kinds.push(box.value as CombatUnitKind);
    }
  }
  return uniqueKinds(kinds);
}

function setTeamChecks(team: "blue" | "red", kinds: readonly CombatUnitKind[]): void {
  const want = new Set(kinds);
  const boxes = document.querySelectorAll<HTMLInputElement>(
    `input[data-team="${team}"]`,
  );
  for (const box of boxes) {
    box.checked = want.has(box.value as CombatUnitKind);
  }
}

function applyPlan(plan: EncounterPlan): void {
  currentPlan = plan;
  const ratio = (plan.balance * 100).toFixed(0);
  planEl.innerHTML =
    `<span class="blue">${formatArmy(plan.blue)}</span>` +
    ` vs ` +
    `<span class="red">${formatArmy(plan.red)}</span>`;
  weightsEl.textContent = singlesEl.checked
    ? "One unit per selected type · weighting off"
    : `Weights ${formatWeight(plan.weightBlue)} vs ${formatWeight(plan.weightRed)}` +
      ` · balance ${ratio}%` +
      (plan.meetsTarget ? ` (≥ ${(BALANCE_TARGET * 100).toFixed(0)}%)` : " — below target");
  world.loadPlan(plan, { missiles: missilesEl.checked });
  fightOver = false;
  statusEl.classList.remove("is-blue", "is-red");
  statusEl.textContent = "Fighting…";
}

function reloadFromUi(): void {
  const blue = kindsFromTeam("blue");
  const red = kindsFromTeam("red");
  if (blue.length === 0 || red.length === 0) {
    currentPlan = null;
    fightOver = true;
    planEl.textContent = "Pick at least one unit on each side.";
    weightsEl.textContent = "";
    statusEl.classList.remove("is-blue", "is-red");
    statusEl.textContent = "Idle";
    return;
  }
  const plan = singlesEl.checked
    ? planOnePerKind(blue, red)
    : solveEncounter(blue, red);
  if (!plan) {
    planEl.textContent = "No integer mix found.";
    return;
  }
  applyPlan(plan);
}

function selectPreset(id: string): void {
  const preset = ENCOUNTER_PRESETS.find((p) => p.id === id);
  if (!preset) return;
  encounterEl.value = preset.id;
  setTeamChecks("blue", preset.blue);
  setTeamChecks("red", preset.red);
  reloadFromUi();
}

for (const preset of ENCOUNTER_PRESETS) {
  const opt = document.createElement("option");
  opt.value = preset.id;
  opt.textContent = preset.label;
  encounterEl.appendChild(opt);
}
const customOpt = document.createElement("option");
customOpt.value = "custom";
customOpt.textContent = "Custom mix";
encounterEl.appendChild(customOpt);

encounterEl.addEventListener("change", () => {
  if (encounterEl.value === "custom") {
    reloadFromUi();
    return;
  }
  selectPreset(encounterEl.value);
});

for (const box of document.querySelectorAll<HTMLInputElement>("input[data-team]")) {
  box.addEventListener("change", () => {
    encounterEl.value = "custom";
    reloadFromUi();
  });
}

singlesEl.addEventListener("change", () => {
  reloadFromUi();
});

missilesEl.addEventListener("change", () => {
  if (currentPlan) applyPlan(currentPlan);
});

restartEl.addEventListener("click", () => {
  fightOver = false;
  statusEl.classList.remove("is-blue", "is-red");
  statusEl.textContent = "Fighting…";
  world.restart();
});

pauseEl.addEventListener("click", () => {
  paused = !paused;
  world.setPaused(paused);
  pauseEl.textContent = paused ? "Resume" : "Pause";
});

for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
  btn.addEventListener("click", () => {
    const mul = Number(btn.dataset.speed);
    if (!Number.isFinite(mul)) return;
    world.setSpeed(mul);
    for (const other of document.querySelectorAll<HTMLButtonElement>("[data-speed]")) {
      other.classList.toggle("is-on", other === btn);
    }
  });
}

economyEl.replaceChildren();
for (const kind of COMBAT_UNIT_KINDS) {
  const dt = document.createElement("dt");
  dt.textContent = UNIT_LABEL[kind];
  const dd = document.createElement("dd");
  const building = UNIT_TO_BUILDING[kind];
  const interval = spawnIntervalForUnit(kind);
  dd.textContent =
    `${BUILDING_LABEL[building]} ${BUILDING_COST[building]} · ` +
    `${interval}s spawn · weight ${formatWeight(unitProductionWeight(kind))}`;
  economyEl.append(dt, dd);
}

let loopActive = false;
function startRenderLoop(): void {
  if (loopActive || document.hidden) return;
  loopActive = true;
  engine.runRenderLoop(() => {
    world.scene.render();
  });
}
function stopRenderLoop(): void {
  if (!loopActive) return;
  loopActive = false;
  engine.stopRenderLoop();
}

startRenderLoop();
selectPreset("rifle-tank");

const onResize = () => {
  engine.resize();
  applyMobilePixelCap(engine);
};
window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", onResize);
document.addEventListener("visibilitychange", () => {
  if (document.hidden) stopRenderLoop();
  else startRenderLoop();
});
