import { Engine } from "@babylonjs/core";
import { createGameWorld } from "./game/createGameWorld";
import { showOnboarding } from "./ui/onboarding";

const canvas = document.getElementById("renderCanvas");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Missing #renderCanvas");
}

const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
  adaptToDeviceRatio: true,
});

const game = createGameWorld(engine, canvas);
game.setPaused(true);

showOnboarding({
  onDismiss: () => game.setPaused(false),
});

engine.runRenderLoop(() => {
  game.scene.render();
});

const onResize = () => engine.resize();
window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", onResize);

document.addEventListener("visibilitychange", () => {
  if (document.hidden) engine.stopRenderLoop();
  else {
    engine.runRenderLoop(() => {
      game.scene.render();
    });
  }
});
