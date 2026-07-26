import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { TEAM_COLORS, WORLD_COLORS, type Team } from "../theme/colors";
import { box, colorMat } from "../theme/materials";
import { createUnitShadow } from "./shadow";
import type { UnitHandle } from "./types";

/**
 * Blocky rifleman: one box per limb, torso, head, helmet.
 * Idle: breathing sway + subtle weight shift + rifle bob.
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

  // Pivot at ground level; body floats above
  const body = new TransformNode(`${name}_body`, scene);
  body.parent = root;
  body.position.y = 0.55;

  // Torso
  box(scene, `${name}_torso`, { w: 0.42, h: 0.5, d: 0.28 }, new Vector3(0, 0.05, 0), bodyMat, body);

  // Team stripe on chest
  box(
    scene,
    `${name}_stripe`,
    { w: 0.44, h: 0.1, d: 0.08 },
    new Vector3(0, 0.12, 0.12),
    trimMat,
    body,
  );

  // Head
  const head = new TransformNode(`${name}_head`, scene);
  head.parent = body;
  head.position = new Vector3(0, 0.42, 0);
  box(scene, `${name}_headBox`, { w: 0.28, h: 0.28, d: 0.28 }, Vector3.Zero(), skinMat, head);

  // Helmet (slightly larger box on top)
  box(
    scene,
    `${name}_helmet`,
    { w: 0.32, h: 0.14, d: 0.34 },
    new Vector3(0, 0.18, 0.02),
    helmetMat,
    head,
  );
  // Helmet brim / team mark
  box(
    scene,
    `${name}_helmetMark`,
    { w: 0.12, h: 0.06, d: 0.06 },
    new Vector3(0, 0.2, 0.18),
    trimMat,
    head,
  );

  // Arms
  const leftArm = new TransformNode(`${name}_lArm`, scene);
  leftArm.parent = body;
  leftArm.position = new Vector3(-0.28, 0.15, 0);
  box(scene, `${name}_lArmBox`, { w: 0.14, h: 0.42, d: 0.14 }, new Vector3(0, -0.15, 0), bodyMat, leftArm);

  const rightArm = new TransformNode(`${name}_rArm`, scene);
  rightArm.parent = body;
  rightArm.position = new Vector3(0.28, 0.15, 0);
  box(scene, `${name}_rArmBox`, { w: 0.14, h: 0.42, d: 0.14 }, new Vector3(0, -0.15, 0), bodyMat, rightArm);

  // Rifle held across body
  const rifle = new TransformNode(`${name}_rifle`, scene);
  rifle.parent = rightArm;
  rifle.position = new Vector3(0, -0.2, 0.22);
  rifle.rotation.x = -0.15;
  rifle.rotation.y = 0.35;
  box(scene, `${name}_rifleStock`, { w: 0.08, h: 0.1, d: 0.22 }, new Vector3(0, 0, -0.12), darkMat, rifle);
  box(scene, `${name}_rifleBarrel`, { w: 0.06, h: 0.06, d: 0.45 }, new Vector3(0, 0.02, 0.18), metalMat, rifle);

  // Legs
  const leftLeg = new TransformNode(`${name}_lLeg`, scene);
  leftLeg.parent = body;
  leftLeg.position = new Vector3(-0.12, -0.22, 0);
  box(scene, `${name}_lLegBox`, { w: 0.16, h: 0.4, d: 0.16 }, new Vector3(0, -0.2, 0), darkMat, leftLeg);

  const rightLeg = new TransformNode(`${name}_rLeg`, scene);
  rightLeg.parent = body;
  rightLeg.position = new Vector3(0.12, -0.22, 0);
  box(scene, `${name}_rLegBox`, { w: 0.16, h: 0.4, d: 0.16 }, new Vector3(0, -0.2, 0), darkMat, rightLeg);

  // Per-unit phase so idle motions aren't synchronized
  const phase = Math.random() * Math.PI * 2;

  const shadow = createUnitShadow(scene, name, root, {
    width: 0.55,
    depth: 0.4,
    opacity: 0.45,
    getCasterHeight: () => 0.55,
  });

  return {
    root,
    team,
    kind: "rifleman",
    update: (_dt, time) => {
      const t = time + phase;
      // Breathing / torso sway
      body.position.y = 0.55 + Math.sin(t * 1.6) * 0.012;
      body.rotation.z = Math.sin(t * 1.1) * 0.03;
      body.rotation.x = Math.sin(t * 0.7) * 0.015;

      // Head looks around slowly
      head.rotation.y = Math.sin(t * 0.45) * 0.18;
      head.rotation.x = Math.sin(t * 0.6) * 0.05;

      // Arms / rifle idle
      leftArm.rotation.x = Math.sin(t * 1.2) * 0.06;
      rightArm.rotation.x = -0.25 + Math.sin(t * 1.3) * 0.05;
      rifle.rotation.z = Math.sin(t * 1.5) * 0.04;

      // Weight shift in legs
      leftLeg.rotation.x = Math.sin(t * 0.9) * 0.04;
      rightLeg.rotation.x = Math.sin(t * 0.9 + Math.PI) * 0.04;

      shadow.update();
    },
    dispose: () => {
      shadow.dispose();
      root.dispose(false, true);
    },
  };
}
