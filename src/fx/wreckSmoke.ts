import {
  Color4,
  DynamicTexture,
  MeshBuilder,
  ParticleSystem,
  Scene,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

let smokeTexture: DynamicTexture | null = null;

function getSmokeTexture(scene: Scene): DynamicTexture {
  if (smokeTexture) return smokeTexture;

  const tex = new DynamicTexture("wreckSmokeTex", { width: 64, height: 64 }, scene, false);
  const ctx = tex.getContext();
  const grad = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  grad.addColorStop(0, "rgba(30, 30, 30, 0.95)");
  grad.addColorStop(0.35, "rgba(18, 18, 18, 0.55)");
  grad.addColorStop(1, "rgba(0, 0, 0, 0)");
  ctx.clearRect(0, 0, 64, 64);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);
  tex.hasAlpha = true;
  tex.update();
  smokeTexture = tex;
  return tex;
}

export interface WreckSmokeHandle {
  start: () => void;
  /** Keep the emitter on the wreck while staying world-upright. */
  update: () => void;
  dispose: () => void;
}

/**
 * Continuous black smoke column that always rises in world +Y,
 * even when the wrecked hull is tilted.
 */
export function createWreckSmoke(
  scene: Scene,
  source: TransformNode,
  opts?: { rate?: number; scale?: number },
): WreckSmokeHandle {
  const scale = opts?.scale ?? 1;
  // Independent of source orientation — only tracks world position
  const anchor = MeshBuilder.CreateBox(
    `${source.name}_smokeAnchor`,
    { size: 0.05 },
    scene,
  );
  anchor.isVisible = false;
  anchor.isPickable = false;
  anchor.rotation.setAll(0);

  const ps = new ParticleSystem(`${source.name}_smoke`, 120, scene);
  ps.particleTexture = getSmokeTexture(scene);
  ps.emitter = anchor;
  ps.isLocal = false;
  ps.minEmitBox = new Vector3(-0.25 * scale, 0.05, -0.25 * scale);
  ps.maxEmitBox = new Vector3(0.25 * scale, 0.2 * scale, 0.25 * scale);
  ps.color1 = new Color4(0.06, 0.06, 0.06, 0.9);
  ps.color2 = new Color4(0.14, 0.14, 0.14, 0.65);
  ps.colorDead = new Color4(0.04, 0.04, 0.04, 0);
  ps.minSize = 0.35 * scale;
  ps.maxSize = 0.95 * scale;
  ps.minLifeTime = 1.4;
  ps.maxLifeTime = 3.2;
  ps.emitRate = opts?.rate ?? 28;
  ps.blendMode = ParticleSystem.BLENDMODE_STANDARD;
  // World-space rise
  ps.gravity = new Vector3(0, 0.2, 0);
  ps.direction1 = new Vector3(-0.2, 1.2, -0.2);
  ps.direction2 = new Vector3(0.2, 2.0, 0.2);
  ps.minEmitPower = 0.4;
  ps.maxEmitPower = 1.1;
  ps.updateSpeed = 0.016;
  ps.minAngularSpeed = -1.2;
  ps.maxAngularSpeed = 1.2;
  ps.addSizeGradient(0, 0.45);
  ps.addSizeGradient(0.4, 1.1);
  ps.addSizeGradient(1, 2.4);
  ps.addColorGradient(0, new Color4(0.1, 0.1, 0.1, 0.85));
  ps.addColorGradient(0.5, new Color4(0.07, 0.07, 0.07, 0.45));
  ps.addColorGradient(1, new Color4(0.04, 0.04, 0.04, 0));

  const syncAnchor = () => {
    const world = source.getAbsolutePosition();
    anchor.position.x = world.x;
    anchor.position.y = world.y + 0.2 * scale;
    anchor.position.z = world.z;
    anchor.rotation.setAll(0);
    if (anchor.rotationQuaternion) {
      anchor.rotationQuaternion.set(0, 0, 0, 1);
    }
  };
  syncAnchor();

  return {
    start: () => {
      syncAnchor();
      ps.start();
    },
    update: syncAnchor,
    dispose: () => {
      ps.stop();
      ps.dispose(false);
      anchor.dispose();
    },
  };
}
