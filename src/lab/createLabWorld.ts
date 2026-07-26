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
import {
  createBarracks,
  createFactory,
  createHelipad,
  type BuildingHandle,
} from "../buildings";
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
  setCombat: (active: boolean) => void;
  /** Advance red team halfway toward blue, or reset them if already advanced. */
  toggleRedAdvance: () => "marching" | "home";
  getRedAdvanceState: () => "home" | "marching" | "halfway";
  /** Trigger randomized destruction on every living unit. */
  destroyAll: () => void;
  dispose: () => void;
}

interface Placement {
  kind: "rifleman" | "tank" | "helicopter";
  team: Team;
  x: number;
  z: number;
  rotY: number;
}

interface RedMarcher {
  unit: UnitHandle;
  homeX: number;
  homeZ: number;
  targetX: number;
  targetZ: number;
  speed: number;
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
  camera.useInputToRestoreState = false;

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
  const buildings: BuildingHandle[] = [];
  const placements: Placement[] = [
    { kind: "rifleman", team: "blue", x: -4.5, z: 2.5, rotY: Math.PI / 2 },
    { kind: "rifleman", team: "red", x: 4.5, z: 2.5, rotY: -Math.PI / 2 },
    { kind: "tank", team: "blue", x: -4.5, z: -1.5, rotY: Math.PI / 2 },
    { kind: "tank", team: "red", x: 4.5, z: -1.5, rotY: -Math.PI / 2 },
    { kind: "helicopter", team: "blue", x: -3.2, z: -4.5, rotY: Math.PI / 2 },
    { kind: "helicopter", team: "red", x: 3.2, z: -4.5, rotY: -Math.PI / 2 },
  ];

  /** Buildings sit just outside their unit on each flank, facing the field. */
  const buildingPlacements: Array<{
    kind: Placement["kind"];
    team: Team;
    x: number;
    z: number;
    rotY: number;
  }> = [
    { kind: "rifleman", team: "blue", x: -7.3, z: 2.5, rotY: Math.PI / 2 },
    { kind: "rifleman", team: "red", x: 7.3, z: 2.5, rotY: -Math.PI / 2 },
    { kind: "tank", team: "blue", x: -7.5, z: -1.5, rotY: Math.PI / 2 },
    { kind: "tank", team: "red", x: 7.5, z: -1.5, rotY: -Math.PI / 2 },
    { kind: "helicopter", team: "blue", x: -6.4, z: -4.6, rotY: Math.PI / 2 },
    { kind: "helicopter", team: "red", x: 6.4, z: -4.6, rotY: -Math.PI / 2 },
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
    unit.root.scaling.setAll(0.85);
    units.push(unit);
  }

  for (const p of buildingPlacements) {
    const name = `${p.team}_${p.kind}_building`;
    let building: BuildingHandle;
    if (p.kind === "rifleman") building = createBarracks(scene, name, p.team);
    else if (p.kind === "tank") building = createFactory(scene, name, p.team);
    else building = createHelipad(scene, name, p.team);

    building.root.position.x = p.x;
    building.root.position.z = p.z;
    building.root.rotation.y = p.rotY;
    building.root.scaling.setAll(0.9);
    buildings.push(building);
  }

  const blueByKind = new Map(
    units.filter((u) => u.team === "blue").map((u) => [u.kind, u] as const),
  );

  const marchSpeeds: Record<string, number> = {
    rifleman: 0.85,
    tank: 1.15,
    helicopter: 1.3,
  };

  const redMarchers: RedMarcher[] = units
    .filter((u) => u.team === "red")
    .map((unit) => {
      const blue = blueByKind.get(unit.kind);
      const homeX = unit.root.position.x;
      const homeZ = unit.root.position.z;
      const blueX = blue?.root.position.x ?? 0;
      const blueZ = blue?.root.position.z ?? homeZ;
      return {
        unit,
        homeX,
        homeZ,
        targetX: (homeX + blueX) * 0.5,
        targetZ: (homeZ + blueZ) * 0.5,
        speed: marchSpeeds[unit.kind] ?? 1.8,
      };
    });

  let redAdvanceState: "home" | "marching" | "halfway" = "home";

  function resetRedTeam(): void {
    for (const m of redMarchers) {
      m.unit.setMoving(false);
      m.unit.root.position.x = m.homeX;
      m.unit.root.position.z = m.homeZ;
    }
    redAdvanceState = "home";
  }

  function startRedMarch(): void {
    for (const m of redMarchers) m.unit.setMoving(true);
    redAdvanceState = "marching";
  }

  let elapsed = 0;
  scene.onBeforeRenderObservable.add(() => {
    const dt = engine.getDeltaTime() / 1000;
    elapsed += dt;
    terrain.update(dt, elapsed);
    for (const building of buildings) building.update(dt, elapsed);

    if (redAdvanceState === "marching") {
      let allArrived = true;
      for (const m of redMarchers) {
        const pos = m.unit.root.position;
        const dx = m.targetX - pos.x;
        const dz = m.targetZ - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.04) {
          pos.x = m.targetX;
          pos.z = m.targetZ;
          m.unit.setMoving(false);
        } else {
          allArrived = false;
          const step = Math.min(dist, m.speed * dt);
          pos.x += (dx / dist) * step;
          pos.z += (dz / dist) * step;
        }
      }
      if (allArrived) redAdvanceState = "halfway";
    }

    for (const unit of units) unit.update(dt, elapsed);
  });

  return {
    scene,
    setCombat: (active) => {
      for (const unit of units) {
        unit.setCombat(active);
        if (unit.kind === "helicopter") {
          const enemyTank = active
            ? units.find(
                (u) =>
                  u.kind === "tank" &&
                  u.team !== unit.team &&
                  !u.destroyed,
              ) ?? null
            : null;
          unit.setAimTarget(enemyTank);
        } else {
          unit.setAimTarget(null);
        }
      }
    },
    toggleRedAdvance: () => {
      if (redAdvanceState === "home") {
        startRedMarch();
        return "marching";
      }
      resetRedTeam();
      return "home";
    },
    getRedAdvanceState: () => redAdvanceState,
    destroyAll: () => {
      redAdvanceState = "home";
      for (const m of redMarchers) m.unit.setMoving(false);
      for (const unit of units) {
        if (!unit.destroyed) {
          // Slight stagger so they don't all pop identically
          const delay = Math.random() * 0.25;
          if (delay < 0.02) unit.destroy();
          else {
            window.setTimeout(() => {
              if (!unit.destroyed) unit.destroy();
            }, delay * 1000);
          }
        }
      }
    },
    dispose: () => {
      for (const unit of units) unit.dispose();
      for (const building of buildings) building.dispose();
      terrain.dispose();
      scene.dispose();
    },
  };
}
