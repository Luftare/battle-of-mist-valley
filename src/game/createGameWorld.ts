import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  Vector3,
} from "@babylonjs/core";
import {
  createPlatform,
  createTurret,
  type PlatformHandle,
  type TurretHandle,
} from "../buildings";
import { createCaptureFlag } from "../buildings/captureFlag";
import { createHpBar, type HpBarHandle } from "./hpBar";
import { createMatchView, type ViewSlot } from "./matchView";
import type { ThumbMap } from "../thumbs/types";
import {
  PLAY_WIDTH,
  PLAY_DEPTH,
  SLOT_COUNT,
  TURRETS_PER_TEAM,
  TURRET_FORWARD_FROM_BASE,
} from "./stats";
import { createHud } from "../ui/hud";
import { showWaitingForPeer } from "../ui/buildIntro";
import { createLocalDriver, type MatchDriver } from "../sim/driver";
import { createCoinPopupFx } from "../fx/coinPopup";
import { createTerrain } from "../terrain/createTerrain";
import { type Team } from "../theme/colors";
import { shortestAngleDelta } from "../units/types";

const CLICK_DRAG_PX = 12;

export interface GameWorldOpts {
  driver?: MatchDriver;
}

export interface GameWorld {
  scene: Scene;
  setPaused: (paused: boolean) => void;
  setThumbs: (thumbs: ThumbMap) => void;
  beginIntro: () => void;
  confirmIntro: (onComplete?: () => void) => void;
  dispose: () => void;
}

/**
 * Auto battler arena: Babylon view driven by a MatchDriver (local sim or remote).
 */
