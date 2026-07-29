import { Engine } from "@babylonjs/core";
import { createGameWorld } from "./game/createGameWorld";
import {
  applyMobilePixelCap,
  isMobileDevice,
  MOBILE_TARGET_FPS,
} from "./platform/mobile";
import { showOnboarding } from "./ui/onboarding";

const canvas = document.getElementById("renderCanvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Missing #renderCanvas");
}

const isMobile = isMobileDevice();
const engine = new Engine(canvas, !isMobile, {
  preserveDrawingBuffer: false,
  stencil: false,
  adaptToDeviceRatio: true,
  powerPreference: isMobile ? "low-power" : "high-performance",
});
applyMobilePixelCap(engine);
// Engine-level cap: skips frames before beginFrame so getDeltaTime stays wall-clock accurate.
if (isMobile) engine.maxFPS = MOBILE_TARGET_FPS;

let loopActive = false;
let gamePaused = true;

const game = createGameWorld(engine, canvas);
const baseSetPaused = game.setPaused.bind(game);
game.setPaused = (paused: boolean) => {
  gamePaused = paused;
  baseSetPaused(paused);
  if (paused) stopRenderLoop();
  else startRenderLoop();
};

function startRenderLoop(): void {
  if (loopActive || document.hidden || gamePaused) return;
  loopActive = true;
  engine.runRenderLoop(() => {
    game.scene.render();
  });
}

function stopRenderLoop(): void {
  if (!loopActive) return;
  loopActive = false;
  engine.stopRenderLoop();
}

game.setPaused(true);

showOnboarding({
  onDismiss: () => game.setPaused(false),
});

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

window.addEventListener("pagehide", stopRenderLoop);
window.addEventListener("pageshow", () => {
  if (!gamePaused) startRenderLoop();
});
