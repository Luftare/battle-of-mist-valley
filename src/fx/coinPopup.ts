import {
  Color3,
  DynamicTexture,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  Vector3,
} from "@babylonjs/core";

interface CoinPopup {
  mesh: Mesh;
  mat: StandardMaterial;
  tex: DynamicTexture;
  world: Vector3;
  follow: (() => Vector3) | null;
  age: number;
  life: number;
  rise: number;
}

interface PendingSpawn {
  world: Vector3;
  amount: number;
  follow: (() => Vector3) | null;
}

export interface CoinPopupSpawnOpts {
  /**
   * While set, the label tracks this world position in XZ / base Y,
   * rising only on world +Y so coins lift off a moving truck.
   */
  follow?: () => Vector3;
}

export interface CoinPopupFx {
  spawn: (world: Vector3, amount: number, opts?: CoinPopupSpawnOpts) => void;
  update: (dt: number, scene: Scene) => void;
  dispose: () => void;
}

function amountText(amount: number): string {
  if (Number.isInteger(amount)) return String(amount);
  return amount.toFixed(1);
}

function createLabelTexture(scene: Scene, text: string): DynamicTexture {
  const w = 128;
  const h = 64;
  const tex = new DynamicTexture(
    `coinLabel_${text}_${Math.random().toString(36).slice(2, 7)}`,
    { width: w, height: h },
    scene,
    false,
  );
  const ctx = tex.getContext() as CanvasRenderingContext2D;
  ctx.clearRect(0, 0, w, h);
  ctx.font = "bold 42px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(0, 0, 0, 0.75)";
  ctx.strokeText(text, w * 0.5, h * 0.55);
  ctx.fillStyle = "#f0d078";
  ctx.fillText(text, w * 0.5, h * 0.55);
  tex.hasAlpha = true;
  tex.update();
  return tex;
}

/**
 * World-space "+N" coin labels that float up in 3D and face the camera.
 */
export function createCoinPopupFx(): CoinPopupFx {
  const popups: CoinPopup[] = [];
  const pending: PendingSpawn[] = [];
  let seq = 0;

  function flushPending(scene: Scene): void {
    while (pending.length > 0) {
      const job = pending.shift()!;
      const text = `+${amountText(job.amount)}`;
      const tex = createLabelTexture(scene, text);
      const mat = new StandardMaterial(`coinPopMat_${seq}`, scene);
      mat.diffuseTexture = tex;
      mat.emissiveTexture = tex;
      mat.opacityTexture = tex;
      mat.diffuseColor = Color3.White();
      mat.emissiveColor = Color3.White();
      mat.specularColor = Color3.Black();
      mat.backFaceCulling = false;
      mat.disableLighting = true;
      mat.useAlphaFromDiffuseTexture = true;
      mat.transparencyMode = 2; // ALPHA_BLEND
      mat.alpha = 1;

      const mesh = MeshBuilder.CreatePlane(
        `coinPop_${seq++}`,
        { width: 1.15, height: 0.55 },
        scene,
      );
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.renderingGroupId = 1;
      // Plane front faces −Z; flip X so billboarded text isn't mirrored
      mesh.scaling.x = -1;

      const base = job.follow ? job.follow() : job.world;
      mesh.position.set(base.x, base.y + 1.05, base.z);

      popups.push({
        mesh,
        mat,
        tex,
        world: job.world,
        follow: job.follow,
        age: 0,
        life: 1.2,
        rise: 0,
      });
    }
  }

  return {
    spawn: (world, amount, opts) => {
      pending.push({
        world: world.clone(),
        amount,
        follow: opts?.follow ?? null,
      });
    },
    update: (dt, scene) => {
      flushPending(scene);

      const cam = scene.activeCamera;
      for (let i = popups.length - 1; i >= 0; i--) {
        const p = popups[i];
        p.age += dt;
        p.rise += dt * 1.6;
        if (p.age >= p.life) {
          p.mesh.dispose(false, true);
          p.tex.dispose();
          popups.splice(i, 1);
          continue;
        }

        const base = p.follow ? p.follow() : p.world;
        p.mesh.position.set(base.x, base.y + 1.05 + p.rise, base.z);

        const t = p.age / p.life;
        p.mat.alpha = Math.max(0, 1 - t * t);
        const s = 0.85 + t * 0.25;
        p.mesh.scaling.set(-s, s, s);

        if (cam) {
          const cp = cam.globalPosition;
          const dx = cp.x - p.mesh.position.x;
          const dy = cp.y - p.mesh.position.y;
          const dz = cp.z - p.mesh.position.z;
          p.mesh.rotation.y = Math.atan2(dx, dz);
          p.mesh.rotation.x = -Math.atan2(dy, Math.hypot(dx, dz));
          p.mesh.rotation.z = 0;
        }
      }
    },
    dispose: () => {
      pending.length = 0;
      for (const p of popups) {
        p.mesh.dispose(false, true);
        p.tex.dispose();
      }
      popups.length = 0;
    },
  };
}
