import { Mesh, Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { TEAM_COLORS, WORLD_COLORS, type Team } from "../theme/colors";
import { box, colorMat } from "../theme/materials";
import {
  makeDebris,
  randBurst,
  randRange,
  randSign,
  randSpin,
  stepDebris,
  type DebrisPiece,
} from "./debris";
import { createUnitShadow } from "./shadow";
import { approach, type UnitHandle } from "./types";

/**
 * Blocky rifleman: one box per limb, torso, head, helmet.
 * Destroy: jumps backward, limbs flail wildly, rifle thrown clear.
 */
export function createRifleman(
  scene: Scene,
  name: string,
  team: Team,
): UnitHandle {
  const palette = TEAM_COLORS[team];
  const root = new TransformNode(`${name}_root`, scene);

  const bodyMat = colorMat(scene, `${name}_body`, palette.primary);
  const trimMat = colorMat(scene, `${name}_trim`, palette.secondary);
  const darkMat = colorMat(scene, `${name}_dark`, palette.dark);
  const skinMat = colorMat(scene, `${name}_skin`, WORLD_COLORS.skin);
  const metalMat = colorMat(scene, `${name}_metal`, WORLD_COLORS.metal);
  const helmetMat = colorMat(scene, `${name}_helmet`, WORLD_COLORS.helmet);
  const flashMat = colorMat(scene, `${name}_flash`, "#ffd080", {
    specular: 0,
    emissive: 1,
  });

  const body = new TransformNode(`${name}_body`, scene);
  body.parent = root;
  body.position.y = 0.55;

  box(scene, `${name}_torso`, { w: 0.42, h: 0.5, d: 0.28 }, new Vector3(0, 0.05, 0), bodyMat, body);
  box(
    scene,
    `${name}_stripe`,
    { w: 0.44, h: 0.1, d: 0.08 },
    new Vector3(0, 0.12, 0.12),
    trimMat,
    body,
  );

  const head = new TransformNode(`${name}_head`, scene);
  head.parent = body;
  head.position = new Vector3(0, 0.42, 0);
  box(scene, `${name}_headBox`, { w: 0.28, h: 0.28, d: 0.28 }, Vector3.Zero(), skinMat, head);
  box(
    scene,
    `${name}_helmet`,
    { w: 0.32, h: 0.14, d: 0.34 },
    new Vector3(0, 0.18, 0.02),
    helmetMat,
    head,
  );
  box(
    scene,
    `${name}_helmetMark`,
    { w: 0.12, h: 0.06, d: 0.06 },
    new Vector3(0, 0.2, 0.18),
    trimMat,
    head,
  );

  const leftArm = new TransformNode(`${name}_lArm`, scene);
  leftArm.parent = body;
  leftArm.position = new Vector3(-0.28, 0.15, 0);
  box(scene, `${name}_lArmBox`, { w: 0.14, h: 0.42, d: 0.14 }, new Vector3(0, -0.15, 0), bodyMat, leftArm);

  const rightArm = new TransformNode(`${name}_rArm`, scene);
  rightArm.parent = body;
  rightArm.position = new Vector3(0.28, 0.15, 0);
  box(scene, `${name}_rArmBox`, { w: 0.14, h: 0.42, d: 0.14 }, new Vector3(0, -0.15, 0), bodyMat, rightArm);

  const rifle = new TransformNode(`${name}_rifle`, scene);
  rifle.parent = body;
  box(scene, `${name}_rifleStock`, { w: 0.08, h: 0.1, d: 0.22 }, new Vector3(0, 0, -0.12), darkMat, rifle);
  box(scene, `${name}_rifleBarrel`, { w: 0.06, h: 0.06, d: 0.45 }, new Vector3(0, 0.02, 0.18), metalMat, rifle);

  const muzzleFlash = box(
    scene,
    `${name}_muzzleFlash`,
    { w: 0.12, h: 0.12, d: 0.18 },
    new Vector3(0, 0.02, 0.48),
    flashMat,
    rifle,
  ) as Mesh;
  muzzleFlash.visibility = 0;

  const leftLeg = new TransformNode(`${name}_lLeg`, scene);
  leftLeg.parent = body;
  leftLeg.position = new Vector3(-0.12, -0.22, 0);
  box(scene, `${name}_lLegBox`, { w: 0.16, h: 0.4, d: 0.16 }, new Vector3(0, -0.2, 0), darkMat, leftLeg);

  const rightLeg = new TransformNode(`${name}_rLeg`, scene);
  rightLeg.parent = body;
  rightLeg.position = new Vector3(0.12, -0.22, 0);
  box(scene, `${name}_rLegBox`, { w: 0.16, h: 0.4, d: 0.16 }, new Vector3(0, -0.2, 0), darkMat, rightLeg);

  const limbs = [head, leftArm, rightArm, leftLeg, rightLeg];

  const phase = Math.random() * Math.PI * 2;
  let combat = false;
  let moving = false;
  let pose = 0;
  let moveBlend = 0;
  let fireCooldown = 0;
  let recoil = 0;
  let flashTimer = 0;
  let fireRateHz = 2;
  let walkPhase = phase;
  let destroyed = false;
  let deathSettled = false;
  const debris: DebrisPiece[] = [];
  const deathVel = new Vector3();
  const deathSpin = new Vector3();
  const limbSpins = limbs.map(() => new Vector3());

  const shadow = createUnitShadow(scene, name, root, {
    width: 0.55,
    depth: 0.4,
    opacity: 0.45,
    getCasterHeight: () => 0.55,
  });

  const IDLE_RIFLE_POS = new Vector3(0.0, -0.06, 0.16);
  const IDLE_RIFLE_ROT = new Vector3(0.25, -Math.PI / 2, 0.1);
  const AIM_RIFLE_POS = new Vector3(0.04, 0.16, 0.42);
  const AIM_RIFLE_ROT = new Vector3(0.02, -0.75, 0.04);
  const CHEST_BLADE = 0.75;
  const IDLE_LEFT = new Vector3(-0.55, 0.2, -0.35);
  const IDLE_RIGHT = new Vector3(-0.5, -0.15, 0.32);
  const AIM_LEFT = new Vector3(-1.05, 0.1, -0.45 + (40 * Math.PI) / 180);
  const AIM_RIGHT = new Vector3(-1.45, -0.35, 0.15);

  const handle: UnitHandle = {
    root,
    team,
    kind: "rifleman",
    get fireRateHz() {
      return fireRateHz;
    },
    set fireRateHz(hz: number) {
      fireRateHz = Math.max(0.1, hz);
    },
    get destroyed() {
      return destroyed;
    },
    setCombat: (active) => {
      if (destroyed) return;
      combat = active;
      if (active) {
        fireCooldown = 0.15 + Math.random() * 0.2;
        recoil = 0;
      } else {
        flashTimer = 0;
        muzzleFlash.visibility = 0;
      }
    },
    setAimTarget: () => {},
    setMoving: (active) => {
      if (destroyed) return;
      moving = active;
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      combat = false;
      moving = false;
      muzzleFlash.visibility = 0;

      // Rifle slips / drops nearby — not launched
      debris.push(
        makeDebris(
          rifle,
          randBurst(0.6, 1.4, { y: 0.15, z: randRange(-0.15, 0.1) }),
          randSpin(1.5, 4),
        ),
      );

      // Soft crumple: slight stumble back, tip over — little impact
      deathVel.set(
        randRange(-0.35, 0.35),
        randRange(0.6, 1.2),
        randRange(-1.4, -0.6),
      );
      deathSpin.set(
        randRange(1.2, 2.4),
        randRange(0.2, 0.8) * randSign(),
        randRange(0.4, 1.2) * randSign(),
      );
      for (const spin of limbSpins) {
        spin.copyFrom(randSpin(2.5, 6));
      }
    },
    update: (dt, time) => {
      if (destroyed) {
        stepDebris(debris, dt, 0.05, 12);

        if (!deathSettled) {
          deathVel.y -= 12 * dt;
          body.position.x += deathVel.x * dt;
          body.position.y += deathVel.y * dt;
          body.position.z += deathVel.z * dt;
          body.rotation.x += deathSpin.x * dt;
          body.rotation.y += deathSpin.y * dt;
          body.rotation.z += deathSpin.z * dt;

          for (let i = 0; i < limbs.length; i++) {
            const limb = limbs[i];
            const spin = limbSpins[i];
            limb.rotation.x += spin.x * dt;
            limb.rotation.y += spin.y * dt;
            limb.rotation.z += spin.z * dt;
            spin.scaleInPlace(0.96);
          }

          if (body.position.y < 0.14) {
            body.position.y = 0.14;
            if (Math.abs(deathVel.y) < 0.8 && deathVel.length() < 1.2) {
              deathSettled = true;
              // Settle onto the back with a mild sprawl
              body.rotation.x = Math.PI / 2 + randRange(-0.25, 0.2);
              body.rotation.y += randRange(-0.25, 0.25);
              body.rotation.z = randRange(-0.3, 0.3);
              deathVel.setAll(0);
              deathSpin.scaleInPlace(0.08);
              for (const spin of limbSpins) spin.scaleInPlace(0.2);
            } else {
              deathVel.y *= -0.12;
              deathVel.x *= 0.4;
              deathVel.z *= 0.4;
              deathSpin.scaleInPlace(0.4);
            }
          }
        } else {
          for (let i = 0; i < limbs.length; i++) {
            const limb = limbs[i];
            const spin = limbSpins[i];
            limb.rotation.x += spin.x * dt;
            limb.rotation.y += spin.y * dt;
            limb.rotation.z += spin.z * dt;
            spin.scaleInPlace(0.88);
          }
        }

        shadow.mesh.visibility = Math.max(0, (shadow.mesh.visibility || 1) - dt * 0.5);
        return;
      }

      const t = time + phase;
      pose = approach(pose, combat ? 1 : 0, dt * 3.5);
      moveBlend = approach(moveBlend, moving ? 1 : 0, dt * 4);
      const idle = 1 - pose;
      const sway = Math.sin(t * 1.4) * 0.03;
      walkPhase += dt * (7.5 * moveBlend + 0.001);
      const stride = Math.sin(walkPhase);
      const strideOpp = Math.sin(walkPhase + Math.PI);

      body.position.y =
        0.55 +
        Math.sin(t * 1.6) * 0.012 * idle * (1 - moveBlend) -
        pose * 0.05 +
        recoil * 0.02 * pose +
        Math.abs(stride) * 0.03 * moveBlend;
      body.position.z = -recoil * 0.07 * pose;
      body.rotation.y = Math.sin(t * 0.5) * 0.04 * idle + CHEST_BLADE * pose;
      body.rotation.z =
        Math.sin(t * 1.1) * 0.03 * idle * (1 - moveBlend) +
        pose * 0.04 +
        stride * 0.04 * moveBlend;
      body.rotation.x =
        Math.sin(t * 0.7) * 0.015 * idle + pose * 0.06 - recoil * 0.18 * pose;

      head.rotation.y = Math.sin(t * 0.45) * 0.18 * idle - CHEST_BLADE * pose;
      head.rotation.x = Math.sin(t * 0.6) * 0.05 * idle + pose * 0.1;
      head.rotation.z = pose * 0.05;

      rifle.position.x = IDLE_RIFLE_POS.x * idle + AIM_RIFLE_POS.x * pose;
      rifle.position.y = IDLE_RIFLE_POS.y * idle + AIM_RIFLE_POS.y * pose + sway * idle;
      rifle.position.z =
        IDLE_RIFLE_POS.z * idle + AIM_RIFLE_POS.z * pose - recoil * 0.18 * pose;
      rifle.rotation.x = IDLE_RIFLE_ROT.x * idle + AIM_RIFLE_ROT.x * pose;
      rifle.rotation.y = IDLE_RIFLE_ROT.y * idle + AIM_RIFLE_ROT.y * pose;
      rifle.rotation.z = IDLE_RIFLE_ROT.z * idle + AIM_RIFLE_ROT.z * pose + sway * idle;

      leftArm.rotation.x = IDLE_LEFT.x * idle + AIM_LEFT.x * pose + sway;
      leftArm.rotation.y = IDLE_LEFT.y * idle + AIM_LEFT.y * pose;
      leftArm.rotation.z = IDLE_LEFT.z * idle + AIM_LEFT.z * pose;
      rightArm.rotation.x = IDLE_RIGHT.x * idle + (AIM_RIGHT.x - recoil * 0.45) * pose + sway * 0.8;
      rightArm.rotation.y = IDLE_RIGHT.y * idle + AIM_RIGHT.y * pose;
      rightArm.rotation.z = IDLE_RIGHT.z * idle + AIM_RIGHT.z * pose;

      const standLeftX = Math.sin(t * 0.9) * 0.04 * idle + pose * 0.45;
      const standRightX = Math.sin(t * 0.9 + Math.PI) * 0.04 * idle - pose * 0.28;
      leftLeg.position.x = -0.12 - pose * 0.04;
      leftLeg.position.z = pose * 0.16 * (1 - moveBlend) + stride * 0.12 * moveBlend;
      leftLeg.rotation.x = standLeftX * (1 - moveBlend) + stride * 0.7 * moveBlend;
      leftLeg.rotation.y = pose * 0.12 * (1 - moveBlend);
      leftLeg.rotation.z = pose * 0.08 * (1 - moveBlend);
      rightLeg.position.x = 0.12 + pose * 0.03;
      rightLeg.position.z = -pose * 0.14 * (1 - moveBlend) + strideOpp * 0.12 * moveBlend;
      rightLeg.rotation.x = standRightX * (1 - moveBlend) + strideOpp * 0.7 * moveBlend;
      rightLeg.rotation.y = -pose * 0.08 * (1 - moveBlend);
      rightLeg.rotation.z = -pose * 0.05 * (1 - moveBlend);

      if (combat && pose > 0.9) {
        fireCooldown -= dt;
        if (fireCooldown <= 0) {
          fireCooldown = 1 / fireRateHz;
          recoil = 1;
          flashTimer = 0.06;
        }
      }

      recoil = approach(recoil, 0, dt * 5.5);
      if (flashTimer > 0) {
        flashTimer -= dt;
        muzzleFlash.visibility = Math.min(1, flashTimer * 20);
        muzzleFlash.scaling.setAll(0.8 + Math.random() * 0.5);
      } else {
        muzzleFlash.visibility = 0;
      }

      shadow.update();
    },
    dispose: () => {
      for (const d of debris) d.node.dispose(false, true);
      shadow.dispose();
      root.dispose(false, true);
    },
  };

  rifle.position.copyFrom(IDLE_RIFLE_POS);
  rifle.rotation.copyFrom(IDLE_RIFLE_ROT);
  leftArm.rotation.copyFrom(IDLE_LEFT);
  rightArm.rotation.copyFrom(IDLE_RIGHT);

  return handle;
}
