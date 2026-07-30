import { Mesh, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { CombatEntity } from "../game/combatEntity";
import { TEAM_COLORS, WORLD_COLORS, type Team } from "../theme/colors";
import { box, colorMat } from "../theme/materials";
import { createMissile, type MissileHandle } from "../fx/missile";
import {
  makeDebris,
  randBurst,
  randRange,
  randSign,
  randSpin,
  stepDebris,
  type DebrisPiece,
} from "./debris";
import { createUnitCombatState } from "./combatState";
import { createKnockback } from "./knockback";
import { createUnitShadow } from "./shadow";
import { approach, type UnitHandle } from "./types";
import { createWreckSmoke, type WreckSmokeHandle } from "../fx/wreckSmoke";

import { HELI_GUN_FIRE_HZ } from "../game/stats";

/** Matches lab march speed for helicopters; missiles move 4× this. */
const HELI_MOVE_SPEED = 1.3;
const MISSILE_SPEED = HELI_MOVE_SPEED * 4;
const HELI_MISSILE_HZ = 0.2; // once every 5 seconds
const CRUISE_Y = 2.7;

/** Vehicles that can be hit by unlocked Hellfire missiles. */
function isVehicleTarget(target: CombatEntity): boolean {
  if (!("kind" in target)) return false;
  const kind = (target as UnitHandle).kind;
  return kind === "tank" || kind === "supplyTruck";
}

/**
 * Blocky helicopter with spinning rotors, hover bob, chin gun, and guided missiles.
 * Combat: chin gun by default; missiles unlock via Research Lab (Hellfire Protocol)
 * and then engage all vehicles (tanks + supply trucks).
 * Destroy: main rotor flies off, tail boom snaps away, fuselage drops.
 */
export function createHelicopter(
  scene: Scene,
  name: string,
  team: Team,
): UnitHandle {
  const palette = TEAM_COLORS[team];
  const root = new TransformNode(`${name}_root`, scene);
  const combatState = createUnitCombatState("helicopter");
  const knockback = createKnockback();
  const hitPoint = new Vector3();
  const muzzleWorld = new Vector3();

  const bodyMat = colorMat(scene, `${name}_body`, palette.primary);
  const trimMat = colorMat(scene, `${name}_trim`, palette.secondary);
  const darkMat = colorMat(scene, `${name}_dark`, palette.dark);
  const metalMat = colorMat(scene, `${name}_metal`, WORLD_COLORS.metal);
  const glassMat = colorMat(scene, `${name}_glass`, palette.accent, {
    specular: 0.6,
    emissive: 0.08,
  });
  const flashMat = colorMat(scene, `${name}_flash`, "#ffc080", {
    specular: 0,
    emissive: 1,
  });
  const gunFlashMat = colorMat(scene, `${name}_gunFlash`, "#ffe8a0", {
    specular: 0,
    emissive: 1,
  });

  const body = new TransformNode(`${name}_body`, scene);
  body.parent = root;
  body.position.y = CRUISE_Y;

  box(scene, `${name}_fuse`, { w: 0.55, h: 0.4, d: 1.2 }, new Vector3(0, 0, 0), bodyMat, body);
  box(scene, `${name}_nose`, { w: 0.45, h: 0.32, d: 0.35 }, new Vector3(0, 0.02, 0.65), glassMat, body);
  box(scene, `${name}_stripe`, { w: 0.57, h: 0.1, d: 0.5 }, new Vector3(0, 0.05, -0.1), trimMat, body);

  // Chin gun under the nose
  const chinGun = new TransformNode(`${name}_chinGun`, scene);
  chinGun.parent = body;
  chinGun.position = new Vector3(0, -0.28, 0.35);
  box(scene, `${name}_gunMount`, { w: 0.12, h: 0.1, d: 0.14 }, new Vector3(0, 0.04, 0), darkMat, chinGun);
  box(scene, `${name}_gunBarrel`, { w: 0.05, h: 0.05, d: 0.32 }, new Vector3(0, 0, 0.2), metalMat, chinGun);

  const muzzleTip = new TransformNode(`${name}_muzzleTip`, scene);
  muzzleTip.parent = chinGun;
  // Barrel front face: center 0.2 + half depth 0.16
  muzzleTip.position.set(0, 0, 0.36);

  const gunFlash = box(
    scene,
    `${name}_gunFlash`,
    { w: 0.1, h: 0.1, d: 0.16 },
    new Vector3(0, 0, 0.42),
    gunFlashMat,
    chinGun,
  ) as Mesh;
  gunFlash.visibility = 0;

  // Tail assembly — snaps off as one piece on destroy
  const tail = new TransformNode(`${name}_tail`, scene);
  tail.parent = body;
  box(scene, `${name}_boom`, { w: 0.14, h: 0.14, d: 0.9 }, new Vector3(0, 0.05, -0.9), darkMat, tail);
  box(scene, `${name}_fin`, { w: 0.08, h: 0.35, d: 0.28 }, new Vector3(0, 0.2, -1.3), bodyMat, tail);

  box(scene, `${name}_skidL`, { w: 0.06, h: 0.06, d: 0.9 }, new Vector3(-0.28, -0.32, 0.05), metalMat, body);
  box(scene, `${name}_skidR`, { w: 0.06, h: 0.06, d: 0.9 }, new Vector3(0.28, -0.32, 0.05), metalMat, body);
  box(scene, `${name}_strutLF`, { w: 0.05, h: 0.22, d: 0.05 }, new Vector3(-0.28, -0.2, 0.25), metalMat, body);
  box(scene, `${name}_strutLR`, { w: 0.05, h: 0.22, d: 0.05 }, new Vector3(-0.28, -0.2, -0.25), metalMat, body);
  box(scene, `${name}_strutRF`, { w: 0.05, h: 0.22, d: 0.05 }, new Vector3(0.28, -0.2, 0.25), metalMat, body);
  box(scene, `${name}_strutRR`, { w: 0.05, h: 0.22, d: 0.05 }, new Vector3(0.28, -0.2, -0.25), metalMat, body);

  // Stub wings / hardpoints with launch flashes
  const hardpointL = new TransformNode(`${name}_hpL`, scene);
  hardpointL.parent = body;
  hardpointL.position = new Vector3(-0.42, -0.12, 0.05);
  box(scene, `${name}_wingL`, { w: 0.45, h: 0.06, d: 0.22 }, new Vector3(-0.1, 0, 0), darkMat, hardpointL);
  box(scene, `${name}_rackL`, { w: 0.12, h: 0.1, d: 0.35 }, new Vector3(-0.28, -0.08, 0), metalMat, hardpointL);
  const flashL = box(
    scene,
    `${name}_flashL`,
    { w: 0.14, h: 0.14, d: 0.22 },
    new Vector3(-0.28, -0.08, -0.28),
    flashMat,
    hardpointL,
  );
  flashL.visibility = 0;

  const hardpointR = new TransformNode(`${name}_hpR`, scene);
  hardpointR.parent = body;
  hardpointR.position = new Vector3(0.42, -0.12, 0.05);
  box(scene, `${name}_wingR`, { w: 0.45, h: 0.06, d: 0.22 }, new Vector3(0.1, 0, 0), darkMat, hardpointR);
  box(scene, `${name}_rackR`, { w: 0.12, h: 0.1, d: 0.35 }, new Vector3(0.28, -0.08, 0), metalMat, hardpointR);
  const flashR = box(
    scene,
    `${name}_flashR`,
    { w: 0.14, h: 0.14, d: 0.22 },
    new Vector3(0.28, -0.08, -0.28),
    flashMat,
    hardpointR,
  );
  flashR.visibility = 0;

  const mainRotor = new TransformNode(`${name}_mainRotor`, scene);
  mainRotor.parent = body;
  mainRotor.position = new Vector3(0, 0.28, 0);
  box(scene, `${name}_hub`, { w: 0.12, h: 0.1, d: 0.12 }, new Vector3(0, 0, 0), metalMat, mainRotor);

  const bladeMat = colorMat(scene, `${name}_blade`, WORLD_COLORS.metalDark);
  for (let i = 0; i < 2; i++) {
    const blade = box(
      scene,
      `${name}_blade_${i}`,
      { w: 0.1, h: 0.03, d: 1.6 },
      new Vector3(0, 0.04, 0),
      bladeMat,
      mainRotor,
    );
    blade.rotation.y = (Math.PI / 2) * i;
  }

  const tailRotor = new TransformNode(`${name}_tailRotor`, scene);
  tailRotor.parent = tail;
  tailRotor.position = new Vector3(0.12, 0.2, -1.3);
  for (let i = 0; i < 2; i++) {
    const blade = box(
      scene,
      `${name}_tailBlade_${i}`,
      { w: 0.04, h: 0.35, d: 0.06 },
      Vector3.Zero(),
      bladeMat,
      tailRotor,
    );
    blade.rotation.z = (Math.PI / 2) * i;
  }

  const phase = Math.random() * Math.PI * 2;
  let mainSpin = phase;
  let tailSpin = phase * 1.3;
  let combat = false;
  let moving = false;
  let missilesEnabled = false;
  let fireCooldown = 0;
  /** Chin-gun cadence; missiles always use HELI_MISSILE_HZ. */
  let fireRateHz = HELI_GUN_FIRE_HZ;
  let nextPod = 0;
  let flashTimer = 0;
  let flashSide: 0 | 1 = 0;
  let gunFlashTimer = 0;
  let launchKick = 0;
  let gunRecoil = 0;
  let aimTarget: CombatEntity | null = null;
  const missiles: MissileHandle[] = [];
  let missileSeq = 0;
  const debris: DebrisPiece[] = [];
  const fallVel = new Vector3();
  const fallSpin = new Vector3();
  let smoke: WreckSmokeHandle | null = null;
  const launchWorld = new Vector3();
  const aimScratch = new Vector3();

  const shadow = createUnitShadow(scene, name, root, {
    width: 0.28,
    depth: 0.95,
    opacity: 0.22,
    sizePerHeight: -0.22,
    getCasterHeight: () => Math.max(0.2, body.position.y),
    getYaw: () => root.rotation.y + body.rotation.y,
  });

  function launchMissile(): void {
    if (!aimTarget || aimTarget.destroyed) return;

    const pod = nextPod === 0 ? hardpointL : hardpointR;
    flashSide = nextPod as 0 | 1;
    nextPod = 1 - nextPod;

    pod.computeWorldMatrix(true);
    launchWorld.copyFrom(pod.getAbsolutePosition());
    launchWorld.y -= 0.08;

    const cruiseY = body.getAbsolutePosition().y;
    const targetRef = aimTarget;
    const missile = createMissile(
      scene,
      `${name}_missile_${missileSeq++}`,
      launchWorld.clone(),
      () => {
        if (!targetRef || targetRef.destroyed) return null;
        return targetRef.getHitPoint(aimScratch);
      },
      {
        cruiseY,
        speed: MISSILE_SPEED,
        diveRange: 2.6,
        hitRange: 0.55,
        onHit: (hitPos) => {
          // Use launch-time target so damage still applies after this heli dies
          combatState.onMissileHit?.(targetRef, hitPos);
        },
      },
    );
    missiles.push(missile);
    flashTimer = 0.14;
    launchKick = 1;
  }

  function fireChinGun(): void {
    if (!aimTarget || aimTarget.destroyed) return;
    gunFlashTimer = 0.05;
    gunRecoil = 1;
    combatState.onFire?.();
  }

  const handle: UnitHandle = {
    root,
    team,
    kind: "helicopter",
    get fireRateHz() {
      return fireRateHz;
    },
    set fireRateHz(hz: number) {
      fireRateHz = Math.max(0.05, hz);
    },
    get hp() {
      return combatState.hp;
    },
    get maxHp() {
      return combatState.maxHp;
    },
    applyMaxHpBonus: (factor) => {
      combatState.applyMaxHpBonus(factor);
    },
    setMissilesEnabled: (enabled) => {
      missilesEnabled = enabled;
    },
    get shootRange() {
      return combatState.shootRange;
    },
    get moveSpeed() {
      return combatState.moveSpeed;
    },
    get damage() {
      // Public damage is missile damage; gun damage is applied via onFire wiring.
      return combatState.damage;
    },
    get destroyed() {
      return combatState.destroyed;
    },
    get expired() {
      return combatState.expired;
    },
    takeDamage: (amount) => {
      combatState.takeDamage(amount, () => handle.destroy());
    },
    getHitPoint: (out?: Vector3) => {
      const p = out ?? hitPoint;
      body.computeWorldMatrix(true);
      p.copyFrom(body.getAbsolutePosition());
      return p;
    },
    getMuzzlePoint: (out?: Vector3) => {
      const p = out ?? muzzleWorld;
      muzzleTip.computeWorldMatrix(true);
      p.copyFrom(muzzleTip.getAbsolutePosition());
      return p;
    },
    applyImpact: (fromX, fromZ, strength) => {
      if (combatState.destroyed) return;
      knockback.applyImpact(fromX, fromZ, strength, root);
    },
    setCombat: (active) => {
      if (combatState.destroyed) return;
      if (combat === active) return;
      combat = active;
      if (active) {
        fireCooldown = 0.25 + Math.random() * 0.2;
      } else {
        flashTimer = 0;
        gunFlashTimer = 0;
        flashL.visibility = 0;
        flashR.visibility = 0;
        gunFlash.visibility = 0;
      }
    },
    setAimTarget: (target) => {
      aimTarget = target;
    },
    setOnFire: (cb) => {
      combatState.onFire = cb;
    },
    setOnMissileHit: (cb) => {
      combatState.onMissileHit = cb;
    },
    setMoving: (active) => {
      if (combatState.destroyed) return;
      moving = active;
    },
    destroy: () => {
      if (combatState.destroyed) return;
      combatState.beginDeath();
      combat = false;
      moving = false;
      flashL.visibility = 0;
      flashR.visibility = 0;
      gunFlash.visibility = 0;

      debris.push(
        makeDebris(
          mainRotor,
          randBurst(5, 9, { y: 1.4, x: randRange(-0.4, 0.4) }),
          new Vector3(randRange(8, 16) * randSign(), randRange(10, 20), randRange(2, 6) * randSign()),
        ),
      );
      debris.push(
        makeDebris(
          tail,
          randBurst(3, 6, { y: 0.4, z: -0.8 }),
          randSpin(6, 14),
        ),
      );

      fallVel.set(
        randRange(-1.5, 1.5),
        randRange(-0.5, 1.5),
        randRange(-2, 1),
      );
      fallSpin.set(
        randRange(1.5, 4) * randSign(),
        randRange(0.5, 2) * randSign(),
        randRange(1, 3.5) * randSign(),
      );

      smoke = createWreckSmoke(scene, body, { rate: 36, scale: 0.95 });
      smoke.start();
    },
    update: (dt, time) => {
      for (let i = missiles.length - 1; i >= 0; i--) {
        if (!missiles[i].update(dt)) {
          missiles[i].dispose();
          missiles.splice(i, 1);
        }
      }

      if (combatState.destroyed) {
        stepDebris(debris, dt, 0.05, 16);
        fallVel.y -= 14 * dt;
        body.position.x += fallVel.x * dt;
        body.position.y += fallVel.y * dt;
        body.position.z += fallVel.z * dt;
        body.rotation.x += fallSpin.x * dt;
        body.rotation.y += fallSpin.y * dt;
        body.rotation.z += fallSpin.z * dt;
        if (body.position.y < 0.35) {
          body.position.y = 0.35;
          if (Math.abs(fallVel.y) < 1.5) {
            fallVel.setAll(0);
            fallSpin.scaleInPlace(0.9);
          } else {
            fallVel.y *= -0.25;
            fallVel.x *= 0.6;
            fallVel.z *= 0.6;
            fallSpin.scaleInPlace(0.6);
          }
        }
        shadow.update();
        smoke?.update();
        combatState.updateCorpse(dt, root);
        return;
      }

      const tip = knockback.step(dt, root);
      const t = time + phase;

      if (combat && aimTarget && !aimTarget.destroyed) {
        const ap = aimTarget.getHitPoint(aimScratch);
        const dx = ap.x - root.position.x;
        const dz = ap.z - root.position.z;
        if (dx * dx + dz * dz > 1e-4) {
          const yaw = Math.atan2(dx, dz);
          const dy = Math.atan2(Math.sin(yaw - root.rotation.y), Math.cos(yaw - root.rotation.y));
          root.rotation.y += Math.sign(dy) * Math.min(Math.abs(dy), 2.5 * dt);
        }

        // Pitch chin gun toward the hit point
        body.computeWorldMatrix(true);
        const gunPos = chinGun.getAbsolutePosition();
        const toTarget = ap.subtract(gunPos);
        const horiz = Math.hypot(toTarget.x, toTarget.z);
        const desiredPitch = Math.atan2(-toTarget.y, Math.max(0.2, horiz));
        chinGun.rotation.x = approach(
          chinGun.rotation.x,
          Math.max(-0.85, Math.min(0.55, desiredPitch)),
          dt * 4,
        );
      } else {
        chinGun.rotation.x = approach(chinGun.rotation.x, 0.15, dt * 2);
      }

      launchKick = approach(launchKick, 0, dt * 3.2);
      gunRecoil = approach(gunRecoil, 0, dt * 12);

      body.position.y =
        CRUISE_Y +
        Math.sin(t * 1.8) * 0.06 +
        Math.sin(t * 0.7) * 0.03 -
        launchKick * 0.04;
      body.rotation.z =
        Math.sin(t * 1.1) * 0.05 +
        (flashSide === 0 ? -1 : 1) * launchKick * 0.08 +
        tip.tipX;
      body.rotation.x =
        Math.sin(t * 0.9) * 0.035 +
        (moving ? 0.12 : 0) -
        launchKick * 0.06 +
        tip.tipZ;
      body.rotation.y = Math.sin(t * 0.4) * 0.08;

      chinGun.position.z = 0.35 - gunRecoil * 0.04;

      const rotorMul = moving || combat ? 1.35 : 1;
      mainSpin += dt * 5.5 * rotorMul;
      tailSpin += dt * 9 * rotorMul;
      mainRotor.rotation.y = mainSpin;
      tailRotor.rotation.x = tailSpin;

      if (combat && aimTarget && !aimTarget.destroyed) {
        const useMissile = missilesEnabled && isVehicleTarget(aimTarget);
        fireCooldown -= dt;
        if (fireCooldown <= 0) {
          if (useMissile) {
            fireCooldown = 1 / HELI_MISSILE_HZ;
            launchMissile();
          } else {
            fireCooldown = 1 / fireRateHz;
            fireChinGun();
          }
        }
      }

      if (flashTimer > 0) {
        flashTimer -= dt;
        const vis = Math.min(1, flashTimer * 14);
        const flash = flashSide === 0 ? flashL : flashR;
        const other = flashSide === 0 ? flashR : flashL;
        flash.visibility = vis;
        flash.scaling.setAll(0.8 + Math.random() * 0.55);
        other.visibility = 0;
      } else {
        flashL.visibility = 0;
        flashR.visibility = 0;
      }

      if (gunFlashTimer > 0) {
        gunFlashTimer -= dt;
        gunFlash.visibility = Math.min(1, gunFlashTimer * 22);
        gunFlash.scaling.setAll(0.7 + Math.random() * 0.6);
      } else {
        gunFlash.visibility = 0;
      }

      shadow.update();
    },
    dispose: () => {
      for (const m of missiles) m.dispose();
      missiles.length = 0;
      smoke?.dispose();
      for (const d of debris) d.node.dispose(false, true);
      shadow.dispose();
      root.dispose(false, true);
    },
  };

  return handle;
}
