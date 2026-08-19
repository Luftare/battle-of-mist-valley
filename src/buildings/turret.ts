import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import {
  CORPSE_LIFETIME_SEC,
  TURRET_DAMAGE,
  TURRET_FIRE_HZ,
  TURRET_MAX_HP,
  TURRET_SHOOT_RANGE,
} from "../game/stats";
import type { CombatEntity } from "../game/combatEntity";
import { TEAM_COLORS, WORLD_COLORS, type Team } from "../theme/colors";
import { box, colorMat, cylinder } from "../theme/materials";
import { createBlobShadow } from "../units/shadow";
import { shortestAngleDelta } from "../units/types";

export interface TurretHandle extends CombatEntity {
  root: TransformNode;
  team: Team;
  kind: "turret";
  hp: number;
  maxHp: number;
  shootRange: number;
  damage: number;
  fireRateHz: number;
  /** Last team that dealt damage (for destroy bounty). */
  lastAttackerTeam: Team | null;
  setAimTarget: (target: CombatEntity | null) => void;
  setOnFire: (cb: (() => void) | null) => void;
  setAutoFire: (enabled: boolean) => void;
  playFireFx: () => void;
  /** Restore HP without exceeding max (research regen). */
  heal: (amount: number) => void;
  /** World-space muzzle for the next barrel in the alternating pair. */
  getMuzzlePoint: () => Vector3;
  readonly destroyed: boolean;
  readonly expired: boolean;
  update: (dt: number, time: number) => void;
  dispose: () => void;
}

const TURRET_TURN_SPEED = 0.55;
const TURRET_ALIGN_RAD = 0.06;
const IDLE_YAW_LIMIT = Math.PI / 4; // ±45°
const IDLE_TURN_SPEED = 0.22;
const BARREL_PITCH_LIMIT = 0.55; // ~31° up/down
/** Gun pivot sits on the pad (no pedestal neck). */
const GUN_PIVOT_Y = 0.2;

/**
 * Fixed dual-barrel defense turret. Blocky pad + rotating gun house.
 */
