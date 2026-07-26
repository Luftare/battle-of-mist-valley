import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { TEAM_COLORS, WORLD_COLORS, type Team } from "../theme/colors";
import { box, colorMat } from "../theme/materials";
import { createUnitShadow } from "./shadow";
import type { UnitHandle } from "./types";

/**
 * Blocky helicopter with spinning main + tail rotors and hover bob.
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

  // Fuselage
  box(scene, `${name}_fuse`, { w: 0.55, h: 0.4, d: 1.2 }, new Vector3(0, 0, 0), bodyMat, body);

  // Cockpit nose
  box(scene, `${name}_nose`, { w: 0.45, h: 0.32, d: 0.35 }, new Vector3(0, 0.02, 0.65), glassMat, body);

  // Team stripe
  box(scene, `${name}_stripe`, { w: 0.57, h: 0.1, d: 0.5 }, new Vector3(0, 0.05, -0.1), trimMat, body);

  // Tail boom
  box(scene, `${name}_boom`, { w: 0.14, h: 0.14, d: 0.9 }, new Vector3(0, 0.05, -0.9), darkMat, body);
  box(scene, `${name}_fin`, { w: 0.08, h: 0.35, d: 0.28 }, new Vector3(0, 0.2, -1.3), bodyMat, body);

  // Skids
  box(scene, `${name}_skidL`, { w: 0.06, h: 0.06, d: 0.9 }, new Vector3(-0.28, -0.32, 0.05), metalMat, body);
  box(scene, `${name}_skidR`, { w: 0.06, h: 0.06, d: 0.9 }, new Vector3(0.28, -0.32, 0.05), metalMat, body);
  box(scene, `${name}_strutLF`, { w: 0.05, h: 0.22, d: 0.05 }, new Vector3(-0.28, -0.2, 0.25), metalMat, body);
  box(scene, `${name}_strutLR`, { w: 0.05, h: 0.22, d: 0.05 }, new Vector3(-0.28, -0.2, -0.25), metalMat, body);
  box(scene, `${name}_strutRF`, { w: 0.05, h: 0.22, d: 0.05 }, new Vector3(0.28, -0.2, 0.25), metalMat, body);
  box(scene, `${name}_strutRR`, { w: 0.05, h: 0.22, d: 0.05 }, new Vector3(0.28, -0.2, -0.25), metalMat, body);

  // Main rotor hub + blades
  const mainRotor = new TransformNode(`${name}_mainRotor`, scene);
  mainRotor.parent = body;
  mainRotor.position = new Vector3(0, 0.28, 0);

  box(scene, `${name}_hub`, { w: 0.12, h: 0.1, d: 0.12 }, new Vector3(0, 0, 0), metalMat, mainRotor);

  const bladeMat = colorMat(scene, `${name}_blade`, WORLD_COLORS.metalDark);
  // Two crossed long blades (4 arms when spun)
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

  // Tail rotor
  const tailRotor = new TransformNode(`${name}_tailRotor`, scene);
  tailRotor.parent = body;
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

  // Long thin blob matching fuselage + boom (not a square)
  const shadow = createUnitShadow(scene, name, root, {
    width: 0.28,
    depth: 0.95,
    opacity: 0.22,
    sizePerHeight: -0.22,
    getCasterHeight: () => body.position.y,
    getYaw: () => root.rotation.y + body.rotation.y,
  });

  return {
    root,
    team,
    kind: "helicopter",
    update: (dt, time) => {
      const t = time + phase;

      // Hover bob + gentle drift
      body.position.y = 1.35 + Math.sin(t * 1.8) * 0.06 + Math.sin(t * 0.7) * 0.03;
      body.rotation.z = Math.sin(t * 1.1) * 0.05;
      body.rotation.x = Math.sin(t * 0.9) * 0.035;
      body.rotation.y = Math.sin(t * 0.4) * 0.08;

      // Spinning rotors
      mainSpin += dt * 14;
      tailSpin += dt * 22;
      mainRotor.rotation.y = mainSpin;
      tailRotor.rotation.x = tailSpin;

      shadow.update();
    },
    dispose: () => {
      shadow.dispose();
      root.dispose(false, true);
    },
  };
}
