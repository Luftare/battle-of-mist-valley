import { Engine } from "@babylonjs/core";
import { createGameWorld, type GameWorld } from "./game/createGameWorld";
import { createOnboardingWorld } from "./game/createOnboardingWorld";
import {
  applyMobilePixelCap,
  isMobileDevice,
  MOBILE_TARGET_FPS,
} from "./platform/mobile";
import { staticThumbMap } from "./thumbs";
import { showBuildIntro } from "./ui/buildIntro";
import { showOnboarding } from "./ui/onboarding";

const canvas = document.getElementById("renderCanvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Missing #renderCanvas");
}

const hudEl = document.getElementById("hud");
if (hudEl) hudEl.hidden = true;

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
let activeScene: { render: () => void } | null = null;
let game: GameWorld | null = null;

function startRenderLoop(): void {
  if (loopActive || document.hidden) return;
  if (game && gamePaused) return;
  if (!activeScene) return;
  loopActive = true;
  engine.runRenderLoop(() => {
    activeScene?.render();
  });
}

function stopRenderLoop(): void {
  if (!loopActive) return;
  loopActive = false;
  engine.stopRenderLoop();
}

const onboarding = createOnboardingWorld(engine, canvas);
activeScene = onboarding.scene;
gamePaused = false; // onboarding always renders
startRenderLoop();

showOnboarding({
  onDismiss: () => {
    stopRenderLoop();
    onboarding.dispose();

    game = createGameWorld(engine, canvas);
    game.setThumbs(staticThumbMap());
    game.beginIntro();
    activeScene = game.scene;

    const baseSetPaused = game.setPaused.bind(game);
    game.setPaused = (paused: boolean) => {
      gamePaused = paused;
      baseSetPaused(paused);
      if (paused) stopRenderLoop();
      else startRenderLoop();
    };

    if (hudEl) hudEl.hidden = false;
    game.setPaused(false);

    showBuildIntro({
      onConfirm: () => {
        game?.confirmIntro();
      },
    });
  },
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
  if (!game || !gamePaused) startRenderLoop();
});