export function createTurret(
  scene: Scene,
  name: string,
  team: Team,
): TurretHandle {
  const palette = TEAM_COLORS[team];
  const root = new TransformNode(`${name}_root`, scene);
  // Face the midfield: blue looks north (+Z), red looks south (−Z)
  root.rotation.y = team === "red" ? Math.PI : 0;
  const phase = Math.random() * Math.PI * 2;

  const padMat = colorMat(scene, `${name}_pad`, "#5a5a54");
  const metalMat = colorMat(scene, `${name}_metal`, WORLD_COLORS.metal);
  const metalDark = colorMat(scene, `${name}_metalDark`, WORLD_COLORS.metalDark);
  const trimMat = colorMat(scene, `${name}_trim`, palette.primary);
  const darkMat = colorMat(scene, `${name}_dark`, palette.dark);
  const flashMat = colorMat(scene, `${name}_flash`, "#ffd080", {
    specular: 0,
    emissive: 1,
  });

  // Circular-ish concrete pad
  cylinder(
    scene,
    `${name}_pad`,
    { height: 0.14, diameter: 2.1, tessellation: 10 },
    new Vector3(0, 0.07, 0),
    padMat,
    root,
  );
  box(
    scene,
    `${name}_ring`,
    { w: 1.7, h: 0.05, d: 1.7 },
    new Vector3(0, 0.15, 0),
    metalDark,
    root,
  );
  // Team stripe on pad
  box(
    scene,
    `${name}_stripe`,
    { w: 1.5, h: 0.04, d: 0.22 },
    new Vector3(0, 0.17, 0),
    trimMat,
    root,
  );

  // Rotating gun house — sits directly on the pad
  const gun = new TransformNode(`${name}_gun`, scene);
  gun.parent = root;
  gun.position.y = GUN_PIVOT_Y;

  box(
    scene,
    `${name}_house`,
    { w: 0.95, h: 0.55, d: 0.85 },
    new Vector3(0, 0.15, -0.05),
    metalMat,
    gun,
  );
  box(
    scene,
    `${name}_houseTrim`,
    { w: 0.98, h: 0.12, d: 0.08 },
    new Vector3(0, 0.28, 0.38),
    trimMat,
    gun,
  );
  box(
    scene,
    `${name}_cupola`,
    { w: 0.45, h: 0.22, d: 0.45 },
    new Vector3(0, 0.52, -0.1),
    darkMat,
    gun,
  );

  // Dual barrels
  const barrelL = new TransformNode(`${name}_barrelL`, scene);
  barrelL.parent = gun;
  barrelL.position.set(-0.22, 0.18, 0.35);
  box(
    scene,
    `${name}_barrelLBox`,
    { w: 0.12, h: 0.12, d: 1.05 },
    new Vector3(0, 0, 0.45),
    metalDark,
    barrelL,
  );
  box(
    scene,
    `${name}_muzzleL`,
    { w: 0.16, h: 0.16, d: 0.12 },
    new Vector3(0, 0, 1.0),
    darkMat,
    barrelL,
  );

  const barrelR = new TransformNode(`${name}_barrelR`, scene);
  barrelR.parent = gun;
  barrelR.position.set(0.22, 0.18, 0.35);
  box(
    scene,
    `${name}_barrelRBox`,
    { w: 0.12, h: 0.12, d: 1.05 },
    new Vector3(0, 0, 0.45),
    metalDark,
    barrelR,
  );
  box(
    scene,
    `${name}_muzzleR`,
    { w: 0.16, h: 0.16, d: 0.12 },
    new Vector3(0, 0, 1.0),
    darkMat,
    barrelR,
  );

  const flashL = box(
    scene,
    `${name}_flashL`,
    { w: 0.18, h: 0.18, d: 0.28 },
    new Vector3(0, 0, 1.18),
    flashMat,
    barrelL,
  );
  flashL.visibility = 0;
  const flashR = box(
    scene,
    `${name}_flashR`,
    { w: 0.18, h: 0.18, d: 0.28 },
    new Vector3(0, 0, 1.18),
    flashMat,
    barrelR,
  );
  flashR.visibility = 0;

  const muzzleTipL = new TransformNode(`${name}_muzzleTipL`, scene);
  muzzleTipL.parent = barrelL;
  muzzleTipL.position.set(0, 0, 1.12);
  const muzzleTipR = new TransformNode(`${name}_muzzleTipR`, scene);
  muzzleTipR.parent = barrelR;
  muzzleTipR.position.set(0, 0, 1.12);

  const shadow = createBlobShadow(scene, name, root, {
    width: 1.1,
    depth: 1.1,
    opacity: 0.4,
    sizePerHeight: 0.02,
    getCasterHeight: () => 0.72,
    groundY: () => root.position.y + 0.04,
  });

  const maxHp = TURRET_MAX_HP;
  let hp = maxHp;
  let destroyed = false;
  let expired = false;
  let sinkAge = 0;
  let shake = 0;
  let aimTarget: CombatEntity | null = null;
  let fireCooldown = 0.3 + Math.random() * 0.4;
  let autoFire = true;
  let nextBarrel: 0 | 1 = 0;
  let flashTimer = 0;
  let flashSide: 0 | 1 = 0;
  let onFire: (() => void) | null = null;
  let lastAttackerTeam: Team | null = null;
  let idleDir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
  let aimPitch = 0;
  gun.rotation.y = (Math.random() * 2 - 1) * IDLE_YAW_LIMIT;
  const baseY = 0;
  const hitPoint = new Vector3();
  const muzzleWorld = new Vector3();

  function setBarrelPitch(pitch: number): void {
    barrelL.rotation.x = pitch;
    barrelR.rotation.x = pitch;
  }

  function desiredBarrelPitch(target: CombatEntity): number {
    const tp = target.getHitPoint();
    barrelL.computeWorldMatrix(true);
    const from = barrelL.getAbsolutePosition();
    const dx = tp.x - from.x;
    const dy = tp.y - from.y;
    const dz = tp.z - from.z;
    const horiz = Math.hypot(dx, dz);
    if (horiz < 1e-4) return 0;
    const pitch = -Math.atan2(dy, horiz);
    return Math.max(-BARREL_PITCH_LIMIT, Math.min(BARREL_PITCH_LIMIT, pitch));
  }

  const handle: TurretHandle = {
    root,
    team,
    kind: "turret",
    shootRange: TURRET_SHOOT_RANGE,
    damage: TURRET_DAMAGE,
    fireRateHz: TURRET_FIRE_HZ,
    get hp() {
      return hp;
    },
    get maxHp() {
      return maxHp;
    },
    get lastAttackerTeam() {
      return lastAttackerTeam;
    },
    set lastAttackerTeam(t) {
      lastAttackerTeam = t;
    },
    get destroyed() {
      return destroyed;
    },
    get expired() {
      return expired;
    },
    getHitPoint: (out?: Vector3) => {
      const p = out ?? hitPoint;
      p.copyFrom(root.getAbsolutePosition());
      p.y += 0.78;
      return p;
    },
    applyImpact: (_fromX, _fromZ, strength) => {
      if (destroyed) return;
      shake = Math.min(0.4, shake + strength * 0.045);
    },
    takeDamage: (amount) => {
      if (destroyed || amount <= 0) return;
      hp = Math.max(0, hp - amount);
      if (hp <= 0) {
        destroyed = true;
        sinkAge = 0;
        flashL.visibility = 0;
        flashR.visibility = 0;
        aimTarget = null;
      }
    },
    heal: (amount) => {
      if (destroyed || amount <= 0) return;
      hp = Math.min(maxHp, hp + amount);
    },
    setAimTarget: (target) => {
      aimTarget = target;
    },
    setOnFire: (cb) => {
      onFire = cb;
    },
    setAutoFire: (enabled) => {
      autoFire = enabled;
    },
    playFireFx: () => {
      flashSide = nextBarrel;
      flashTimer = 0.07;
      const b = nextBarrel === 0 ? barrelL : barrelR;
      b.position.z = 0.28;
      nextBarrel = (1 - nextBarrel) as 0 | 1;
      onFire?.();
    },
    getMuzzlePoint: () => {
      // Point just ahead of the barrel that is about to fire
      const tip = nextBarrel === 0 ? muzzleTipL : muzzleTipR;
      tip.computeWorldMatrix(true);
      muzzleWorld.copyFrom(tip.getAbsolutePosition());
      return muzzleWorld;
    },
    update: (dt, time) => {
      if (destroyed) {
        sinkAge += dt;
        const t = Math.min(1, sinkAge / CORPSE_LIFETIME_SEC);
        root.position.y = baseY - t * 2.2;
        gun.rotation.z = Math.sin(time * 6) * 0.15 * (1 - t);
        if (sinkAge >= CORPSE_LIFETIME_SEC) expired = true;
        shadow.update();
        return;
      }

      if (shake > 0.001) {
        root.rotation.z = Math.sin(time * 38) * shake * 0.12;
        root.rotation.x = Math.cos(time * 30) * shake * 0.08;
        shake = Math.max(0, shake - dt * 1.8);
      } else {
        root.rotation.z = 0;
        root.rotation.x = 0;
      }

      // Idle micro-sway
      gun.position.y = GUN_PIVOT_Y + Math.sin(time * 1.3 + phase) * 0.012;

      let aligned = false;
      if (aimTarget && !aimTarget.destroyed) {
        const tp = aimTarget.getHitPoint();
        const dx = tp.x - root.position.x;
        const dz = tp.z - root.position.z;
        if (dx * dx + dz * dz > 1e-4) {
          const worldYaw = Math.atan2(dx, dz);
          const localYaw = worldYaw - root.rotation.y;
          const dy = shortestAngleDelta(gun.rotation.y, localYaw);
          gun.rotation.y +=
            Math.sign(dy) * Math.min(Math.abs(dy), TURRET_TURN_SPEED * dt);

          const targetPitch = desiredBarrelPitch(aimTarget);
          const pitchStep =
            Math.sign(targetPitch - aimPitch) *
            Math.min(Math.abs(targetPitch - aimPitch), TURRET_TURN_SPEED * dt);
          aimPitch += pitchStep;
          setBarrelPitch(aimPitch);

          aligned =
            Math.abs(shortestAngleDelta(gun.rotation.y, localYaw)) < TURRET_ALIGN_RAD &&
            Math.abs(aimPitch - targetPitch) < TURRET_ALIGN_RAD;
        }
      } else {
        // Slow search sweep across ±45° when idle (ease back into arc after combat)
        if (gun.rotation.y > IDLE_YAW_LIMIT) idleDir = -1;
        else if (gun.rotation.y < -IDLE_YAW_LIMIT) idleDir = 1;
        gun.rotation.y += idleDir * IDLE_TURN_SPEED * dt;
        if (gun.rotation.y >= IDLE_YAW_LIMIT) {
          gun.rotation.y = IDLE_YAW_LIMIT;
          idleDir = -1;
        } else if (gun.rotation.y <= -IDLE_YAW_LIMIT) {
          gun.rotation.y = -IDLE_YAW_LIMIT;
          idleDir = 1;
        }
        // Level barrels while scanning
        if (aimPitch !== 0) {
          const step =
            Math.sign(-aimPitch) * Math.min(Math.abs(aimPitch), TURRET_TURN_SPEED * dt);
          aimPitch += step;
          setBarrelPitch(aimPitch);
        }
      }

      if (flashTimer > 0) {
        flashTimer -= dt;
        const vis = flashTimer > 0 ? Math.min(1, flashTimer * 18) : 0;
        if (flashSide === 0) {
          flashL.visibility = vis;
          flashR.visibility = 0;
        } else {
          flashR.visibility = vis;
          flashL.visibility = 0;
        }
      } else {
        flashL.visibility = 0;
        flashR.visibility = 0;
      }

      if (autoFire && aimTarget && !aimTarget.destroyed && aligned) {
        fireCooldown -= dt;
        if (fireCooldown <= 0) {
          fireCooldown = 1 / TURRET_FIRE_HZ;
          handle.playFireFx();
        }
      }

      // Barrel recover
      barrelL.position.z += (0.35 - barrelL.position.z) * Math.min(1, dt * 12);
      barrelR.position.z += (0.35 - barrelR.position.z) * Math.min(1, dt * 12);

      shadow.update();
    },
    dispose: () => {
      shadow.dispose();
      root.dispose(false, true);
    },
  };

  return handle;
}
