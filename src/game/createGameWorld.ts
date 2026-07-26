import {
  ArcRotateCamera,
  Color3,
  Color4,
  DirectionalLight,
  Engine,
  HemisphericLight,
  Scene,
  Vector3,
} from "@babylonjs/core";
import {
  createBarracks,
  createFactory,
  createHelipad,
  type BuildingHandle,
} from "../buildings";
import type { CombatEntity } from "./combatEntity";
import { createHpBar, type HpBarHandle } from "./hpBar";
import { bypassAroundObstacle, clampToPlayfield, steerToward } from "./pathfinding";
import {
  PLAY_SIZE,
  SLOT_COUNT,
  SPAWN_INTERVAL_SEC,
  BARRACKS_SPAWN_INTERVAL_SEC,
  HELI_GUN_DAMAGE,
  HELI_GUN_RANGE,
  TANK_SPLASH_RADIUS,
  MISSILE_SPLASH_RADIUS,
  UNIT_KINDS,
  UNIT_STATS,
  UNIT_TO_BUILDING,
  type UnitKind,
} from "./stats";
import { spawnExplosion } from "../fx/explosion";
import { spawnBulletTrace } from "../fx/bulletTrace";
import { createTerrain } from "../terrain/createTerrain";
import { TEAM_COLORS, type Team } from "../theme/colors";
import {
  createHelicopter,
  createRifleman,
  createTank,
  type UnitHandle,
} from "../units";
import { shortestAngleDelta } from "../units/types";

/** Hull yaw rate (rad/s) — tanks turn in place before driving. */
const TANK_HULL_TURN_SPEED = 0.45;
/** Must be within this angle of the path before translating. */
const TANK_ALIGN_RAD = 0.2;

export interface GameWorld {
  scene: Scene;
  dispose: () => void;
}

interface Agent {
  unit: UnitHandle;
  hpBar: HpBarHandle;
  /** Optional hold point; null = advance toward the enemy side. */
  moveTarget: { x: number; z: number } | null;
  /** Temporary waypoint to slip around a blocking obstacle. */
  bypass: { x: number; z: number } | null;
  arrived: boolean;
  /** Sticky combat target while still valid / in range. */
  focus: CombatEntity | null;
  /** Locked enemy unit — chased until dead. */
  lockedUnit: UnitHandle | null;
  stuckTimer: number;
  lastX: number;
  lastZ: number;
}

interface Spawner {
  building: BuildingHandle;
  cooldown: number;
  slotIndex: number;
}

function createUnitOfKind(
  scene: Scene,
  name: string,
  team: Team,
  kind: UnitKind,
): UnitHandle {
  if (kind === "rifleman") return createRifleman(scene, name, team);
  if (kind === "tank") return createTank(scene, name, team);
  return createHelicopter(scene, name, team);
}

function createBuildingOfKind(
  scene: Scene,
  name: string,
  team: Team,
  kind: UnitKind,
): BuildingHandle {
  if (kind === "rifleman") return createBarracks(scene, name, team);
  if (kind === "tank") return createFactory(scene, name, team);
  return createHelipad(scene, name, team);
}

function pickRandomKind(): UnitKind {
  return UNIT_KINDS[Math.floor(Math.random() * UNIT_KINDS.length)];
}

