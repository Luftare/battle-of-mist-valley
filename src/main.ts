import { Engine } from "@babylonjs/core";
import { createLabWorld } from "./lab/createLabWorld";

const canvas = document.getElementById("renderCanvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Missing #renderCanvas");
}

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
  adaptToDeviceRatio: true,
});

const lab = createLabWorld(engine, canvas);

const btnOpenFireEl = document.getElementById("btnOpenFire");
const btnCeaseFireEl = document.getElementById("btnCeaseFire");
const btnRedAdvanceEl = document.getElementById("btnRedAdvance");
const btnDestroyAllEl = document.getElementById("btnDestroyAll");
if (
  !(btnOpenFireEl instanceof HTMLButtonElement) ||
  !(btnCeaseFireEl instanceof HTMLButtonElement) ||
  !(btnRedAdvanceEl instanceof HTMLButtonElement) ||
  !(btnDestroyAllEl instanceof HTMLButtonElement)
) {
  throw new Error("Missing control buttons");
}
const btnOpenFire: HTMLButtonElement = btnOpenFireEl;
const btnCeaseFire: HTMLButtonElement = btnCeaseFireEl;
const btnRedAdvance: HTMLButtonElement = btnRedAdvanceEl;
const btnDestroyAll: HTMLButtonElement = btnDestroyAllEl;

function setCombatUi(active: boolean): void {
  btnOpenFire.classList.toggle("is-active", active);
  btnCeaseFire.disabled = !active;
}

function setRedAdvanceUi(state: "home" | "marching" | "halfway"): void {
  const away = state !== "home";
  btnRedAdvance.classList.toggle("is-active", away);
  btnRedAdvance.textContent = away ? "Reset Red" : "Red Advance";
}

btnCeaseFire.disabled = true;

btnOpenFire.addEventListener("click", (event) => {
  event.preventDefault();
  lab.setCombat(true);
  setCombatUi(true);
});

btnCeaseFire.addEventListener("click", (event) => {
  event.preventDefault();
  lab.setCombat(false);
  setCombatUi(false);
});

btnRedAdvance.addEventListener("click", (event) => {
  event.preventDefault();
  const state = lab.toggleRedAdvance();
  setRedAdvanceUi(state === "marching" ? "marching" : "home");
});

btnDestroyAll.addEventListener("click", (event) => {
  event.preventDefault();
  lab.destroyAll();
  lab.setCombat(false);
  setCombatUi(false);
  setRedAdvanceUi("home");
  btnDestroyAll.classList.add("is-active");
  btnDestroyAll.disabled = true;
});

engine.runRenderLoop(() => {
  lab.scene.render();
});

const onResize = () => engine.resize();
window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", onResize);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) engine.stopRenderLoop();
  else {
    engine.runRenderLoop(() => {
      lab.scene.render();
    });
  }
});
