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

const targetFrameMs = isMobile ? 1000 / MOBILE_TARGET_FPS : 0;
let lastFrameTime = 0;
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

function renderFrame(): void {
  if (targetFrameMs > 0) {
    const now = performance.now();
    if (now - lastFrameTime < targetFrameMs) return;
    lastFrameTime = now;
  }
  game.scene.render();
}

function startRenderLoop(): void {
  if (loopActive || document.hidden || gamePaused) return;
  loopActive = true;
  lastFrameTime = 0;
  engine.runRenderLoop(renderFrame);
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