function distXZ(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

/**
 * Auto-battler arena: square field, 8 building slots per side, auto-spawns,
 * obstacle pathing, combat with HP bars, corpse sink.
 */
export function createGameWorld(engine: Engine, canvas: HTMLCanvasElement): GameWorld {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.55, 0.72, 0.88, 1);
  scene.ambientColor = new Color3(0.35, 0.4, 0.32);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(0.62, 0.75, 0.88);
  scene.fogStart = 32;
  scene.fogEnd = 62;

  const half = PLAY_SIZE * 0.5;
  const buildingX = half - 2.4;

  const camera = new ArcRotateCamera(
    "gameCamera",
    -Math.PI / 2,
    0.85,
    30,
    new Vector3(0, 0.4, 0),
    scene,
  );
  camera.lowerBetaLimit = 0.4;
  camera.upperBetaLimit = 1.2;
  camera.lowerRadiusLimit = 16;
  camera.upperRadiusLimit = 48;
  camera.wheelPrecision = 35;
  camera.pinchPrecision = 70;
  camera.panningSensibility = 70;
  camera.attachControl(canvas, true);
  camera.useInputToRestoreState = false;

  const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.3), scene);
  hemi.intensity = 0.75;
  hemi.groundColor = new Color3(0.25, 0.28, 0.18);
  hemi.diffuse = new Color3(0.95, 0.95, 0.88);

  const sun = new DirectionalLight("sun", new Vector3(-0.45, -0.85, -0.3), scene);
  sun.position = new Vector3(12, 22, 10);
  sun.intensity = 0.85;
  sun.diffuse = new Color3(1, 0.97, 0.9);

  const terrain = createTerrain(scene, PLAY_SIZE);
  const agents: Agent[] = [];
  const buildings: BuildingHandle[] = [];
  const spawners: Spawner[] = [];
  let unitSeq = 0;

  // 8 slots along each side (blue west / red east)
  const zMin = -half + 2.2;
  const zMax = half - 2.2;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const t = i / Math.max(1, SLOT_COUNT - 1);
    const z = zMin + (zMax - zMin) * t;
    for (const team of ["blue", "red"] as const) {
      const kind = pickRandomKind();
      const x = team === "blue" ? -buildingX : buildingX;
      const rotY = team === "blue" ? Math.PI / 2 : -Math.PI / 2;
      const building = createBuildingOfKind(
        scene,
        `${team}_${UNIT_TO_BUILDING[kind]}_${i}`,
        team,
        kind,
      );
      building.root.position.x = x;
      building.root.position.z = z;
      building.root.position.y = terrain.sampleGroundY(x, z);
      building.root.rotation.y = rotY;
      building.root.scaling.setAll(0.85);
      buildings.push(building);
      spawners.push({
        building,
        // Stagger first wave so the field fills gradually
        cooldown: 0.4 + Math.random() * 2.5 + i * 0.35,
        slotIndex: i,
      });
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
      // Infantry are especially effective vs helicopters
      if (
        unit.kind === "rifleman" &&
        "kind" in target &&
        (target as UnitHandle).kind === "helicopter"
      ) {
        damage *= 2;
      }

      if (isTankShell) {
        spawnExplosion(scene, hit, { scale: 1.15, duration: 0.55 });
        applyArealHit(hit, target, damage, TANK_SPLASH_RADIUS, unit.team, {
          impactFromX: from.x,
          impactFromZ: from.z,
          impactStrength: 8.5,
        });
        return;
      }

      // Rifle / heli chin-gun: tracer then hitscan damage
      if (unit.kind === "rifleman" || isHeliGun) {
        spawnBulletTrace(scene, muzzlePoint(unit), hit, {
          speed: isHeliGun ? 70 : 58,
          length: isHeliGun ? 1.1 : 0.95,
          thickness: isHeliGun ? 0.04 : 0.035,
          color: isHeliGun ? "#ffd060" : "#fff0a8",
        });
      }

      target.takeDamage(damage);
    });

    unit.setOnMissileHit((target, hit) => {
      spawnExplosion(scene, hit, { scale: 1.55, duration: 0.7 });
      applyArealHit(hit, target, unit.damage, MISSILE_SPLASH_RADIUS, unit.team);
    });
  }

  /**
   * Blast: full damage + impact on the main target; 50% damage to other hostiles in radius.
   */
  function applyArealHit(
    center: Vector3,
    mainTarget: CombatEntity,
    baseDamage: number,
    radius: number,
    attackerTeam: Team,
    impact?: { impactFromX: number; impactFromZ: number; impactStrength: number },
  ): void {
    const hitEntity = (entity: CombatEntity, x: number, z: number) => {
      if (entity.destroyed || entity.team === attackerTeam) return;
      const isMain = entity === mainTarget;
      if (!isMain) {
        const d = Math.hypot(center.x - x, center.z - z);
        if (d > radius) return;
      }
      const dmg = isMain ? baseDamage : baseDamage * 0.5;
      entity.takeDamage(dmg);
      if (impact) {
        const strength = isMain ? impact.impactStrength : impact.impactStrength * 0.55;
        entity.applyImpact(impact.impactFromX, impact.impactFromZ, strength);
      }
    };

    for (const other of agents) {
      const p = other.unit.root.position;
      hitEntity(other.unit, p.x, p.z);
    }
    for (const b of buildings) {
      const p = b.root.position;
      hitEntity(b, p.x, p.z);
    }
  }

  function findFocus(unit: UnitHandle): CombatEntity | null {
    const agent = agents.find((a) => a.unit === unit);
    return agent?.focus ?? null;
  }

  /** Approximate world-space muzzle for tracer origin. */
  function muzzlePoint(unit: UnitHandle): Vector3 {
    const yaw = unit.root.rotation.y;
    const sx = Math.sin(yaw);
    const cz = Math.cos(yaw);
    if (unit.kind === "helicopter") {
      const body = unit.getHitPoint();
      return new Vector3(
        body.x + sx * 0.45,
        body.y - 0.32,
        body.z + cz * 0.45,
      );
    }
    // Rifleman chest / rifle tip
    return new Vector3(
      unit.root.position.x + sx * 0.55,
      unit.root.position.y + 1.05,
      unit.root.position.z + cz * 0.55,
    );
  }

  function spawnFrom(spawner: Spawner): void {
    const b = spawner.building;
    if (b.destroyed) return;

    const kind = b.spawns;
    const towardEnemy = b.team === "blue" ? 1 : -1;
    const spawnX = b.root.position.x + towardEnemy * 2.1;
    const spawnZ = b.root.position.z + (Math.random() - 0.5) * 0.6;
    const unit = createUnitOfKind(
      scene,
      `${b.team}_${kind}_${unitSeq++}`,
      b.team,
      kind,
    );
    unit.root.position.x = spawnX;
    unit.root.position.z = spawnZ;
    unit.root.position.y = 0;
    unit.root.rotation.y = towardEnemy > 0 ? Math.PI / 2 : -Math.PI / 2;
    unit.root.scaling.setAll(0.8);
    unit.fireRateHz = UNIT_STATS[kind].fireRateHz;

    const hpBar = createHpBar(scene, unit.root.name, TEAM_COLORS[b.team].secondary);
    hpBar.setRatio(1);

    // Default: march toward the far side; optional stop short of the building line
    const advanceX = towardEnemy * (buildingX - 3.5);
    const agent: Agent = {
      unit,
      hpBar,
      moveTarget: { x: advanceX, z: spawnZ + (Math.random() - 0.5) * 1.5 },
      bypass: null,
      arrived: false,
      focus: null,
      lockedUnit: null,
      stuckTimer: 0,
      lastX: spawnX,
      lastZ: spawnZ,
    };
    agents.push(agent);
    wireUnitCombat(unit);
  }

  function canTargetUnit(attacker: UnitHandle, other: UnitHandle): boolean {
    if (other.destroyed || other.team === attacker.team) return false;
    // Tanks can't engage helicopters
    if (attacker.kind === "tank" && other.kind === "helicopter") return false;
    return true;
  }

  /** Weapon reach for this attacker vs a specific target (heli gun is shorter). */
  function engageRange(attacker: UnitHandle, target: CombatEntity): number {
    if (attacker.kind === "helicopter") {
      const isTank =
        "kind" in target && (target as UnitHandle).kind === "tank";
      return isTank ? attacker.shootRange : HELI_GUN_RANGE;
    }
    return attacker.shootRange;
  }

  /** Nearest valid enemy unit within acquire range (used to start a lock). */
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

  function findBuildingInRange(unit: UnitHandle): BuildingHandle | null {
    const pos = unit.root.position;
    let best: BuildingHandle | null = null;
    let bestDist = Infinity;
    for (const b of buildings) {
      if (b.destroyed || b.team === unit.team) continue;
      const range = engageRange(unit, b);
      const d = distXZ(pos, b.root.position);
      if (d <= range && d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    return best;
  }

  function moveToward(
    agent: Agent,
    goal: { x: number; z: number },
    dt: number,
  ): void {
    const { unit } = agent;
    const agentRadius =
      unit.kind === "tank" ? 0.7 : unit.kind === "helicopter" ? 0 : UNIT_STATS.rifleman.radius;
    // Tanks ram trees instead of pathing around them; infantry still avoid trunks
    const obstacles =
      unit.kind === "helicopter"
        ? []
        : unit.kind === "tank"
          ? terrain.rockObstacles
          : terrain.obstacles;
    const from = { x: unit.root.position.x, z: unit.root.position.z };
    const steerGoal = agent.bypass ?? goal;

    const moved = Math.hypot(from.x - agent.lastX, from.z - agent.lastZ);
    if (moved < unit.moveSpeed * dt * 0.25) agent.stuckTimer += dt;
    else agent.stuckTimer = Math.max(0, agent.stuckTimer - dt * 0.5);
    agent.lastX = from.x;
    agent.lastZ = from.z;

    if (agent.stuckTimer > 0.55 && !agent.bypass && obstacles.length > 0) {
      const bypass = bypassAroundObstacle(from, goal, obstacles, agentRadius);
      if (bypass) {
        agent.bypass = clampToPlayfield(bypass.x, bypass.z, half, 1.4);
        agent.stuckTimer = 0;
      }
    }

    const dir = steerToward(from, steerGoal, obstacles, {
      arriveDist: agent.bypass ? 0.55 : 0.45,
      agentRadius,
    });

    if (!dir) {
      if (agent.bypass) {
        agent.bypass = null;
        agent.stuckTimer = 0;
        return;
      }
      unit.setMoving(false);
      return;
    }

    const yaw = Math.atan2(dir.x, dir.z);

    // Tanks: turn hull to face the path first, then drive forward
    if (unit.kind === "tank") {
      const dy = shortestAngleDelta(unit.root.rotation.y, yaw);
      unit.root.rotation.y +=
        Math.sign(dy) * Math.min(Math.abs(dy), TANK_HULL_TURN_SPEED * dt);

      if (Math.abs(dy) > TANK_ALIGN_RAD) {
        unit.setMoving(false);
        agent.stuckTimer = 0;
        agent.lastX = unit.root.position.x;
        agent.lastZ = unit.root.position.z;
        return;
      }

      unit.setMoving(true);
      const step = unit.moveSpeed * dt;
      const fx = Math.sin(unit.root.rotation.y);
      const fz = Math.cos(unit.root.rotation.y);
      const next = clampToPlayfield(
        unit.root.position.x + fx * step,
        unit.root.position.z + fz * step,
        half,
        1.4,
      );
      unit.root.position.x = next.x;
      unit.root.position.z = next.z;
      terrain.ramTreesAt(next.x, next.z, 0.85);
      return;
    }

    unit.setMoving(true);
    const step = unit.moveSpeed * dt;
    const next = clampToPlayfield(
      unit.root.position.x + dir.x * step,
      unit.root.position.z + dir.z * step,
      half,
      1.4,
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
      UNIT_STATS[unit.kind as UnitKind].hpBarHeight,
      camera.globalPosition,
    );

    // Drop lock when the chase target dies
    if (agent.lockedUnit?.destroyed) {
      agent.lockedUnit = null;
    }

    // Acquire a unit lock if we don't have one
    if (!agent.lockedUnit) {
      agent.lockedUnit = findUnitToLock(unit);
      if (agent.lockedUnit) {
        agent.bypass = null;
        agent.stuckTimer = 0;
      }
    }

    // Locked unit: chase until dead; shoot when in range
    if (agent.lockedUnit) {
      const locked = agent.lockedUnit;
      agent.focus = locked;
      agent.arrived = true;
      const d = distXZ(unit.root.position, locked.root.position);

      if (d <= engageRange(unit, locked)) {
        unit.setCombat(true);
        unit.setAimTarget(locked);
        unit.setMoving(false);
        agent.bypass = null;
        faceTarget(unit, locked, dt);
      } else {
        // Out of range — keep the lock and chase
        unit.setCombat(false);
        unit.setAimTarget(null);
        moveToward(
          agent,
          { x: locked.root.position.x, z: locked.root.position.z },
          dt,
        );
      }
      return;
    }

    // No unit lock: opportunistically shoot buildings in range
    const building = findBuildingInRange(unit);
    if (building) {
      agent.focus = building;
      unit.setCombat(true);
      unit.setAimTarget(building);
      unit.setMoving(false);
      agent.arrived = true;
      agent.bypass = null;
      faceTarget(unit, building, dt);
      return;
    }

    agent.focus = null;
    unit.setCombat(false);
    unit.setAimTarget(null);

    // Keep pressing the enemy side
    if (agent.arrived) {
      const toward = unit.team === "blue" ? 1 : -1;
      agent.moveTarget = {
        x: toward * (buildingX - 2.2),
        z: unit.root.position.z + (Math.random() - 0.5) * 0.8,
      };
      agent.bypass = null;
      agent.arrived = false;
      agent.stuckTimer = 0;
    }

    if (!agent.moveTarget) {
      unit.setMoving(false);
      return;
    }

    moveToward(agent, agent.moveTarget, dt);

    if (
      !agent.bypass &&
      Math.hypot(
        unit.root.position.x - agent.moveTarget.x,
        unit.root.position.z - agent.moveTarget.z,
      ) < 0.5
    ) {
      agent.arrived = true;
      unit.setMoving(false);
    }
  }

  let elapsed = 0;
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    elapsed += dt;
    terrain.update(dt, elapsed);

    for (const building of buildings) building.update(dt, elapsed);

    for (const spawner of spawners) {
      if (spawner.building.destroyed) continue;
      spawner.cooldown -= dt;
      if (spawner.cooldown <= 0) {
        spawnFrom(spawner);
        spawner.cooldown =
          spawner.building.kind === "barracks"
            ? BARRACKS_SPAWN_INTERVAL_SEC
            : SPAWN_INTERVAL_SEC;
      }
    }

    for (const agent of agents) updateAgent(agent, dt);

    for (const agent of agents) agent.unit.update(dt, elapsed);

    // Cull expired corpses and sunk buildings
    for (let i = agents.length - 1; i >= 0; i--) {
      if (agents[i].unit.expired) {
        agents[i].hpBar.dispose();
        agents[i].unit.dispose();
        agents.splice(i, 1);
      }
    }
    for (let i = buildings.length - 1; i >= 0; i--) {
      if (!buildings[i].expired) continue;
      const b = buildings[i];
      for (let s = spawners.length - 1; s >= 0; s--) {
        if (spawners[s].building === b) spawners.splice(s, 1);
      }
      b.dispose();
      buildings.splice(i, 1);
    }
  });

  return {
    scene,
    dispose: () => {
      for (const agent of agents) {
        agent.hpBar.dispose();
        agent.unit.dispose();
      }
      for (const building of buildings) building.dispose();
      terrain.dispose();
      scene.dispose();
    },
  };
}
