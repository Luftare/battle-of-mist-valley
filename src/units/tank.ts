import { Scene, TransformNode, Vector3 } from "@babylonjs/core";
import { TEAM_COLORS, WORLD_COLORS, type Team } from "../theme/colors";
import { box, colorMat, cylinder } from "../theme/materials";
import { createUnitShadow } from "./shadow";
import type { UnitHandle } from "./types";

/**
 * Blocky tank with a rotating turret and idle rumble / hatch sway.
 * Hull is strongly directional: sloped nose / lights at +Z, engine deck at -Z.
 */
export function createTank(scene: Scene, name: string, team: Team): UnitHandle {
  const palette = TEAM_COLORS[team];
  const root = new TransformNode(`${name}_root`, scene);

  const hullMat = colorMat(scene, `${name}_hull`, palette.primary);
  const trimMat = colorMat(scene, `${name}_trim`, palette.secondary);
  const darkMat = colorMat(scene, `${name}_dark`, palette.dark);
  const metalMat = colorMat(scene, `${name}_metal`, WORLD_COLORS.metal);
  const trackMat = colorMat(scene, `${name}_track`, WORLD_COLORS.metalDark);

  const body = new TransformNode(`${name}_body`, scene);
  body.parent = root;
  body.position.y = 0.28;

  // Main hull — longer fore/aft, slightly lower at the nose side
  box(scene, `${name}_hull`, { w: 1.05, h: 0.32, d: 1.35 }, new Vector3(0, 0.02, -0.05), hullMat, body);

  // Big glacis / front slope (+Z) — reads as the nose
  const glacis = box(
    scene,
    `${name}_glacis`,
    { w: 1.0, h: 0.28, d: 0.55 },
    new Vector3(0, 0.06, 0.72),
    hullMat,
    body,
  );
  glacis.rotation.x = -0.55;

  // Front lower plate / dozer lip
  box(scene, `${name}_noseLip`, { w: 1.02, h: 0.1, d: 0.18 }, new Vector3(0, -0.08, 0.95), darkMat, body);

  // Headlights on the nose
  box(scene, `${name}_lightL`, { w: 0.1, h: 0.08, d: 0.08 }, new Vector3(-0.32, 0.12, 0.98), trimMat, body);
  box(scene, `${name}_lightR`, { w: 0.1, h: 0.08, d: 0.08 }, new Vector3(0.32, 0.12, 0.98), trimMat, body);

  // Driver viewport block on front deck
  box(scene, `${name}_driver`, { w: 0.28, h: 0.12, d: 0.22 }, new Vector3(-0.22, 0.22, 0.45), darkMat, body);

  // Team chevron pointing forward on the glacis
  box(scene, `${name}_chevron`, { w: 0.22, h: 0.06, d: 0.14 }, new Vector3(0, 0.18, 0.78), trimMat, body);

  // Raised engine deck at the rear (-Z)
  box(scene, `${name}_engine`, { w: 0.95, h: 0.28, d: 0.55 }, new Vector3(0, 0.2, -0.72), darkMat, body);
  // Exhaust stacks — unmistakable rear cue
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
  // Rear bumper / tow hitch
  box(scene, `${name}_rearPlate`, { w: 0.9, h: 0.22, d: 0.1 }, new Vector3(0, 0.02, -1.05), metalMat, body);
  box(scene, `${name}_hitch`, { w: 0.16, h: 0.1, d: 0.14 }, new Vector3(0, -0.02, -1.14), darkMat, body);

  // Side skirts / team stripes (longer toward rear for asymmetry)
  box(scene, `${name}_markL`, { w: 0.06, h: 0.16, d: 0.55 }, new Vector3(-0.54, 0.1, 0.15), trimMat, body);
  box(scene, `${name}_markR`, { w: 0.06, h: 0.16, d: 0.55 }, new Vector3(0.54, 0.1, 0.15), trimMat, body);

  // Tracks
  box(scene, `${name}_trackL`, { w: 0.22, h: 0.28, d: 1.7 }, new Vector3(-0.55, -0.12, -0.05), trackMat, body);
  box(scene, `${name}_trackR`, { w: 0.22, h: 0.28, d: 1.7 }, new Vector3(0.55, -0.12, -0.05), trackMat, body);

  // Front fenders sticking past the nose
  box(scene, `${name}_fenderL`, { w: 0.24, h: 0.08, d: 0.28 }, new Vector3(-0.55, 0.02, 0.85), hullMat, body);
  box(scene, `${name}_fenderR`, { w: 0.24, h: 0.08, d: 0.28 }, new Vector3(0.55, 0.02, 0.85), hullMat, body);

  // Road wheels — smaller at front, larger drive sprocket at rear
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

  // Turret sits slightly forward of center (classic tank silhouette)
  const turret = new TransformNode(`${name}_turret`, scene);
  turret.parent = body;
  turret.position = new Vector3(0, 0.28, 0.12);

  box(scene, `${name}_turretBox`, { w: 0.68, h: 0.3, d: 0.72 }, new Vector3(0, 0.1, 0), darkMat, turret);
  // Mantlet / gun shield on the front of the turret
  box(scene, `${name}_mantlet`, { w: 0.36, h: 0.26, d: 0.2 }, new Vector3(0, 0.1, 0.4), metalMat, turret);
  box(scene, `${name}_turretMark`, { w: 0.26, h: 0.05, d: 0.26 }, new Vector3(0, 0.28, -0.05), trimMat, turret);

  // Bustle box at turret rear
  box(scene, `${name}_bustle`, { w: 0.5, h: 0.2, d: 0.28 }, new Vector3(0, 0.08, -0.42), hullMat, turret);

  const hatch = box(
    scene,
    `${name}_hatch`,
    { w: 0.2, h: 0.08, d: 0.2 },
    new Vector3(0.14, 0.28, 0.05),
    metalMat,
    turret,
  );

  // Barrel
  const barrel = new TransformNode(`${name}_barrel`, scene);
  barrel.parent = turret;
  barrel.position = new Vector3(0, 0.12, 0.48);
  box(scene, `${name}_barrelBase`, { w: 0.16, h: 0.16, d: 0.22 }, new Vector3(0, 0, 0.05), metalMat, barrel);
  box(scene, `${name}_barrelTube`, { w: 0.09, h: 0.09, d: 0.95 }, new Vector3(0, 0, 0.55), metalMat, barrel);
  box(scene, `${name}_muzzle`, { w: 0.13, h: 0.13, d: 0.12 }, new Vector3(0, 0, 1.05), darkMat, barrel);

  const phase = Math.random() * Math.PI * 2;
  let turretAngle = phase;

  const shadow = createUnitShadow(scene, name, root, {
    width: 1.15,
    depth: 1.75,
    opacity: 0.5,
    getCasterHeight: () => 0.35,
  });

  return {
    root,
    team,
    kind: "tank",
    update: (dt, time) => {
      const t = time + phase;

      body.position.y = 0.28 + Math.sin(t * 18) * 0.004 + Math.sin(t * 3.2) * 0.006;
      body.rotation.z = Math.sin(t * 2.1) * 0.012;
      body.rotation.x = Math.sin(t * 1.7) * 0.008;

      turretAngle += dt * 0.25;
      turret.rotation.y = turretAngle + Math.sin(t * 0.35) * 0.15;

      barrel.rotation.x = Math.sin(t * 0.55) * 0.06;

      hatch.position.y = 0.28 + Math.sin(t * 12) * 0.003;

      shadow.update();
    },
    dispose: () => {
      shadow.dispose();
      root.dispose(false, true);
    },
  };
}
