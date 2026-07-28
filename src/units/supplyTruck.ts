import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
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
import { approach, type UnitHandle } from "./types";

/**
 * Soft logistics truck — no weapons, mints coins while alive.
 * Durability matches the helicopter.
 */
export function createSupplyTruck(
  scene: Scene,
  name: string,
  team: Team,
): UnitHandle {
  const palette = TEAM_COLORS[team];
  const root = new TransformNode(`${name}_root`, scene);
  const combatState = createUnitCombatState("supplyTruck");
  const knockback = createKnockback();
  const hitPoint = new Vector3();
  const muzzleWorld = new Vector3();

  const bodyMat = colorMat(scene, `${name}_body`, palette.primary);
  const trimMat = colorMat(scene, `${name}_trim`, palette.secondary);
  const darkMat = colorMat(scene, `${name}_dark`, palette.dark);
  const metalMat = colorMat(scene, `${name}_metal`, WORLD_COLORS.metal);
  const metalDark = colorMat(scene, `${name}_metalDark`, WORLD_COLORS.metalDark);
  const crateMat = colorMat(scene, `${name}_crate`, "#8a7048");
  const glassMat = colorMat(scene, `${name}_glass`, "#2a3540", { specular: 0.4 });
  const goldMat = colorMat(scene, `${name}_gold`, "#d4a84b", { emissive: 0.2 });

  const body = new TransformNode(`${name}_body`, scene);
  body.parent = root;
  body.position.y = 0.42;

  // Cab
  box(
    scene,
    `${name}_cab`,
    { w: 0.72, h: 0.55, d: 0.55 },
    new Vector3(0, 0.12, 0.55),
    bodyMat,
    body,
  );
  box(
    scene,
    `${name}_windshield`,
    { w: 0.58, h: 0.28, d: 0.08 },
    new Vector3(0, 0.22, 0.82),
    glassMat,
    body,
  );
  box(
    scene,
    `${name}_cabStripe`,
    { w: 0.74, h: 0.1, d: 0.06 },
    new Vector3(0, 0.05, 0.82),
    trimMat,
    body,
  );

  // Cargo bed
  box(
    scene,
    `${name}_bed`,
    { w: 0.78, h: 0.22, d: 0.95 },
    new Vector3(0, -0.05, -0.25),
    metalMat,
    body,
  );
  box(
    scene,
    `${name}_bedRailL`,
    { w: 0.06, h: 0.28, d: 0.9 },
    new Vector3(-0.38, 0.12, -0.25),
    metalDark,
    body,
  );
  box(
    scene,
    `${name}_bedRailR`,
    { w: 0.06, h: 0.28, d: 0.9 },
    new Vector3(0.38, 0.12, -0.25),
    metalDark,
    body,
  );

  // Crates in the bed
  const crateA = box(
    scene,
    `${name}_crateA`,
    { w: 0.32, h: 0.28, d: 0.32 },
    new Vector3(-0.12, 0.22, -0.1),
    crateMat,
    body,
  );
  const crateB = box(
    scene,
    `${name}_crateB`,
    { w: 0.28, h: 0.24, d: 0.28 },
    new Vector3(0.14, 0.2, -0.4),
    darkMat,
    body,
  );
  box(
    scene,
    `${name}_coinMark`,
    { w: 0.16, h: 0.16, d: 0.05 },
    new Vector3(-0.12, 0.38, 0.02),
    goldMat,
    body,
  );

  // Chassis / bumper
  box(
    scene,
    `${name}_bumper`,
    { w: 0.78, h: 0.12, d: 0.12 },
    new Vector3(0, -0.22, 0.85),
    metalDark,
    body,
  );

  // Wheels
  const wheels: TransformNode[] = [];
  const wheelPos: [number, number, number][] = [
    [-0.4, -0.28, 0.5],
    [0.4, -0.28, 0.5],
    [-0.4, -0.28, -0.45],
    [0.4, -0.28, -0.45],
  ];
  for (let i = 0; i < wheelPos.length; i++) {
    const [x, y, z] = wheelPos[i];
    const wheel = new TransformNode(`${name}_wheel_${i}`, scene);
    wheel.parent = body;
    wheel.position.set(x, y, z);
    const tire = cylinder(
      scene,
      `${name}_tire_${i}`,
      { height: 0.14, diameter: 0.32, tessellation: 8 },
      Vector3.Zero(),
      darkMat,
      wheel,
    );
    tire.rotation.z = Math.PI / 2;
    wheels.push(wheel);
  }

  const phase = Math.random() * Math.PI * 2;
  let moving = false;
  let bounce = 0;
  const debris: DebrisPiece[] = [];
  const fallVel = new Vector3();
  const fallSpin = new Vector3();

  const shadow = createUnitShadow(scene, name, root, {
    width: 0.42,
    depth: 0.85,
    opacity: 0.28,
    sizePerHeight: 0.02,
    getCasterHeight: () => 0.55,
    getYaw: () => root.rotation.y,
  });

  const handle: UnitHandle = {
    root,
    team,
    kind: "supplyTruck",
    get fireRateHz() {
      return 0;
    },
    set fireRateHz(_hz) {
      /* no-op — unarmed */
    },
    get hp() {
      return combatState.hp;
    },
    get maxHp() {
      return combatState.maxHp;
    },
    get shootRange() {
      return 0;
    },
    get moveSpeed() {
      return combatState.moveSpeed;
    },
    get damage() {
      return 0;
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
    getMuzzlePoint: (out?: Vector3) => handle.getHitPoint(out ?? muzzleWorld),
    applyImpact: (fromX, fromZ, strength) => {
      if (combatState.destroyed) return;
      knockback.applyImpact(fromX, fromZ, strength, root);
    },
    setCombat: () => {
      /* unarmed */
    },
    setAimTarget: (_target: CombatEntity | null) => {
      /* unarmed */
    },
    setOnFire: () => {
      /* unarmed */
    },
    setOnMissileHit: () => {
      /* unarmed */
    },
    setMoving: (active) => {
      if (combatState.destroyed) return;
      moving = active;
    },
    destroy: () => {
      if (combatState.destroyed) return;
      combatState.beginDeath();
      moving = false;

      debris.push(
        makeDebris(
          crateA,
          randBurst(2, 4, { y: 1.2 }),
          randSpin(4, 10),
        ),
      );
      debris.push(
        makeDebris(
          crateB,
          randBurst(2, 3.5, { y: 0.8, z: -0.4 }),
          randSpin(3, 8),
        ),
      );

      fallVel.set(
        randRange(-1.2, 1.2),
        randRange(0.8, 2.2),
        randRange(-1, 1),
      );
      fallSpin.set(
        randRange(1, 3) * randSign(),
        randRange(0.5, 2) * randSign(),
        randRange(1, 2.5) * randSign(),
      );
    },
    update: (dt, time) => {
      if (combatState.destroyed) {
        stepDebris(debris, dt);
        body.position.x += fallVel.x * dt;
        body.position.y += fallVel.y * dt;
        body.position.z += fallVel.z * dt;
        fallVel.y -= 9 * dt;
        body.rotation.x += fallSpin.x * dt;
        body.rotation.y += fallSpin.y * dt;
        body.rotation.z += fallSpin.z * dt;
        if (body.position.y < -0.2) {
          body.position.y = -0.2;
          fallVel.setAll(0);
          fallSpin.scaleInPlace(0.9);
        }
        combatState.updateCorpse(dt, root);
        shadow.update();
        return;
      }

      knockback.step(dt, root);

      const t = time + phase;
      bounce = approach(bounce, moving ? 1 : 0, dt * 4);
      body.position.y = 0.42 + Math.sin(t * (moving ? 14 : 2.2)) * 0.02 * (0.4 + bounce);
      body.rotation.z = Math.sin(t * (moving ? 10 : 1.4)) * 0.025 * bounce;

      if (moving) {
        for (const w of wheels) {
          w.rotation.x += dt * 8;
        }
      }

      crateA.position.y = 0.22 + Math.sin(t * 3.5) * 0.01 * bounce;
      crateB.position.y = 0.2 + Math.sin(t * 3.2 + 1) * 0.012 * bounce;

      shadow.update();
    },
    dispose: () => {
      shadow.dispose();
      root.dispose(false, true);
    },
  };

  return handle;
}
