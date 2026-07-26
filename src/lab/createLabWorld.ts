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
import { createTerrain } from "../terrain/createTerrain";
import {
  createHelicopter,
  createRifleman,
  createTank,
  type UnitHandle,
} from "../units";
import type { Team } from "../theme/colors";

export interface LabWorld {
  scene: Scene;
  dispose: () => void;
}

/**
 * Lab view: meadow battlefield with one blue + one red of each unit type.
 * Angled top-down (bird's-eye) camera, mobile-friendly orbit controls.
 */
export function createLabWorld(engine: Engine, canvas: HTMLCanvasElement): LabWorld {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.55, 0.72, 0.88, 1);
  scene.ambientColor = new Color3(0.35, 0.4, 0.32);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(0.62, 0.75, 0.88);
  scene.fogStart = 28;
  scene.fogEnd = 55;

  // Bird's-eye angled top-down
  const camera = new ArcRotateCamera(
    "labCamera",
    -Math.PI / 2.4,
    0.95,
    22,
    new Vector3(0, 0.5, 0),
    scene,
  );
  camera.lowerBetaLimit = 0.45;
  camera.upperBetaLimit = 1.25;
  camera.lowerRadiusLimit = 12;
  camera.upperRadiusLimit = 38;
  camera.wheelPrecision = 40;
  camera.pinchPrecision = 80;
  camera.panningSensibility = 80;
  camera.attachControl(canvas, true);
  // Prefer orbit over pan on touch
  camera.useInputToRestoreState = false;

  // Soft daylight
  const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.3), scene);
  hemi.intensity = 0.75;
  hemi.groundColor = new Color3(0.25, 0.28, 0.18);
  hemi.diffuse = new Color3(0.95, 0.95, 0.88);

  const sun = new DirectionalLight("sun", new Vector3(-0.45, -0.85, -0.3), scene);
  sun.position = new Vector3(12, 22, 10);
  sun.intensity = 0.85;
  sun.diffuse = new Color3(1, 0.97, 0.9);

  const terrain = createTerrain(scene, 36);

  const units: UnitHandle[] = [];

  // Layout: blue team on -X, red on +X; units small relative to terrain
  const placements: { kind: "rifleman" | "tank" | "helicopter"; team: Team; x: number; z: number; rotY: number }[] = [
    { kind: "rifleman", team: "blue", x: -4.5, z: 2.5, rotY: Math.PI / 2 },
    { kind: "rifleman", team: "red", x: 4.5, z: 2.5, rotY: -Math.PI / 2 },
    { kind: "tank", team: "blue", x: -4.5, z: -1.5, rotY: Math.PI / 2 },
    { kind: "tank", team: "red", x: 4.5, z: -1.5, rotY: -Math.PI / 2 },
    { kind: "helicopter", team: "blue", x: -3.2, z: -4.5, rotY: Math.PI / 2 },
    { kind: "helicopter", team: "red", x: 3.2, z: -4.5, rotY: -Math.PI / 2 },
  ];

  for (const p of placements) {
    const name = `${p.team}_${p.kind}`;
    let unit: UnitHandle;
    if (p.kind === "rifleman") unit = createRifleman(scene, name, p.team);
    else if (p.kind === "tank") unit = createTank(scene, name, p.team);
    else unit = createHelicopter(scene, name, p.team);

    unit.root.position.x = p.x;
    unit.root.position.z = p.z;
    unit.root.rotation.y = p.rotY;
    // Scale units down for bird's-eye feel
    unit.root.scaling.setAll(0.85);
    units.push(unit);
  }

  let elapsed = 0;
  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    elapsed += dt;
    terrain.update(dt, elapsed);
    for (const unit of units) unit.update(dt, elapsed);
  });

  return {
    scene,
    dispose: () => {
      for (const unit of units) unit.dispose();
      terrain.dispose();
      scene.dispose();
    },
  };
}
