import {
  Color3,
  Mesh,
  MeshBuilder,
  Scene,
  StandardMaterial,
  TransformNode,
  Vector3,
} from "@babylonjs/core";

export interface ExplosionOptions {
  /** Overall size multiplier. Missile ~1.35, tank shell ~1.0. */
  scale?: number;
  /** Lifetime in seconds (flash/fire portion). */
  duration?: number;
}

interface Shard {
  mesh: Mesh;
  vel: Vector3;
  spin: Vector3;
  life: number;
}

interface DebrisBit {
  mesh: Mesh;
  vel: Vector3;
  spin: Vector3;
  /** World Y of the ground under this bit. */
  groundY: number;
  settled: boolean;
  fade: number;
}

/**
 * Blocky, juicy hit explosion: bright flash core, expanding fire chunks,
 * and black debris chunks that arc under gravity and land.
 * Self-running — disposes when finished.
 */
export function spawnExplosion(
  scene: Scene,
  position: Vector3,
  opts?: ExplosionOptions,
): void {
  const scale = opts?.scale ?? 1;
  const duration = opts?.duration ?? 0.55;
  const root = new TransformNode(`fx_boom_${Math.random().toString(36).slice(2, 8)}`, scene);
  root.position.copyFrom(position);

  const flashMat = new StandardMaterial(`${root.name}_flash`, scene);
  flashMat.diffuseColor = new Color3(1, 0.85, 0.35);
  flashMat.emissiveColor = new Color3(1, 0.7, 0.2);
  flashMat.specularColor = Color3.Black();
  flashMat.disableLighting = true;

  const fireMat = new StandardMaterial(`${root.name}_fire`, scene);
  fireMat.diffuseColor = new Color3(1, 0.45, 0.12);
  fireMat.emissiveColor = new Color3(0.95, 0.35, 0.05);
  fireMat.specularColor = Color3.Black();
  fireMat.disableLighting = true;

  const smokeMat = new StandardMaterial(`${root.name}_smoke`, scene);
  smokeMat.diffuseColor = new Color3(0.18, 0.16, 0.14);
  smokeMat.emissiveColor = new Color3(0.06, 0.05, 0.04);
  smokeMat.specularColor = Color3.Black();
  smokeMat.disableLighting = true;

  const debrisMat = new StandardMaterial(`${root.name}_debris`, scene);
  debrisMat.diffuseColor = new Color3(0.05, 0.05, 0.05);
  debrisMat.emissiveColor = new Color3(0.02, 0.02, 0.02);
  debrisMat.specularColor = Color3.Black();

  const core = MeshBuilder.CreateBox(
    `${root.name}_core`,
    { size: 0.35 * scale },
    scene,
  );
  core.material = flashMat;
  core.parent = root;
  core.isPickable = false;

  const ring = MeshBuilder.CreateBox(
    `${root.name}_ring`,
    { width: 0.2 * scale, height: 0.08 * scale, depth: 0.2 * scale },
    scene,
  );
  ring.material = fireMat;
  ring.parent = root;
  ring.isPickable = false;

  const shards: Shard[] = [];
  const shardCount = Math.round(8 + scale * 4);
  for (let i = 0; i < shardCount; i++) {
    const isSmoke = i % 3 === 0;
    const size = (isSmoke ? 0.18 : 0.1) * scale * (0.6 + Math.random() * 0.8);
    const mesh = MeshBuilder.CreateBox(
      `${root.name}_shard_${i}`,
      { size },
      scene,
    );
    mesh.material = isSmoke ? smokeMat : i % 2 === 0 ? fireMat : flashMat;
    mesh.parent = root;
    mesh.isPickable = false;
    mesh.position.set(
      (Math.random() - 0.5) * 0.15 * scale,
      (Math.random() - 0.5) * 0.1 * scale,
      (Math.random() - 0.5) * 0.15 * scale,
    );
    const speed = (isSmoke ? 1.6 : 3.8) * scale * (0.55 + Math.random());
    const yaw = Math.random() * Math.PI * 2;
    const pitch = Math.random() * 0.9 + 0.25;
    shards.push({
      mesh,
      vel: new Vector3(
        Math.cos(yaw) * Math.sin(pitch) * speed,
        Math.cos(pitch) * speed * (isSmoke ? 0.7 : 1.1),
        Math.sin(yaw) * Math.sin(pitch) * speed,
      ),
      spin: new Vector3(
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
        (Math.random() - 0.5) * 14,
      ),
      life: duration * (0.55 + Math.random() * 0.45),
    });
  }

  // Black debris in world space so gravity lands them on the ground
  const debris: DebrisBit[] = [];
  const debrisCount = Math.round(7 + scale * 8);
  const groundY = 0.06;
  for (let i = 0; i < debrisCount; i++) {
    const w = (0.06 + Math.random() * 0.14) * scale;
    const h = (0.05 + Math.random() * 0.12) * scale;
    const d = (0.05 + Math.random() * 0.14) * scale;
    const mesh = MeshBuilder.CreateBox(
      `${root.name}_debris_${i}`,
      { width: w, height: h, depth: d },
      scene,
    );
    mesh.material = debrisMat;
    mesh.isPickable = false;
    mesh.position.set(
      position.x + (Math.random() - 0.5) * 0.2 * scale,
      position.y + (Math.random() - 0.2) * 0.15 * scale,
      position.z + (Math.random() - 0.5) * 0.2 * scale,
    );
    mesh.rotation.set(
      Math.random() * Math.PI,
      Math.random() * Math.PI,
      Math.random() * Math.PI,
    );

    const yaw = Math.random() * Math.PI * 2;
    const speed = (2.2 + Math.random() * 4.5) * scale;
    const up = 2.5 + Math.random() * 5.5 * scale;
    debris.push({
      mesh,
      vel: new Vector3(
        Math.cos(yaw) * speed * (0.4 + Math.random()),
        up,
        Math.sin(yaw) * speed * (0.4 + Math.random()),
      ),
      spin: new Vector3(
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18,
        (Math.random() - 0.5) * 18,
      ),
      groundY: groundY + h * 0.5,
      settled: false,
      fade: 1.1 + Math.random() * 0.7,
    });
  }

  let age = 0;
  const observer = scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, scene.getEngine().getDeltaTime() / 1000);
    age += dt;
    const t = Math.min(1, age / duration);

    // Core punch: expand then vanish
    const corePulse = t < 0.18 ? t / 0.18 : Math.max(0, 1 - (t - 0.18) / 0.35);
    const coreScale = (0.6 + corePulse * 2.4) * scale;
    core.scaling.setAll(Math.max(0.01, coreScale));
    core.visibility = Math.max(0, corePulse);
    core.rotation.y += dt * 8;
    core.rotation.x += dt * 5;

    // Shock ring flattens outward
    const ringT = Math.min(1, t / 0.4);
    const ringSize = (0.4 + ringT * 3.2) * scale;
    ring.scaling.set(ringSize, 0.35 + (1 - ringT) * 0.8, ringSize);
    ring.visibility = Math.max(0, 1 - ringT);
    ring.rotation.y += dt * 3;

    for (let i = shards.length - 1; i >= 0; i--) {
      const s = shards[i];
      s.life -= dt;
      s.vel.y -= 9 * dt;
      s.mesh.position.addInPlaceFromFloats(s.vel.x * dt, s.vel.y * dt, s.vel.z * dt);
      s.mesh.rotation.x += s.spin.x * dt;
      s.mesh.rotation.y += s.spin.y * dt;
      s.mesh.rotation.z += s.spin.z * dt;
      s.vel.scaleInPlace(1 - 1.8 * dt);
      const fade = Math.max(0, s.life / duration);
      s.mesh.visibility = fade;
      s.mesh.scaling.setAll(0.4 + fade * 0.8);
      if (s.life <= 0) {
        s.mesh.dispose();
        shards.splice(i, 1);
      }
    }

    for (let i = debris.length - 1; i >= 0; i--) {
      const bit = debris[i];
      if (!bit.settled) {
        bit.vel.y -= 18 * dt;
        bit.mesh.position.x += bit.vel.x * dt;
        bit.mesh.position.y += bit.vel.y * dt;
        bit.mesh.position.z += bit.vel.z * dt;
        bit.mesh.rotation.x += bit.spin.x * dt;
        bit.mesh.rotation.y += bit.spin.y * dt;
        bit.mesh.rotation.z += bit.spin.z * dt;
        // Light air drag
        bit.vel.x *= 1 - 0.6 * dt;
        bit.vel.z *= 1 - 0.6 * dt;

        if (bit.mesh.position.y <= bit.groundY) {
          bit.mesh.position.y = bit.groundY;
          if (Math.abs(bit.vel.y) > 2.5) {
            bit.vel.y *= -0.28;
            bit.vel.x *= 0.55;
            bit.vel.z *= 0.55;
            bit.spin.scaleInPlace(0.5);
          } else {
            bit.settled = true;
            bit.vel.setAll(0);
            bit.spin.scaleInPlace(0.15);
          }
        }
      } else {
        bit.mesh.rotation.y += bit.spin.y * dt;
        bit.spin.scaleInPlace(0.9);
        bit.fade -= dt;
        bit.mesh.visibility = Math.max(0, Math.min(1, bit.fade));
        if (bit.fade <= 0) {
          bit.mesh.dispose();
          debris.splice(i, 1);
        }
      }
    }

    if (age >= duration && shards.length === 0 && debris.length === 0) {
      scene.onBeforeRenderObservable.remove(observer);
      flashMat.dispose();
      fireMat.dispose();
      smokeMat.dispose();
      debrisMat.dispose();
      root.dispose(false, true);
    }
  });
}
