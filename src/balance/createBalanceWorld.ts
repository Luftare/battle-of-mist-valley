import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  MeshBuilder,
  Scene,
  Vector3,
} from "@babylonjs/core";
import type { CombatEntity } from "../game/combatEntity";
import { createHpBar, type HpBarHandle } from "../game/hpBar";
import { clampToPlayfield, steerToward } from "../game/pathfinding";
import {
  ACCURACY_AT_MAX_RANGE,
  ACCURACY_AT_POINT_BLANK,
  COMBAT_UNIT_KINDS,
  HELI_GUN_DAMAGE,
  HELI_GUN_FIRE_HZ,
  HELI_GUN_RANGE,
  MISS_SCATTER_RADIUS,
  MISSILE_SPLASH_RADIUS,
  TANK_SPLASH_RADIUS,
  UNIT_STATS,
  type CombatUnitKind,
} from "../game/stats";
import { spawnBulletTrace } from "../fx/bulletTrace";
import { spawnExplosion } from "../fx/explosion";
import { WORLD_COLORS, type Team } from "../theme/colors";
import { colorMat } from "../theme/materials";
import {
  createHelicopter,
  createRifleman,
  createTank,
  type UnitHandle,
} from "../units";
import { shortestAngleDelta } from "../units/types";
import type { ArmyCounts, EncounterPlan } from "./solveEncounter";

const FIELD_W = 22;
const FIELD_D = 24;
const SPAWN_Z = 7.8;
const TANK_HULL_TURN_SPEED = 0.45;
const TANK_ALIGN_RAD = 0.2;
const UNIT_SEP_PADDING = 0.28;
const UNIT_SEP_STEER = 1.35;
const UNIT_SEP_RESOLVE = 7;

export type FightOutcome = "blue" | "red" | "draw";

export interface BalanceWorld {
  scene: Scene;
  loadPlan: (plan: EncounterPlan, opts?: { missiles?: boolean }) => void;
  setPaused: (paused: boolean) => void;
  setSpeed: (mul: number) => void;
  restart: () => void;
  dispose: () => void;
}

export interface BalanceWorldCallbacks {
  onOutcome: (winner: FightOutcome, elapsedSec: number) => void;
  onTick?: (info: { elapsedSec: number; livingBlue: number; livingRed: number }) => void;
}

interface Agent {
  unit: UnitHandle;
  hpBar: HpBarHandle;
  moveTarget: { x: number; z: number } | null;
  focus: CombatEntity | null;
  lockedUnit: UnitHandle | null;
}

interface SpawnSpec {
  plan: EncounterPlan;
  missiles: boolean;
}

