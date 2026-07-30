import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Scene,
  Vector3,
} from "@babylonjs/core";
import { createCaptureFlag } from "../buildings/captureFlag";
import { createTerrain } from "../terrain/createTerrain";
import { clearMaterialCache } from "../theme/materials";
import { createRifleman, createTank, type UnitHandle } from "../units";
import { approach } from "../units/types";
import { PLAY_DEPTH, PLAY_WIDTH } from "./stats";

export interface OnboardingWorld {
  scene: Scene;
  dispose: () => void;
}

interface ShowcaseUnit {
  unit: UnitHandle;
}

/**
 * Title-screen vignette: close-up of the hill flag with a tank and riflemen idling.
 * Camera drifts on a slow looping path — alive, not cinematic.
 */
export function createOnboardingWorld(
  engine: Engine,
  _canvas: HTMLCanvasElement,
): OnboardingWorld {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.55, 0.72, 0.88, 1);
  scene.ambientColor = new Color3(0.35, 0.4, 0.32);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(0.62, 0.75, 0.88);
  scene.fogStart = 18;
  scene.fogEnd = 42;

  const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.3), scene);
  hemi.intensity = 0.78;
  hemi.groundColor = new Color3(0.25, 0.28, 0.18);
  hemi.diffuse = new Color3(0.95, 0.95, 0.88);

  const sun = new DirectionalLight("sun", new Vector3(-0.45, -0.85, -0.3), scene);
  sun.position = new Vector3(12, 22, 10);
  sun.intensity = 0.88;
  sun.diffuse = new Color3(1, 0.97, 0.9);

  // Full playfield so the hill matches the real match (trees/rocks at distance)
  const terrain = createTerrain(scene, PLAY_WIDTH, PLAY_DEPTH);
  const captureFlag = createCaptureFlag(scene, terrain.getGroundYAt);
  captureFlag.setOwner("blue");

  const peakY = terrain.getGroundYAt(0, 0);
  const BASE_ALPHA = Math.PI + Math.PI / 2.6;
  const BASE_BETA = 1.08;
  const BASE_RADIUS = 10.5;
  const targetBase = new Vector3(0.15, peakY + 1.05, -0.35);

  const camera = new ArcRotateCamera(
    "onboardCamera",
    BASE_ALPHA,
    BASE_BETA,
    BASE_RADIUS,
    targetBase.clone(),
    scene,
  );
  camera.lowerAlphaLimit = null;
  camera.upperAlphaLimit = null;
  camera.lowerBetaLimit = 0.2;
  camera.upperBetaLimit = Math.PI / 2;
  camera.lowerRadiusLimit = 4;
  camera.upperRadiusLimit = 40;
  // No user control — path is scripted
  camera.inputs.clear();

  const placements: Array<{
    kind: "rifleman" | "tank";
    x: number;
    z: number;
    rotY: number;
  }> = [
    { kind: "tank", x: 1.65, z: -1.35, rotY: -0.55 },
    { kind: "rifleman", x: -1.55, z: -2.15, rotY: 0.35 },
    { kind: "rifleman", x: 0.15, z: -2.85, rotY: -0.05 },
  ];

  const showcase: ShowcaseUnit[] = [];
  for (let i = 0; i < placements.length; i++) {
    const p = placements[i];
    const unit =
      p.kind === "tank"
        ? createTank(scene, `onboard_tank_${i}`, "blue")
        : createRifleman(scene, `onboard_rifle_${i}`, "blue");
    unit.root.position.x = p.x;
    unit.root.position.z = p.z;
    unit.root.position.y = terrain.getGroundYAt(p.x, p.z);
    unit.root.rotation.y = p.rotY;
    unit.root.scaling.setAll(0.85);
    unit.setCombat(false);
    unit.setMoving(false);
    showcase.push({ unit });
  }

  let elapsed = 0;
  const tiltSpeed = 2.8;
  const camTarget = targetBase.clone();

  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    elapsed += dt;
    terrain.update(dt, elapsed);
    captureFlag.update(dt, elapsed);

    for (const { unit } of showcase) {
      unit.update(dt, elapsed);
      if (unit.destroyed) continue;
      const { x, z } = unit.root.position;
      unit.root.position.y = terrain.getGroundYAt(x, z);
      if (unit.kind === "tank") {
        const tilt = terrain.getGroundTiltAt(x, z, unit.root.rotation.y);
        const maxStep = tiltSpeed * dt;
        unit.root.rotation.x = approach(unit.root.rotation.x, tilt.pitch, maxStep);
        unit.root.rotation.z = approach(unit.root.rotation.z, tilt.roll, maxStep);
      }
    }

    // Slow multi-sine drift — loops naturally, never reads as a cut
    const t = elapsed;
    camera.alpha =
      BASE_ALPHA +
      Math.sin(t * 0.11) * 0.09 +
      Math.sin(t * 0.047) * 0.05;
    camera.beta =
      BASE_BETA + Math.sin(t * 0.085) * 0.032 + Math.sin(t * 0.13) * 0.012;
    camera.radius =
      BASE_RADIUS + Math.sin(t * 0.07) * 0.38 + Math.sin(t * 0.19) * 0.12;

    camTarget.x = targetBase.x + Math.sin(t * 0.055) * 0.18;
    camTarget.y = targetBase.y + Math.sin(t * 0.095) * 0.07;
    camTarget.z = targetBase.z + Math.cos(t * 0.055) * 0.14;
    camera.setTarget(camTarget);
  });

  return {
    scene,
    dispose: () => {
      for (const { unit } of showcase) unit.dispose();
      captureFlag.dispose();
      terrain.dispose();
      scene.dispose();
      // Mats were created for this scene — drop cache so the match gets fresh ones
      clearMaterialCache();
    },
  };
}
