import { Mesh, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import type { CombatEntity } from "../game/combatEntity";
import { TEAM_COLORS, WORLD_COLORS, type Team } from "../theme/colors";
import { box, colorMat, cylinder } from "../theme/materials";
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
import { approach, shortestAngleDelta, type UnitHandle } from "./types";
import { createWreckSmoke, type WreckSmokeHandle } from "../fx/wreckSmoke";

const TANK_FIRE_HZ = 0.25;
const TURRET_AIM_SPEED = 0.55;
const BARREL_PITCH_LIMIT = 0.55; // ~31° up/down
const AIM_ALIGN_RAD = 0.06;

/**
 * Blocky tank with a rotating turret and idle rumble.
 * Combat: turret aims at the enemy, then fires at 0.25Hz once aligned.
 * Destroy: hull tips, turret (and gun) launches off with randomized debris motion.
 */
export function createTank(scene: Scene, name: string, team: Team): UnitHandle {
  const palette = TEAM_COLORS[team];
  const root = new TransformNode(`${name}_root`, scene);
  const combatState = createUnitCombatState("tank");
  const knockback = createKnockback();
  const hitPoint = new Vector3();
  const muzzleWorld = new Vector3();

  const hullMat = colorMat(scene, `${name}_hull`, palette.primary);
  const trimMat = colorMat(scene, `${name}_trim`, palette.secondary);
  const darkMat = colorMat(scene, `${name}_dark`, palette.dark);
  const metalMat = colorMat(scene, `${name}_metal`, WORLD_COLORS.metal);
  const trackMat = colorMat(scene, `${name}_track`, WORLD_COLORS.metalDark);
  const flashMat = colorMat(scene, `${name}_flash`, "#ffe0a0", {
    specular: 0,
    emissive: 1,
  });

  const body = new TransformNode(`${name}_body`, scene);
  body.parent = root;
  body.position.y = 0.28;

  box(scene, `${name}_hull`, { w: 1.05, h: 0.32, d: 1.35 }, new Vector3(0, 0.02, -0.05), hullMat, body);

  const glacis = box(
    scene,
    `${name}_glacis`,
    { w: 1.0, h: 0.28, d: 0.55 },
    new Vector3(0, 0.06, 0.72),
    hullMat,
    body,
  );
  glacis.rotation.x = -0.55;

  box(scene, `${name}_noseLip`, { w: 1.02, h: 0.1, d: 0.18 }, new Vector3(0, -0.08, 0.95), darkMat, body);
  box(scene, `${name}_lightL`, { w: 0.1, h: 0.08, d: 0.08 }, new Vector3(-0.32, 0.12, 0.98), trimMat, body);
  box(scene, `${name}_lightR`, { w: 0.1, h: 0.08, d: 0.08 }, new Vector3(0.32, 0.12, 0.98), trimMat, body);
  box(scene, `${name}_driver`, { w: 0.28, h: 0.12, d: 0.22 }, new Vector3(-0.22, 0.22, 0.45), darkMat, body);
  box(scene, `${name}_chevron`, { w: 0.22, h: 0.06, d: 0.14 }, new Vector3(0, 0.18, 0.78), trimMat, body);

  box(scene, `${name}_engine`, { w: 0.95, h: 0.28, d: 0.55 }, new Vector3(0, 0.2, -0.72), darkMat, body);
  cylinder(
    scene,
    `${name}_exhaustL`,
    { height: 0.28, diameter: 0.1, tessellation: 6 },
    new Vector3(-0.28, 0.42, -0.85),
    metalMat,
    body,
  );
  cylinder(
    scene,
    `${name}_exhaustR`,
    { height: 0.28, diameter: 0.1, tessellation: 6 },
    new Vector3(0.28, 0.42, -0.85),
    metalMat,
    body,
  );
  box(scene, `${name}_rearPlate`, { w: 0.9, h: 0.22, d: 0.1 }, new Vector3(0, 0.02, -1.05), metalMat, body);
  box(scene, `${name}_hitch`, { w: 0.16, h: 0.1, d: 0.14 }, new Vector3(0, -0.02, -1.14), darkMat, body);

  box(scene, `${name}_markL`, { w: 0.06, h: 0.16, d: 0.55 }, new Vector3(-0.54, 0.1, 0.15), trimMat, body);
  box(scene, `${name}_markR`, { w: 0.06, h: 0.16, d: 0.55 }, new Vector3(0.54, 0.1, 0.15), trimMat, body);

  box(scene, `${name}_trackL`, { w: 0.22, h: 0.28, d: 1.7 }, new Vector3(-0.55, -0.12, -0.05), trackMat, body);
  box(scene, `${name}_trackR`, { w: 0.22, h: 0.28, d: 1.7 }, new Vector3(0.55, -0.12, -0.05), trackMat, body);

  box(scene, `${name}_fenderL`, { w: 0.24, h: 0.08, d: 0.28 }, new Vector3(-0.55, 0.02, 0.85), hullMat, body);
  box(scene, `${name}_fenderR`, { w: 0.24, h: 0.08, d: 0.28 }, new Vector3(0.55, 0.02, 0.85), hullMat, body);

  for (const side of [-0.55, 0.55] as const) {
    for (let i = 0; i < 4; i++) {
      const z = -0.55 + i * 0.38;
      const isRear = i === 0;
      cylinder(
        scene,
        `${name}_wheel_${side}_${i}`,
        {
          height: 0.18,
          diameter: isRear ? 0.3 : 0.2,
          tessellation: 8,
        },
        new Vector3(side, -0.18, z),
        metalMat,
        body,
      ).rotation.z = Math.PI / 2;
    }
  }

  const turret = new TransformNode(`${name}_turret`, scene);
  turret.parent = body;
  turret.position = new Vector3(0, 0.28, 0.12);

  box(scene, `${name}_turretBox`, { w: 0.68, h: 0.3, d: 0.72 }, new Vector3(0, 0.1, 0), darkMat, turret);
  box(scene, `${name}_mantlet`, { w: 0.36, h: 0.26, d: 0.2 }, new Vector3(0, 0.1, 0.4), metalMat, turret);
  box(scene, `${name}_turretMark`, { w: 0.26, h: 0.05, d: 0.26 }, new Vector3(0, 0.28, -0.05), trimMat, turret);
  box(scene, `${name}_bustle`, { w: 0.5, h: 0.2, d: 0.28 }, new Vector3(0, 0.08, -0.42), hullMat, turret);

  const hatch = box(
    scene,
    `${name}_hatch`,
    { w: 0.2, h: 0.08, d: 0.2 },
    new Vector3(0.14, 0.28, 0.05),
    metalMat,
    turret,
  );

  const barrel = new TransformNode(`${name}_barrel`, scene);
  barrel.parent = turret;
  barrel.position = new Vector3(0, 0.12, 0.48);
  const barrelBaseZ = 0.48;
  box(scene, `${name}_barrelBase`, { w: 0.16, h: 0.16, d: 0.22 }, new Vector3(0, 0, 0.05), metalMat, barrel);
  box(scene, `${name}_barrelTube`, { w: 0.09, h: 0.09, d: 0.95 }, new Vector3(0, 0, 0.55), metalMat, barrel);
  box(scene, `${name}_muzzle`, { w: 0.13, h: 0.13, d: 0.12 }, new Vector3(0, 0, 1.05), darkMat, barrel);

  const muzzleTip = new TransformNode(`${name}_muzzleTip`, scene);
  muzzleTip.parent = barrel;
  muzzleTip.position.set(0, 0, 1.11);

  const muzzleFlash = box(
    scene,
    `${name}_muzzleFlash`,
    { w: 0.28, h: 0.28, d: 0.45 },
    new Vector3(0, 0, 1.35),
    flashMat,
    barrel,
  ) as Mesh;
  muzzleFlash.visibility = 0;

  const phase = Math.random() * Math.PI * 2;
  let combat = false;
  let moving = false;
  let aimed = false;
  let fireCooldown = 0;
  let recoil = 0;
  let flashTimer = 0;
  let fireRateHz = TANK_FIRE_HZ;
  let moveBob = 0;
  let aimTarget: CombatEntity | null = null;
  let aimPitch = 0;
  const debris: DebrisPiece[] = [];
  let hullTip = Vector3.Zero();
  let hullTipVel = Vector3.Zero();
  let smoke: WreckSmokeHandle | null = null;
  const aimWorld = new Vector3();

  const shadow = createUnitShadow(scene, name, root, {
    width: 1.15,
    depth: 1.75,
    opacity: 0.5,
    getCasterHeight: () => 0.35,
  });

  function desiredTurretYaw(): number {
    if (!aimTarget || aimTarget.destroyed) return 0;
    aimWorld.copyFrom(aimTarget.getHitPoint());
    const dx = aimWorld.x - root.position.x;
    const dz = aimWorld.z - root.position.z;
    if (dx * dx + dz * dz < 1e-6) return turret.rotation.y;
    const worldYaw = Math.atan2(dx, dz);
    return shortestAngleDelta(0, worldYaw - root.rotation.y);
  }

  /** Barrel pitch (rotation.x): negative tips up toward higher targets. */
  function desiredBarrelPitch(): number {
    if (!aimTarget || aimTarget.destroyed) return 0;
    aimWorld.copyFrom(aimTarget.getHitPoint());
    barrel.computeWorldMatrix(true);
    const from = barrel.getAbsolutePosition();
    const dx = aimWorld.x - from.x;
    const dy = aimWorld.y - from.y;
    const dz = aimWorld.z - from.z;
    const horiz = Math.hypot(dx, dz);
    if (horiz < 1e-4) return 0;
    const pitch = -Math.atan2(dy, horiz);
    return Math.max(-BARREL_PITCH_LIMIT, Math.min(BARREL_PITCH_LIMIT, pitch));
  }

  const handle: UnitHandle = {
    root,
    team,
    kind: "tank",
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
    setMissilesEnabled: () => {
      /* tank — no missiles */
    },
    get shootRange() {
      return combatState.shootRange;
    },
    get moveSpeed() {
      return combatState.moveSpeed;
    },
    get damage() {
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
      p.copyFrom(root.getAbsolutePosition());
      p.y += 0.45;
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
      aimed = false;
      if (active) {
        fireCooldown = 0.35;
      } else {
        flashTimer = 0;
        muzzleFlash.visibility = 0;
      }
    },
    setAimTarget: (target) => {
      aimTarget = target;
    },
    setOnFire: (cb) => {
      combatState.onFire = cb;
    },
    setOnMissileHit: () => {},
    setMoving: (active) => {
      if (combatState.destroyed) return;
      moving = active;
    },
    destroy: () => {
      if (combatState.destroyed) return;
      combatState.beginDeath();
      combat = false;
      moving = false;
      aimed = false;
      muzzleFlash.visibility = 0;

      debris.push(
        makeDebris(
          turret,
          randBurst(4.5, 7.5, { y: 1.2, x: randRange(-0.3, 0.3) }),
          randSpin(4, 12),
        ),
      );

      hullTipVel = new Vector3(
        randRange(0.8, 2.2) * randSign(),
        0,
        randRange(-0.6, 0.6),
      );
      body.position.y += randRange(0.05, 0.2);

      smoke = createWreckSmoke(scene, body, { rate: 32, scale: 1.15 });
      smoke.start();
    },
    update: (dt, time) => {
      if (combatState.destroyed) {
        stepDebris(debris, dt);
        hullTip.x = approach(hullTip.x, hullTipVel.x, dt * 2.5);
        hullTip.z = approach(hullTip.z, hullTipVel.z * 0.4, dt * 1.5);
        body.rotation.z = hullTip.x * 0.35;
        body.rotation.x = hullTip.z * 0.25 - 0.15;
        body.position.y = approach(body.position.y, 0.18, dt * 1.2);
        shadow.mesh.visibility = Math.max(0, (shadow.mesh.visibility || 1) - dt * 0.4);
        smoke?.update();
        combatState.updateCorpse(dt, root);
        return;
      }

      const t = time + phase;
      if (moving) moveBob += dt * 14;
      const tip = knockback.step(dt, root);

      body.position.y =
        0.28 +
        Math.sin(t * 18) * 0.004 +
        Math.sin(t * 3.2) * 0.006 +
        recoil * 0.025 +
        (moving ? Math.sin(moveBob) * 0.015 : 0);
      body.position.z = -recoil * 0.1;
      body.rotation.z =
        Math.sin(t * 2.1) * 0.012 +
        (moving ? Math.sin(moveBob * 0.5) * 0.02 : 0) +
        tip.tipX;
      body.rotation.x =
        Math.sin(t * 1.7) * 0.008 - recoil * 0.09 + tip.tipZ;

      if (combat) {
        const targetYaw = desiredTurretYaw();
        const targetPitch = desiredBarrelPitch();
        const delta = shortestAngleDelta(turret.rotation.y, targetYaw);
        const step = Math.sign(delta) * Math.min(Math.abs(delta), TURRET_AIM_SPEED * dt);
        turret.rotation.y += step;

        aimPitch = approach(aimPitch, targetPitch, TURRET_AIM_SPEED * dt);
        barrel.rotation.x = aimPitch - recoil * 0.12;

        const yawOk =
          Math.abs(shortestAngleDelta(turret.rotation.y, targetYaw)) < AIM_ALIGN_RAD;
        const pitchOk = Math.abs(aimPitch - targetPitch) < AIM_ALIGN_RAD;
        if (yawOk && pitchOk) {
          aimed = true;
          turret.rotation.y = targetYaw;
          aimPitch = targetPitch;
        } else {
          aimed = false;
        }

        if (aimed && aimTarget && !aimTarget.destroyed) {
          fireCooldown -= dt;
          if (fireCooldown <= 0) {
            fireCooldown = 1 / fireRateHz;
            recoil = 1;
            flashTimer = 0.12;
            combatState.onFire?.();
          }
        }
      } else {
        aimed = false;
        // Gentle idle: ease turret toward hull-forward with a light sway (no continuous spin)
        const idleYaw = Math.sin(t * 0.35) * 0.18;
        const idleDelta = shortestAngleDelta(turret.rotation.y, idleYaw);
        turret.rotation.y +=
          Math.sign(idleDelta) * Math.min(Math.abs(idleDelta), 0.35 * dt);
        aimPitch = approach(aimPitch, Math.sin(t * 0.55) * 0.04, dt * 2);
        barrel.rotation.x = aimPitch;
      }

      recoil = approach(recoil, 0, dt * 2.2);
      barrel.position.z = barrelBaseZ - recoil * 0.45;
      turret.position.z = 0.12 - recoil * 0.03;

      if (flashTimer > 0) {
        flashTimer -= dt;
        muzzleFlash.visibility = Math.min(1, flashTimer * 12);
        muzzleFlash.scaling.setAll(0.85 + Math.random() * 0.4);
      } else {
        muzzleFlash.visibility = 0;
      }

      hatch.position.y = 0.28 + Math.sin(t * 12) * 0.003;

      shadow.update();
    },
    dispose: () => {
      smoke?.dispose();
      for (const d of debris) d.node.dispose(false, true);
      shadow.dispose();
      root.dispose(false, true);
    },
  };

  return handle;
}