function distXZ(a: Vector3, b: Vector3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

function rollAccuracy(distance: number, maxRange: number): boolean {
  const t =
    maxRange <= 1e-6 ? 0 : Math.min(1, Math.max(0, distance / maxRange));
  const base =
    ACCURACY_AT_POINT_BLANK +
    (ACCURACY_AT_MAX_RANGE - ACCURACY_AT_POINT_BLANK) * t;
  return Math.random() < base;
}

function scatterAim(from: Vector3, aim: Vector3, radius = MISS_SCATTER_RADIUS): Vector3 {
  const dx = aim.x - from.x;
  const dz = aim.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const fx = dx / len;
  const fz = dz / len;
  const px = -fz;
  const pz = fx;
  const lat = (Math.random() * 2 - 1) * radius;
  const along = (Math.random() * 2 - 1) * radius * 0.4;
  return new Vector3(
    aim.x + px * lat + fx * along,
    aim.y + (Math.random() - 0.5) * radius * 0.3,
    aim.z + pz * lat + fz * along,
  );
}

function createUnitOfKind(
  scene: Scene,
  name: string,
  team: Team,
  kind: CombatUnitKind,
): UnitHandle {
  if (kind === "rifleman") return createRifleman(scene, name, team);
  if (kind === "tank") return createTank(scene, name, team);
  return createHelicopter(scene, name, team);
}

function layoutArmy(
  counts: ArmyCounts,
  team: Team,
): Array<{ kind: CombatUnitKind; x: number; z: number }> {
  const zSign = team === "blue" ? -1 : 1;
  const columns = COMBAT_UNIT_KINDS.filter((kind) => counts[kind] > 0);
  const laneWidths = columns.map((kind) => UNIT_STATS[kind].radius * 2 + 1.25);
  const totalW = laneWidths.reduce((a, b) => a + b, 0);

  const out: Array<{ kind: CombatUnitKind; x: number; z: number }> = [];
  let x = -totalW * 0.5;
  columns.forEach((kind, i) => {
    x += laneWidths[i]! * 0.5;
    const n = counts[kind];
    const zGap = UNIT_STATS[kind].radius * 2.2 + 0.5;
    for (let rank = 0; rank < n; rank++) {
      out.push({
        kind,
        x,
        z: zSign * (SPAWN_Z + rank * zGap),
      });
    }
    x += laneWidths[i]! * 0.5;
  });
  return out;
}

/**
 * Flat empty arena: real combat rules, no buildings / trees / hills.
 * Units spawn from cost×interval-balanced counts and fight until one side is gone.
 */
export function createBalanceWorld(
  engine: Engine,
  canvas: HTMLCanvasElement,
  callbacks: BalanceWorldCallbacks,
): BalanceWorld {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.55, 0.72, 0.88, 1);
  scene.ambientColor = new Color3(0.35, 0.4, 0.32);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(0.62, 0.75, 0.88);
  scene.fogStart = 22;
  scene.fogEnd = 48;

  const camera = new ArcRotateCamera(
    "balanceCam",
    -Math.PI / 2.15,
    0.95,
    20,
    new Vector3(typeof window !== "undefined" && window.innerWidth > 720 ? 4.2 : 0, 0.4, 0),
    scene,
  );
  camera.lowerBetaLimit = 0.35;
  camera.upperBetaLimit = 1.2;
  camera.lowerRadiusLimit = 10;
  camera.upperRadiusLimit = 36;
  camera.wheelPrecision = 40;
  camera.pinchPrecision = 80;
  camera.panningSensibility = 80;
  camera.attachControl(canvas, true);
  camera.useInputToRestoreState = false;

  const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.3), scene);
  hemi.intensity = 0.78;
  hemi.groundColor = new Color3(0.25, 0.28, 0.18);
  hemi.diffuse = new Color3(0.95, 0.95, 0.88);

  const sun = new DirectionalLight("sun", new Vector3(-0.45, -0.85, -0.3), scene);
  sun.position = new Vector3(12, 22, 10);
  sun.intensity = 0.85;
  sun.diffuse = new Color3(1, 0.97, 0.9);

  const ground = MeshBuilder.CreateGround(
    "flatGround",
    { width: FIELD_W + 8, height: FIELD_D + 8, subdivisions: 1 },
    scene,
  );
  ground.material = colorMat(scene, "flatGrass", WORLD_COLORS.grass, {
    specular: 0.04,
  });

  const lane = MeshBuilder.CreateBox(
    "midLane",
    { width: FIELD_W - 2, height: 0.04, depth: 0.55 },
    scene,
  );
  lane.position.y = 0.02;
  lane.material = colorMat(scene, "midDirt", WORLD_COLORS.dirt, { specular: 0.05 });
  lane.isPickable = false;

  const halfX = FIELD_W * 0.5;
  const halfZ = FIELD_D * 0.5;
  const agents: Agent[] = [];
  let unitSeq = 0;
  let elapsed = 0;
  let paused = false;
  let speed = 1;
  let fightOver = false;
  let missilesEnabled = false;
  let lastSpec: SpawnSpec | null = null;

  function clearAgents(): void {
    for (const agent of agents) {
      agent.hpBar.dispose();
      agent.unit.dispose();
    }
    agents.length = 0;
  }

  function livingCount(team: Team): number {
    let n = 0;
    for (const agent of agents) {
      if (!agent.unit.destroyed && agent.unit.team === team) n++;
    }
    return n;
  }

  function bodyRadius(unit: UnitHandle): number {
    return UNIT_STATS[unit.kind as CombatUnitKind]?.radius ?? 0.4;
  }

  function sameMoveLayer(a: UnitHandle, b: UnitHandle): boolean {
    return (a.kind === "helicopter") === (b.kind === "helicopter");
  }

  function canTargetUnit(attacker: UnitHandle, other: UnitHandle): boolean {
    if (other.destroyed || other.team === attacker.team) return false;
    if (attacker.kind === "tank" && other.kind === "helicopter") return false;
    return true;
  }

  function engageRange(attacker: UnitHandle, target: CombatEntity): number {
    if (attacker.kind === "helicopter") {
      const useMissile =
        missilesEnabled &&
        "kind" in target &&
        ((target as UnitHandle).kind === "tank" ||
          (target as UnitHandle).kind === "supplyTruck");
      return useMissile ? attacker.shootRange : HELI_GUN_RANGE;
    }
    return attacker.shootRange;
  }

  function applyArealHit(
    center: Vector3,
    mainTarget: CombatEntity | null,
    baseDamage: number,
    radius: number,
    attackerTeam: Team,
    impact?: { impactFromX: number; impactFromZ: number; impactStrength: number },
  ): void {
    for (const other of agents) {
      const entity = other.unit;
      if (entity.destroyed || entity.team === attackerTeam) continue;
      const p = entity.root.position;
      const isMain = mainTarget !== null && entity === mainTarget;
      if (!isMain) {
        const d = Math.hypot(center.x - p.x, center.z - p.z);
        if (d > radius) continue;
      }
      entity.takeDamage(isMain ? baseDamage : baseDamage * 0.5);
      if (impact) {
        const strength = isMain ? impact.impactStrength : impact.impactStrength * 0.55;
        entity.applyImpact(impact.impactFromX, impact.impactFromZ, strength);
      }
    }
  }

  function wireUnitCombat(unit: UnitHandle): void {
    unit.setOnFire(() => {
      const target = findFocus(unit);
      if (!target || target.destroyed) return;

      const hit = target.getHitPoint();
      const from = unit.root.position;
      const isHeliGun = unit.kind === "helicopter";
      const isTankShell = unit.kind === "tank";
      let damage = isHeliGun ? HELI_GUN_DAMAGE : unit.damage;
      if (
        unit.kind === "rifleman" &&
        "kind" in target &&
        (target as UnitHandle).kind === "helicopter"
      ) {
        damage *= 2;
      }

      const maxRange = engageRange(unit, target);
      const didHit = rollAccuracy(distXZ(from, hit), maxRange);
      const impactAt = didHit ? hit : scatterAim(from, hit);

      if (isTankShell) {
        spawnExplosion(scene, impactAt, { scale: 1.15, duration: 0.55 });
        applyArealHit(impactAt, didHit ? target : null, damage, TANK_SPLASH_RADIUS, unit.team, {
          impactFromX: from.x,
          impactFromZ: from.z,
          impactStrength: 8.5,
        });
        return;
      }

      if (unit.kind === "rifleman" || isHeliGun) {
        spawnBulletTrace(scene, unit.getMuzzlePoint().clone(), impactAt, {
          speed: isHeliGun ? 70 : 58,
          length: isHeliGun ? 1.45 : 1.25,
          thickness: isHeliGun ? 0.08 : 0.07,
          color: isHeliGun ? "#ffe9a0" : "#fff8d8",
        });
      }

      if (!didHit) return;
      target.takeDamage(damage);
    });

    unit.setOnMissileHit((target, hit) => {
      spawnExplosion(scene, hit, { scale: 1.55, duration: 0.7 });
      applyArealHit(hit, target, unit.damage, MISSILE_SPLASH_RADIUS, unit.team);
    });
  }

  function findFocus(unit: UnitHandle): CombatEntity | null {
    const agent = agents.find((a) => a.unit === unit);
    return agent?.focus ?? null;
  }

  function findUnitToLock(unit: UnitHandle): UnitHandle | null {
    const pos = unit.root.position;
    let best: UnitHandle | null = null;
    let bestDist = Infinity;
    for (const other of agents) {
      if (!canTargetUnit(unit, other.unit)) continue;
      const range = engageRange(unit, other.unit);
      const d = distXZ(pos, other.unit.root.position);
      if (d <= range && d < bestDist) {
        bestDist = d;
        best = other.unit;
      }
    }
    return best;
  }

  function isEngagingVictim(attacker: Agent, victim: UnitHandle): boolean {
    if (attacker.unit.destroyed) return false;
    if (attacker.lockedUnit !== victim && attacker.focus !== victim) return false;
    return (
      distXZ(attacker.unit.root.position, victim.root.position) <=
      engageRange(attacker.unit, victim)
    );
  }

  function findEnemyEngaging(victim: UnitHandle): UnitHandle | null {
    const pos = victim.root.position;
    let best: UnitHandle | null = null;
    let bestDist = Infinity;
    for (const other of agents) {
      if (!canTargetUnit(victim, other.unit)) continue;
      if (!isEngagingVictim(other, victim)) continue;
      const d = distXZ(pos, other.unit.root.position);
      if (d < bestDist) {
        bestDist = d;
        best = other.unit;
      }
    }
    return best;
  }

  function neighborSeparation(agent: Agent): { x: number; z: number } {
    const unit = agent.unit;
    const ra = bodyRadius(unit);
    const px = unit.root.position.x;
    const pz = unit.root.position.z;
    let sx = 0;
    let sz = 0;
    for (const other of agents) {
      if (other === agent || other.unit.destroyed) continue;
      if (!sameMoveLayer(unit, other.unit)) continue;
      const rb = bodyRadius(other.unit);
      const prefer = ra + rb + UNIT_SEP_PADDING;
      const dx = px - other.unit.root.position.x;
      const dz = pz - other.unit.root.position.z;
      const d = Math.hypot(dx, dz);
      if (d >= prefer) continue;
      if (d < 1e-4) {
        sx += Math.random() - 0.5;
        sz += Math.random() - 0.5;
        continue;
      }
      const w = (prefer - d) / prefer;
      const force = w * w;
      sx += (dx / d) * force;
      sz += (dz / d) * force;
    }
    return { x: sx, z: sz };
  }

  function resolveUnitSeparation(dt: number): void {
    const n = agents.length;
    if (n < 2) return;
    const pushX = new Float64Array(n);
    const pushZ = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      const a = agents[i]!.unit;
      if (a.destroyed) continue;
      const ra = bodyRadius(a);
      const ax = a.root.position.x;
      const az = a.root.position.z;
      for (let j = i + 1; j < n; j++) {
        const b = agents[j]!.unit;
        if (b.destroyed) continue;
        if (!sameMoveLayer(a, b)) continue;
        const minDist = ra + bodyRadius(b) + UNIT_SEP_PADDING * 0.55;
        let dx = ax - b.root.position.x;
        let dz = az - b.root.position.z;
        let d = Math.hypot(dx, dz);
        if (d >= minDist) continue;
        if (d < 1e-4) {
          const ang = Math.random() * Math.PI * 2;
          dx = Math.cos(ang);
          dz = Math.sin(ang);
          d = 1;
        }
        const overlap = minDist - d;
        const push = overlap * 0.5;
        const nx = dx / d;
        const nz = dz / d;
        pushX[i] += nx * push;
        pushZ[i] += nz * push;
        pushX[j] -= nx * push;
        pushZ[j] -= nz * push;
      }
    }

    const rate = Math.min(1, UNIT_SEP_RESOLVE * dt);
    for (let i = 0; i < n; i++) {
      const unit = agents[i]!.unit;
      if (unit.destroyed) continue;
      const px = pushX[i]!;
      const pz = pushZ[i]!;
      if (px * px + pz * pz < 1e-8) continue;
      const next = clampToPlayfield(
        unit.root.position.x + px * rate,
        unit.root.position.z + pz * rate,
        halfX,
        halfZ,
        1.2,
      );
      unit.root.position.x = next.x;
      unit.root.position.z = next.z;
    }
  }

  function moveToward(agent: Agent, goal: { x: number; z: number }, dt: number): void {
    const { unit } = agent;
    const from = { x: unit.root.position.x, z: unit.root.position.z };
    let dir = steerToward(from, goal, [], {
      arriveDist: 0.45,
      agentRadius: unit.kind === "helicopter" ? 0 : bodyRadius(unit),
    });

    const sep = neighborSeparation(agent);
    const sepLen = Math.hypot(sep.x, sep.z);
    if (sepLen > 1e-4) {
      if (!dir) dir = { x: sep.x / sepLen, z: sep.z / sepLen };
      else {
        dir = {
          x: dir.x + sep.x * UNIT_SEP_STEER,
          z: dir.z + sep.z * UNIT_SEP_STEER,
        };
        const len = Math.hypot(dir.x, dir.z);
        if (len > 1e-5) dir = { x: dir.x / len, z: dir.z / len };
      }
    }

    if (!dir) {
      unit.setMoving(false);
      return;
    }

    const yaw = Math.atan2(dir.x, dir.z);
    if (unit.kind === "tank") {
      const dy = shortestAngleDelta(unit.root.rotation.y, yaw);
      unit.root.rotation.y +=
        Math.sign(dy) * Math.min(Math.abs(dy), TANK_HULL_TURN_SPEED * dt);
      if (Math.abs(dy) > TANK_ALIGN_RAD) {
        unit.setMoving(false);
        return;
      }
      unit.setMoving(true);
      const step = unit.moveSpeed * dt;
      const fx = Math.sin(unit.root.rotation.y);
      const fz = Math.cos(unit.root.rotation.y);
      const next = clampToPlayfield(
        unit.root.position.x + fx * step,
        unit.root.position.z + fz * step,
        halfX,
        halfZ,
        1.2,
      );
      unit.root.position.x = next.x;
      unit.root.position.z = next.z;
      return;
    }

    unit.setMoving(true);
    const step = unit.moveSpeed * dt;
    const next = clampToPlayfield(
      unit.root.position.x + dir.x * step,
      unit.root.position.z + dir.z * step,
      halfX,
      halfZ,
      1.2,
    );
    unit.root.position.x = next.x;
    unit.root.position.z = next.z;
    const dy = shortestAngleDelta(unit.root.rotation.y, yaw);
    unit.root.rotation.y += Math.sign(dy) * Math.min(Math.abs(dy), 5 * dt);
  }

  function faceTarget(unit: UnitHandle, target: CombatEntity, dt: number): void {
    const tp = target.root.position;
    const dx = tp.x - unit.root.position.x;
    const dz = tp.z - unit.root.position.z;
    if (dx * dx + dz * dz < 1e-4) return;
    const yaw = Math.atan2(dx, dz);
    if (unit.kind === "tank") {
      const dy = shortestAngleDelta(unit.root.rotation.y, yaw);
      unit.root.rotation.y +=
        Math.sign(dy) * Math.min(Math.abs(dy), TANK_HULL_TURN_SPEED * dt);
    }
  }

  function updateAgent(agent: Agent, dt: number): void {
    const { unit } = agent;
    if (unit.destroyed) {
      unit.setCombat(false);
      unit.setMoving(false);
      unit.setAimTarget(null);
      agent.lockedUnit = null;
      agent.focus = null;
      agent.hpBar.setVisible(false);
      return;
    }

    agent.hpBar.setRatio(unit.hp / unit.maxHp);
    agent.hpBar.update(
      unit.root.getAbsolutePosition(),
      UNIT_STATS[unit.kind as CombatUnitKind].hpBarHeight,
      camera.globalPosition,
    );

    if (agent.lockedUnit?.destroyed) agent.lockedUnit = null;

    const attacker = findEnemyEngaging(unit);
    if (attacker) {
      const locked = agent.lockedUnit;
      const lockedAgent = locked ? agents.find((a) => a.unit === locked) : undefined;
      const lockedFightsUs = lockedAgent ? isEngagingVictim(lockedAgent, unit) : false;
      if (!locked || locked === attacker || !lockedFightsUs) {
        if (locked !== attacker) agent.lockedUnit = attacker;
      }
    }

    if (!agent.lockedUnit) agent.lockedUnit = findUnitToLock(unit);

    if (agent.lockedUnit) {
      const locked = agent.lockedUnit;
      agent.focus = locked;
      const d = distXZ(unit.root.position, locked.root.position);
      if (d <= engageRange(unit, locked)) {
        unit.setCombat(true);
        unit.setAimTarget(locked);
        unit.setMoving(false);
        faceTarget(unit, locked, dt);
      } else {
        unit.setCombat(false);
        unit.setAimTarget(null);
        moveToward(agent, { x: locked.root.position.x, z: locked.root.position.z }, dt);
      }
      return;
    }

    agent.focus = null;
    unit.setCombat(false);
    unit.setAimTarget(null);
    if (!agent.moveTarget) {
      unit.setMoving(false);
      return;
    }
    moveToward(agent, agent.moveTarget, dt);
    if (
      Math.hypot(
        unit.root.position.x - agent.moveTarget.x,
        unit.root.position.z - agent.moveTarget.z,
      ) < 0.5
    ) {
      agent.moveTarget = null;
      unit.setMoving(false);
    }
  }

  function spawnArmy(counts: ArmyCounts, team: Team): void {
    const towardEnemy = team === "blue" ? 1 : -1;
    const spots = layoutArmy(counts, team);
    for (const spot of spots) {
      const unit = createUnitOfKind(
        scene,
        `${team}_${spot.kind}_${unitSeq++}`,
        team,
        spot.kind,
      );
      unit.root.position.x = spot.x;
      unit.root.position.z = spot.z;
      unit.root.position.y = 0;
      unit.root.rotation.y = towardEnemy > 0 ? 0 : Math.PI;
      unit.root.scaling.setAll(0.8);
      if (spot.kind === "helicopter") {
        unit.fireRateHz = HELI_GUN_FIRE_HZ;
        if (missilesEnabled) unit.setMissilesEnabled(true);
      }
      const hpBar = createHpBar(scene, unit.root.name);
      hpBar.setRatio(1);
      agents.push({
        unit,
        hpBar,
        moveTarget: { x: spot.x, z: spot.z + towardEnemy * (2 * SPAWN_Z) },
        focus: null,
        lockedUnit: null,
      });
      wireUnitCombat(unit);
    }
  }

  function spawnFromSpec(spec: SpawnSpec): void {
    clearAgents();
    lastSpec = spec;
    missilesEnabled = spec.missiles;
    fightOver = false;
    elapsed = 0;
    unitSeq = 0;
    spawnArmy(spec.plan.blue, "blue");
    spawnArmy(spec.plan.red, "red");
  }

  function checkOutcome(): void {
    if (fightOver) return;
    const blue = livingCount("blue");
    const red = livingCount("red");
    if (blue > 0 && red > 0) return;
    fightOver = true;
    for (const agent of agents) {
      if (agent.unit.destroyed) continue;
      agent.unit.setCombat(false);
      agent.unit.setMoving(false);
      agent.unit.setAimTarget(null);
    }
    const winner: FightOutcome = blue > 0 ? "blue" : red > 0 ? "red" : "draw";
    callbacks.onOutcome(winner, elapsed);
  }

  scene.onBeforeRenderObservable.add(() => {
    const dt = (engine.getDeltaTime() / 1000) * (paused ? 0 : speed);
    if (dt > 0) elapsed += dt;

    for (const agent of agents) {
      agent.unit.update(dt, elapsed);
      if (!fightOver && dt > 0) updateAgent(agent, dt);
      else if (agent.unit.destroyed) agent.hpBar.setVisible(false);
      else {
        agent.hpBar.setRatio(agent.unit.hp / agent.unit.maxHp);
        agent.hpBar.update(
          agent.unit.root.getAbsolutePosition(),
          UNIT_STATS[agent.unit.kind as CombatUnitKind].hpBarHeight,
          camera.globalPosition,
        );
      }
    }

    if (!paused && !fightOver) {
      resolveUnitSeparation(dt);
      checkOutcome();
    }

    callbacks.onTick?.({
      elapsedSec: elapsed,
      livingBlue: livingCount("blue"),
      livingRed: livingCount("red"),
    });

    for (let i = agents.length - 1; i >= 0; i--) {
      const agent = agents[i]!;
      if (!agent.unit.expired) continue;
      agent.hpBar.dispose();
      agent.unit.dispose();
      agents.splice(i, 1);
    }
  });

  return {
    scene,
    loadPlan: (plan, opts) => {
      spawnFromSpec({ plan, missiles: opts?.missiles ?? false });
    },
    setPaused: (value) => {
      paused = value;
    },
    setSpeed: (mul) => {
      speed = Math.max(0.25, mul);
    },
    restart: () => {
      if (lastSpec) spawnFromSpec(lastSpec);
    },
    dispose: () => {
      clearAgents();
      scene.dispose();
    },
  };
}
