import type { TransformNode, Vector3 } from "@babylonjs/core";
import type { CombatEntity } from "../game/combatEntity";
import { CORPSE_LIFETIME_SEC, UNIT_STATS, type UnitKind } from "../game/stats";

export type MissileHitCallback = (target: CombatEntity, hitPos: Vector3) => void;

export interface UnitCombatState {
  hp: number;
  maxHp: number;
  shootRange: number;
  moveSpeed: number;
  damage: number;
  destroyed: boolean;
  expired: boolean;
  onFire: (() => void) | null;
  onMissileHit: MissileHitCallback | null;
  beginDeath: () => void;
  updateCorpse: (dt: number, root: TransformNode) => void;
  takeDamage: (amount: number, onKill: () => void) => void;
}

export function createUnitCombatState(kind: UnitKind): UnitCombatState {
  const stats = UNIT_STATS[kind];
  let sinkAge = 0;
  let sinking = false;
  let baseY = 0;

  const state: UnitCombatState = {
    hp: stats.maxHp,
    maxHp: stats.maxHp,
    shootRange: stats.shootRange,
    moveSpeed: stats.moveSpeed,
    damage: stats.damage,
    destroyed: false,
    expired: false,
    onFire: null,
    onMissileHit: null,
    beginDeath: () => {
      state.destroyed = true;
      sinkAge = 0;
      sinking = false;
    },
    updateCorpse: (dt, root) => {
      if (state.expired) return;
      sinkAge += dt;
      if (!sinking && sinkAge > 1.2) {
        sinking = true;
        baseY = root.position.y;
      }
      if (sinking) {
        const sinkT = Math.min(1, (sinkAge - 1.2) / (CORPSE_LIFETIME_SEC - 1.2));
        root.position.y = baseY - sinkT * 1.8;
      }
      if (sinkAge >= CORPSE_LIFETIME_SEC) state.expired = true;
    },
    takeDamage: (amount, onKill) => {
      if (state.destroyed || amount <= 0) return;
      state.hp = Math.max(0, state.hp - amount);
      if (state.hp <= 0) onKill();
    },
  };

  return state;
}