export function createGameWorld(
  engine: Engine,
  canvas: HTMLCanvasElement,
  opts?: GameWorldOpts,
): GameWorld {
  const driver = opts?.driver ?? createLocalDriver();
  const localTeam: Team = driver.localTeam;

  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.55, 0.72, 0.88, 1);
  scene.ambientColor = new Color3(0.35, 0.4, 0.32);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(0.62, 0.75, 0.88);
  scene.fogStart = 30;
  scene.fogEnd = 50;

  const halfX = PLAY_WIDTH * 0.5;
  const halfZ = PLAY_DEPTH * 0.5;
  const buildingZ = halfZ - 2.4;

  const towardEnemy: 1 | -1 = localTeam === "red" ? -1 : 1;
  const CAM_ALPHA =
    localTeam === "red" ? Math.PI / 3 : Math.PI + Math.PI / 3;
  const CAM_BETA = 0.95;
  const CAM_RADIUS = 42;
  const INTRO_ALPHA =
    localTeam === "red" ? Math.PI / 5.5 : Math.PI + Math.PI / 5.5;
  const INTRO_BETA = 1.05;
  const INTRO_RADIUS = 26;
  const INTRO_TARGET = new Vector3(
    towardEnemy * halfX * 0.22,
    0.55,
    towardEnemy * (-buildingZ + 0.6),
  );
  const CAM_TARGET_Y = 0.4;
  const playerFrontlineZ =
    towardEnemy * -(buildingZ - TURRET_FORWARD_FROM_BASE);
  const PLAY_TARGET = new Vector3(0, CAM_TARGET_Y, playerFrontlineZ);
  const INTRO_EASE_SEC = 2.25;

  const camera = new ArcRotateCamera(
    "gameCamera",
    CAM_ALPHA,
    CAM_BETA,
    CAM_RADIUS,
    PLAY_TARGET.clone(),
    scene,
  );
  camera.lowerAlphaLimit = CAM_ALPHA;
  camera.upperAlphaLimit = CAM_ALPHA;
  camera.lowerBetaLimit = CAM_BETA;
  camera.upperBetaLimit = CAM_BETA;
  camera.lowerRadiusLimit = CAM_RADIUS;
  camera.upperRadiusLimit = CAM_RADIUS;
  camera.panningAxis = new Vector3(1, 0, 1);
  camera.mapPanning = true;
  camera.panningSensibility = 55;
  camera.panningInertia = 0.6;
  camera.panningDistanceLimit = 0;
  camera.attachControl(true, false, 0);
  camera.inputs.removeByType("ArcRotateCameraMouseWheelInput");
  camera.useInputToRestoreState = false;

  const CAM_PEEK_LIMIT = 7.5;
  const CAM_RETURN_RATE = 4.0;
  const CAM_FRONT_ADVANCE_RATE = 10;
  const CAM_FRONT_RETREAT_RATE = 1.65;
  const CAM_FOLLOW_SMOOTH_TIME = 0.75;
  const CAM_FOLLOW_MAX_SPEED = 16;
  const CAM_FOLLOW_RETREAT_DEADZONE = 1.35;
  const CAM_PEEK_FOLLOW_ARM = 0.2;
  const CAM_FOLLOW_CANCEL_DELTA = 0.04;
  const CAM_LIM_X = halfX - 2.2;
  const CAM_MIN_ALONG = -buildingZ - 2.5;
  const alongOf = (z: number) => towardEnemy * z;
  const zOfAlong = (along: number) => towardEnemy * along;
  let smoothedFrontAlong = alongOf(playerFrontlineZ);
  let camLogicalAlong: number | null = null;
  let lastDisplayedAlong = alongOf(PLAY_TARGET.z);
  let camFollow = false;
  let camFollowVel = 0;

  const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.3), scene);
  hemi.intensity = 0.75;
  hemi.groundColor = new Color3(0.25, 0.28, 0.18);
  hemi.diffuse = new Color3(0.95, 0.95, 0.88);

  const sun = new DirectionalLight("sun", new Vector3(-0.45, -0.85, -0.3), scene);
  sun.position = new Vector3(12, 22, 10);
  sun.intensity = 0.85;
  sun.diffuse = new Color3(1, 0.97, 0.9);

  const terrain = createTerrain(scene, PLAY_WIDTH, PLAY_DEPTH);
  const captureFlag = createCaptureFlag(scene, terrain.getGroundYAt);
  const slots: ViewSlot[] = [];
  const turrets: TurretHandle[] = [];
  const turretHpBars: HpBarHandle[] = [];
  const hud = createHud();
  const coinFx = createCoinPopupFx();

  let gameOver = false;
  let introActive = false;
  let introEasing: {
    elapsed: number;
    fromAlpha: number;
    fromBeta: number;
    fromRadius: number;
    fromTarget: Vector3;
    onComplete?: () => void;
  } | null = null;
  let elapsed = 0;

  const xMin = -halfX + 2.2;
  const xMax = halfX - 2.2;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const t = i / Math.max(1, SLOT_COUNT - 1);
    const x = xMin + (xMax - xMin) * t;
    for (const team of ["blue", "red"] as const) {
      const z = team === "blue" ? -buildingZ : buildingZ;
      const rotY = team === "blue" ? 0 : Math.PI;
      const surfaceY = terrain.getGroundYAt(x, z);
      const platform: PlatformHandle = createPlatform(
        scene,
        `${team}_pad_${i}`,
        team,
        i,
      );
      platform.root.position.x = x;
      platform.root.position.z = z;
      platform.root.position.y = surfaceY;

      const pickProxy = MeshBuilder.CreateBox(
        `${team}_pick_${i}`,
        { width: 2.8, height: 1.6, depth: 2.6 },
        scene,
      );
      pickProxy.parent = platform.root;
      pickProxy.position.set(0, 0.7, 0);
      pickProxy.visibility = 0;
      pickProxy.isPickable = true;

      slots.push({
        team,
        index: i,
        x,
        z,
        rotY,
        surfaceY,
        platform,
        pickProxy,
      });
    }
  }

  for (const team of ["blue", "red"] as const) {
    const zSign = team === "blue" ? -1 : 1;
    const tz = zSign * (buildingZ - TURRET_FORWARD_FROM_BASE);
    for (let i = 0; i < TURRETS_PER_TEAM; i++) {
      const t = (i + 0.5) / TURRETS_PER_TEAM;
      const tx = xMin + (xMax - xMin) * t;
      const label =
        i === 0 ? "W" : i === TURRETS_PER_TEAM - 1 ? "E" : `M${i}`;
      const turret = createTurret(scene, `${team}_turret_${label}`, team);
      turret.root.position.x = tx;
      turret.root.position.z = tz;
      turret.root.position.y = terrain.getGroundYAtFootprint(tx, tz, 2.1 * 0.5 * 0.9);
      turret.root.scaling.setAll(0.9);
      turrets.push(turret);
      const hpBar = createHpBar(scene, turret.root.name);
      hpBar.setRatio(1);
      turretHpBars.push(hpBar);
    }
  }

  const pickToSlot = new Map<number, ViewSlot>();
  for (const slot of slots) {
    pickToSlot.set(slot.pickProxy.uniqueId, slot);
    pickToSlot.set(slot.platform.pickMesh.uniqueId, slot);
  }

  const view = createMatchView({
    scene,
    terrain,
    hud,
    coinFx,
    captureFlag,
    slots,
    turrets,
    turretHpBars,
    driver,
    getGameOver: () => gameOver,
    setGameOver: (over) => {
      gameOver = over;
    },
  });

  function allyFrontZ(): number {
    return view.allyFrontZ(localTeam, towardEnemy);
  }

  function asymptotePeek(rawOvershoot: number): number {
    if (rawOvershoot <= 0) return 0;
    return (CAM_PEEK_LIMIT * rawOvershoot) / (rawOvershoot + CAM_PEEK_LIMIT);
  }

  function invertAsymptotePeek(displayedOvershoot: number): number {
    if (displayedOvershoot <= 0) return 0;
    const d = Math.min(displayedOvershoot, CAM_PEEK_LIMIT * 0.999);
    return (CAM_PEEK_LIMIT * d) / (CAM_PEEK_LIMIT - d);
  }

  function smoothDampZ(
    current: number,
    target: number,
    smoothTime: number,
    maxSpeed: number,
    dt: number,
  ): number {
    const st = Math.max(0.0001, smoothTime);
    const omega = 2 / st;
    const x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    let change = current - target;
    const maxChange = maxSpeed * st;
    change = Math.max(-maxChange, Math.min(maxChange, change));
    const temp = (camFollowVel + omega * change) * dt;
    camFollowVel = (camFollowVel - omega * temp) * exp;
    let output = current - change + (change + temp) * exp;
    if (target - current > 0 === output > target) {
      output = target;
      camFollowVel = 0;
    }
    return output;
  }

  function updateCameraBounds(dt: number): void {
    const rawFrontAlong = alongOf(allyFrontZ());
    const frontRate =
      rawFrontAlong >= smoothedFrontAlong
        ? CAM_FRONT_ADVANCE_RATE
        : CAM_FRONT_RETREAT_RATE;
    smoothedFrontAlong +=
      (rawFrontAlong - smoothedFrontAlong) * (1 - Math.exp(-frontRate * dt));
    const softMaxAlong = smoothedFrontAlong;

    let x = camera.target.x;
    let along = alongOf(camera.target.z);
    x = Math.max(-CAM_LIM_X, Math.min(CAM_LIM_X, x));

    if (camDragging) {
      const inputDelta = along - lastDisplayedAlong;
      if (camLogicalAlong === null) {
        camLogicalAlong =
          along > softMaxAlong
            ? softMaxAlong + invertAsymptotePeek(along - softMaxAlong)
            : along;
      } else {
        camLogicalAlong += inputDelta;
      }
      camLogicalAlong = Math.max(CAM_MIN_ALONG, camLogicalAlong);

      if (inputDelta < -CAM_FOLLOW_CANCEL_DELTA) {
        camFollow = false;
        camFollowVel = 0;
      }

      if (camLogicalAlong > softMaxAlong) {
        const rawOver = camLogicalAlong - softMaxAlong;
        along = softMaxAlong + asymptotePeek(rawOver);
        if (asymptotePeek(rawOver) >= CAM_PEEK_FOLLOW_ARM) camFollow = true;
        const t = asymptotePeek(rawOver) / CAM_PEEK_LIMIT;
        const keep = Math.max(0.04, 1 - t * t);
        camera.inertialPanningX *= keep;
        camera.inertialPanningY *= keep;
      } else {
        along = camLogicalAlong;
      }
    } else {
      camLogicalAlong = null;
      along = Math.max(CAM_MIN_ALONG, along);

      if (along > softMaxAlong) {
        const overshoot = along - softMaxAlong;
        const holdThroughDip =
          camFollow && overshoot <= CAM_FOLLOW_RETREAT_DEADZONE;
        if (holdThroughDip) {
          camFollowVel = 0;
          camera.inertialPanningX = 0;
          camera.inertialPanningY = 0;
        } else {
          along = softMaxAlong + overshoot * Math.exp(-CAM_RETURN_RATE * dt);
          camera.inertialPanningX = 0;
          camera.inertialPanningY = 0;
          camFollowVel = 0;
        }
      } else if (camFollow) {
        if (softMaxAlong > along + 0.04) {
          along = smoothDampZ(
            along,
            softMaxAlong,
            CAM_FOLLOW_SMOOTH_TIME,
            CAM_FOLLOW_MAX_SPEED,
            dt,
          );
        } else {
          camFollowVel *= Math.exp(-6 * dt);
        }
      }
    }

    camera.target.x = x;
    camera.target.y = CAM_TARGET_Y;
    camera.target.z = zOfAlong(along);
    lastDisplayedAlong = along;
  }

  function easeInOutCubic(t: number): number {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function easeOutCubic(t: number): number {
    return 1 - Math.pow(1 - t, 3);
  }

  function lerpAngle(from: number, to: number, t: number): number {
    return from + shortestAngleDelta(from, to) * t;
  }

  function lockCameraTo(
    alpha: number,
    beta: number,
    radius: number,
    target: Vector3,
  ): void {
    camera.alpha = alpha;
    camera.beta = beta;
    camera.radius = radius;
    camera.target.copyFrom(target);
    camera.lowerAlphaLimit = alpha;
    camera.upperAlphaLimit = alpha;
    camera.lowerBetaLimit = beta;
    camera.upperBetaLimit = beta;
    camera.lowerRadiusLimit = radius;
    camera.upperRadiusLimit = radius;
  }

  function unlockPlayCamera(): void {
    camera.lowerAlphaLimit = CAM_ALPHA;
    camera.upperAlphaLimit = CAM_ALPHA;
    camera.lowerBetaLimit = CAM_BETA;
    camera.upperBetaLimit = CAM_BETA;
    camera.lowerRadiusLimit = CAM_RADIUS;
    camera.upperRadiusLimit = CAM_RADIUS;
    lastDisplayedAlong = alongOf(camera.target.z);
    camLogicalAlong = null;
    camFollow = false;
    camFollowVel = 0;
    smoothedFrontAlong = alongOf(playerFrontlineZ);
  }

  function setPlayerPlatformAttention(on: boolean): void {
    for (const slot of slots) {
      if (slot.team !== localTeam) continue;
      slot.platform.setAttention(on);
    }
  }

  function beginIntro(): void {
    introActive = true;
    introEasing = null;
    camera.detachControl();
    lockCameraTo(INTRO_ALPHA, INTRO_BETA, INTRO_RADIUS, INTRO_TARGET);
    setPlayerPlatformAttention(true);
  }

  let peerWait: { dispose: () => void } | null = null;

  function clearPeerWait(): void {
    peerWait?.dispose();
    peerWait = null;
  }

  function confirmIntro(onComplete?: () => void): void {
    if (!introActive && !introEasing) {
      onComplete?.();
      return;
    }
    setPlayerPlatformAttention(false);
    introActive = false;
    introEasing = {
      elapsed: 0,
      fromAlpha: camera.alpha,
      fromBeta: camera.beta,
      fromRadius: camera.radius,
      fromTarget: camera.target.clone(),
      onComplete,
    };
    driver.start();
    if (!driver.vsAi && !driver.started) {
      peerWait = showWaitingForPeer();
    }
  }

  function updateIntroCamera(dt: number): void {
    if (!introEasing) return;
    introEasing.elapsed += dt;
    const u = Math.min(1, introEasing.elapsed / INTRO_EASE_SEC);
    const tPos = easeInOutCubic(u);
    const tZoom = easeOutCubic(u);

    camera.alpha = lerpAngle(introEasing.fromAlpha, CAM_ALPHA, tPos);
    camera.beta = introEasing.fromBeta + (CAM_BETA - introEasing.fromBeta) * tPos;
    camera.radius =
      introEasing.fromRadius + (CAM_RADIUS - introEasing.fromRadius) * tZoom;
    camera.target.copyFrom(
      Vector3.Lerp(introEasing.fromTarget, PLAY_TARGET, tPos),
    );

    camera.lowerAlphaLimit = camera.alpha;
    camera.upperAlphaLimit = camera.alpha;
    camera.lowerBetaLimit = camera.beta;
    camera.upperBetaLimit = camera.beta;
    camera.lowerRadiusLimit = camera.radius;
    camera.upperRadiusLimit = camera.radius;

    if (u >= 1) {
      const done = introEasing.onComplete;
      introEasing = null;
      unlockPlayCamera();
      camera.attachControl(true, false, 0);
      camera.inputs.removeByType("ArcRotateCameraMouseWheelInput");
      done?.();
    }
  }

  let pointerDown: { x: number; y: number } | null = null;
  let camDragging = false;

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    pointerDown = { x: e.clientX, y: e.clientY };
    camDragging = false;
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!pointerDown || (e.buttons & 1) === 0) return;
    const dx = e.clientX - pointerDown.x;
    const dy = e.clientY - pointerDown.y;
    if (dx * dx + dy * dy > CLICK_DRAG_PX * CLICK_DRAG_PX) camDragging = true;
  };
  const onPointerUp = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const wasDragging = camDragging;
    const down = pointerDown;
    pointerDown = null;
    camDragging = false;
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (wasDragging || dx * dx + dy * dy > CLICK_DRAG_PX * CLICK_DRAG_PX) return;
    if (gameOver) return;
    if (introActive || introEasing) return;
    if (!driver.started) return;

    const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) =>
      pickToSlot.has(mesh.uniqueId),
    );
    if (!pick?.hit || !pick.pickedMesh) return;
    const slot = pickToSlot.get(pick.pickedMesh.uniqueId);
    if (slot) view.openBuildModal(slot);
  };
  const onPointerCancel = () => {
    pointerDown = null;
    camDragging = false;
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("pointerup", onPointerUp);

  let paused = false;
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    if (paused) return;
    elapsed += dt;
    terrain.update(dt, elapsed);
    hud.update(dt);

    if (introActive || introEasing) {
      updateIntroCamera(dt);
      captureFlag.update(dt, elapsed);
      for (const slot of slots) slot.platform.update(dt, elapsed);
      if (driver.started) {
        clearPeerWait();
        const { snapshot, events } = driver.step(dt);
        view.applyEvents(events);
        view.applySnapshot(snapshot);
        view.updateVisuals(dt, elapsed, camera);
        coinFx.update(dt, scene);
      }
      return;
    }

    updateCameraBounds(dt);

    if (driver.started) {
      clearPeerWait();
      const { snapshot, events } = driver.step(dt);
      view.applyEvents(events);
      view.applySnapshot(snapshot);
    }

    captureFlag.update(dt, elapsed);
    for (const slot of slots) slot.platform.update(dt, elapsed);
    view.updateVisuals(dt, elapsed, camera);
    coinFx.update(dt, scene);
  });

  return {
    scene,
    setPaused: (value: boolean) => {
      paused = value;
    },
    setThumbs: (thumbs) => {
      hud.setThumbs(thumbs);
    },
    beginIntro,
    confirmIntro,
    dispose: () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("pointerup", onPointerUp);
      view.dispose();
      driver.dispose();
      hud.dispose();
      coinFx.dispose();
      captureFlag.dispose();
      clearPeerWait();
      for (let i = 0; i < turrets.length; i++) {
        turretHpBars[i].dispose();
        turrets[i].dispose();
      }
      for (const slot of slots) {
        slot.pickProxy.dispose();
        slot.platform.dispose();
      }
      terrain.dispose();
      scene.dispose();
    },
  };
}
