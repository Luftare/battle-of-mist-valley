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

engine.runRenderLoop(() => {
  lab.scene.render();
});

const onResize = () => engine.resize();
window.addEventListener("resize", onResize);
window.addEventListener("orientationchange", onResize);

// Pause when tab hidden (mobile battery)
document.addEventListener("visibilitychange", () => {
  if (document.hidden) engine.stopRenderLoop();
  else {
    engine.runRenderLoop(() => {
      lab.scene.render();
    });
  }
});
