import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
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
import type { UnitHandle } from "./types";
import { createWreckSmoke, type WreckSmokeHandle } from "../fx/wreckSmoke";

/**
 * Blocky helicopter with spinning main + tail rotors and hover bob.
 * Destroy: main rotor flies off, tail boom snaps away, fuselage drops.
 */
export function createHelicopter(
  scene: Scene,
  name: string,
  team: Team,
): UnitHandle {
  const palette = TEAM_COLORS[team];
  const root = new TransformNode(`${name}_root`, scene);

  const bodyMat = colorMat(scene, `${name}_body`, palette.primary);
  const trimMat = colorMat(scene, `${name}_trim`, palette.secondary);
  const darkMat = colorMat(scene, `${name}_dark`, palette.dark);
  const metalMat = colorMat(scene, `${name}_metal`, WORLD_COLORS.metal);
  const glassMat = colorMat(scene, `${name}_glass`, palette.accent, {
    specular: 0.6,
    emissive: 0.08,
  });

  const body = new TransformNode(`${name}_body`, scene);
  body.parent = root;
  body.position.y = 1.35;

  box(scene, `${name}_fuse`, { w: 0.55, h: 0.4, d: 1.2 }, new Vector3(0, 0, 0), bodyMat, body);
  box(scene, `${name}_nose`, { w: 0.45, h: 0.32, d: 0.35 }, new Vector3(0, 0.02, 0.65), glassMat, body);
  box(scene, `${name}_stripe`, { w: 0.57, h: 0.1, d: 0.5 }, new Vector3(0, 0.05, -0.1), trimMat, body);

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
  let moving = false;
  let destroyed = false;
  const debris: DebrisPiece[] = [];
  const fallVel = new Vector3();
  const fallSpin = new Vector3();
  let smoke: WreckSmokeHandle | null = null;

  const shadow = createUnitShadow(scene, name, root, {
    width: 0.28,
    depth: 0.95,
    opacity: 0.22,
    sizePerHeight: -0.22,
    getCasterHeight: () => Math.max(0.2, body.position.y),
    getYaw: () => root.rotation.y + body.rotation.y,
  });

  return {
    root,
    team,
    kind: "helicopter",
    fireRateHz: 0,
    get destroyed() {
      return destroyed;
    },
    setCombat: () => {},
    setMoving: (active) => {
      if (destroyed) return;
      moving = active;
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      moving = false;

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
      if (destroyed) {
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
        return;
      }

      const t = time + phase;
      body.position.y = 1.35 + Math.sin(t * 1.8) * 0.06 + Math.sin(t * 0.7) * 0.03;
      body.rotation.z = Math.sin(t * 1.1) * 0.05;
      body.rotation.x = Math.sin(t * 0.9) * 0.035 + (moving ? 0.12 : 0);
      body.rotation.y = Math.sin(t * 0.4) * 0.08;

      const rotorMul = moving ? 1.35 : 1;
      mainSpin += dt * 5.5 * rotorMul;
      tailSpin += dt * 9 * rotorMul;
      mainRotor.rotation.y = mainSpin;
      tailRotor.rotation.x = tailSpin;

      shadow.update();
    },
    dispose: () => {
      smoke?.dispose();
      for (const d of debris) d.node.dispose(false, true);
      shadow.dispose();
      root.dispose(false, true);
    },
  };
}
