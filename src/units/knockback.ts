import { Vector3 } from "@babylonjs/core";

/** Shared knockback state applied to unit roots each frame. */
export interface KnockbackState {
  vx: number;
  vz: number;
  tipX: number;
  tipZ: number;
  applyImpact: (fromX: number, fromZ: number, strength: number, root: { position: Vector3 }) => void;
  /** Integrate knockback into root position; returns tip for body lean. */
  step: (dt: number, root: { position: Vector3 }) => { tipX: number; tipZ: number };
}

export function createKnockback(): KnockbackState {
  const state: KnockbackState = {
    vx: 0,
    vz: 0,
    tipX: 0,
    tipZ: 0,
    applyImpact: (fromX, fromZ, strength, root) => {
      const dx = root.position.x - fromX;
      const dz = root.position.z - fromZ;
      const len = Math.hypot(dx, dz) || 1;
      state.vx += (dx / len) * strength;
      state.vz += (dz / len) * strength;
      state.tipX += (dx / len) * strength * 0.08;
      state.tipZ += (dz / len) * strength * 0.08;
    },
    step: (dt, root) => {
      root.position.x += state.vx * dt;
      root.position.z += state.vz * dt;
      const damp = Math.exp(-8 * dt);
      state.vx *= damp;
      state.vz *= damp;
      state.tipX *= Math.exp(-5 * dt);
      state.tipZ *= Math.exp(-5 * dt);
      return { tipX: state.tipX, tipZ: state.tipZ };
    },
  };
  return state;
}
