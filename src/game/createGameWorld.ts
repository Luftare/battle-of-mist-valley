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
  type Mesh,
} from "@babylonjs/core";
import {
  createBarracks,
  createDepot,
  createFactory,
  createHelipad,
  createPlatform,
  createTurret,
  type BuildingHandle,
  type BuildingKind,
  type PlatformHandle,
  type TurretHandle,
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
  UNIT_STATS,
  BUILDING_COST,
  COINS_PER_SEC,
  STARTING_COINS,
  SUPPLY_TRUCK_COIN_INTERVAL_SEC,
  SUPPLY_TRUCK_COIN_AMOUNT,
  AI_DECISION_INTERVAL_SEC,
  TURRET_BOUNTY,
  TURRET_HP_BAR_HEIGHT,
  type UnitKind,
} from "./stats";
import { spawnExplosion } from "../fx/explosion";
import { spawnBulletTrace } from "../fx/bulletTrace";
import { createCoinPopupFx } from "../fx/coinPopup";
import { createTerrain } from "../terrain/createTerrain";
import { TEAM_COLORS, type Team } from "../theme/colors";
import {
  createHelicopter,
  createRifleman,
  createSupplyTruck,
  createTank,
  type UnitHandle,
} from "../units";
import { shortestAngleDelta } from "../units/types";
import { createHud } from "../ui/hud";

/** Hull yaw rate (rad/s) — tanks turn in place before driving. */
const TANK_HULL_TURN_SPEED = 0.45;
/** Must be within this angle of the path before translating. */
const TANK_ALIGN_RAD = 0.2;

const PLAYER_TEAM: Team = "blue";
const AI_TEAM: Team = "red";
const CLICK_DRAG_PX = 12;

export interface GameWorld {
  scene: Scene;
  dispose: () => void;
}

interface Agent {
  unit: UnitHandle;
  hpBar: HpBarHandle;
  moveTarget: { x: number; z: number } | null;
  bypass: { x: number; z: number } | null;
  arrived: boolean;
  focus: CombatEntity | null;
  lockedUnit: UnitHandle | null;
  stuckTimer: number;
  lastX: number;
  lastZ: number;
  /** Supply truck coin mint timer. */
  coinCooldown: number;
}

interface Slot {
  team: Team;
  index: number;
  x: number;
  z: number;
  rotY: number;
  surfaceY: number;
  platform: PlatformHandle;
  pickProxy: Mesh;
  building: BuildingHandle | null;
  spawnCooldown: number;
}

function createUnitOfKind(
  scene: Scene,
  name: string,
  team: Team,
  kind: UnitKind,
): UnitHandle {
  if (kind === "rifleman") return createRifleman(scene, name, team);
  if (kind === "tank") return createTank(scene, name, team);
  if (kind === "supplyTruck") return createSupplyTruck(scene, name, team);
  return createHelicopter(scene, name, team);
}

function createBuildingOfKind(
  scene: Scene,
  name: string,
  team: Team,
  kind: BuildingKind,
): BuildingHandle {
  if (kind === "barracks") return createBarracks(scene, name, team);
  if (kind === "factory") return createFactory(scene, name, team);
  if (kind === "depot") return createDepot(scene, name, team);
  return createHelipad(scene, name, team);
}

function distXZ(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

function spawnIntervalFor(kind: BuildingKind): number {
  return kind === "barracks" ? BARRACKS_SPAWN_INTERVAL_SEC : SPAWN_INTERVAL_SEC;
}

/**
 * Auto-battler arena: empty platforms, build/collapse economy, supply trucks, AI.
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
  /** Base line along Z: blue south (−Z), red north (+Z). */
  const buildingZ = half - 2.4;

  const camera = new ArcRotateCamera(
    "gameCamera",
    Math.PI,
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
  const slots: Slot[] = [];
  const turrets: TurretHandle[] = [];
  const turretHpBars: HpBarHandle[] = [];
  const hud = createHud();
  const coinFx = createCoinPopupFx();
  let unitSeq = 0;

  const coins: Record<Team, number> = {
    blue: STARTING_COINS,
    red: STARTING_COINS,
  };
  hud.setCoins(coins[PLAYER_TEAM]);

  let anyUnitDestroyed = false;
  let gameOver = false;
  let aiCooldown = AI_DECISION_INTERVAL_SEC * 0.4;
  let selectedSlot: Slot | null = null;

  // 8 slots along each end (blue south / red north)
  const xMin = -half + 2.2;
  const xMax = half - 2.2;
  for (let i = 0; i < SLOT_COUNT; i++) {
    const t = i / Math.max(1, SLOT_COUNT - 1);
    const x = xMin + (xMax - xMin) * t;
    for (const team of ["blue", "red"] as const) {
      const z = team === "blue" ? -buildingZ : buildingZ;
      const rotY = team === "blue" ? 0 : Math.PI;
      const surfaceY = terrain.getGroundYAt(x, z);
      const platform = createPlatform(scene, `${team}_pad_${i}`, team, i);
      platform.root.position.x = x;
      platform.root.position.z = z;
      platform.root.position.y = surfaceY;

      const pickProxy = MeshBuilder.CreateBox(
        `${team}_pick_${i}`,
        { width: 2.8, height: 1.6, depth: 2.6 },
        scene,
      );
      pickProxy.parent = platform.root;
      pickProxy.position.set(0, 0.7, 0);
      pickProxy.visibility = 0;
      pickProxy.isPickable = true;

      slots.push({
        team,
        index: i,
        x,
        z,
        rotY,
        surfaceY,
        platform,
        pickProxy,
        building: null,
        spawnCooldown: 0,
      });
    }
  }

  // Two defensive turrets per team, ahead of the building line
  const turretX = half * 0.42;
  const turretZ = half * 0.38;
  for (const team of ["blue", "red"] as const) {
    const zSign = team === "blue" ? -1 : 1;
    for (const xSign of [-1, 1] as const) {
      const tx = xSign * turretX;
      const tz = zSign * turretZ;
      const turret = createTurret(scene, `${team}_turret_${xSign > 0 ? "E" : "W"}`, team);
      turret.root.position.x = tx;
      turret.root.position.z = tz;
      // Pad diameter 2.1 × 0.9 scale — sample max height so pads stay on slopes
      turret.root.position.y = terrain.getGroundYAtFootprint(tx, tz, 2.1 * 0.5 * 0.9);
      turret.root.scaling.setAll(0.9);
      turrets.push(turret);

      const hpBar = createHpBar(scene, turret.root.name, TEAM_COLORS[team].secondary);
      hpBar.setRatio(1);
      turretHpBars.push(hpBar);
    }
  }

  const pickToSlot = new Map<number, Slot>();
  function refreshPickMap(): void {
    pickToSlot.clear();
    for (const slot of slots) {
      pickToSlot.set(slot.pickProxy.uniqueId, slot);
      pickToSlot.set(slot.platform.pickMesh.uniqueId, slot);
    }
  }
  refreshPickMap();

  function livingBuildings(team: Team): BuildingHandle[] {
    return slots
      .filter((s) => s.team === team && s.building && !s.building.destroyed)
      .map((s) => s.building!);
  }

  function livingTurrets(team: Team): TurretHandle[] {
    return turrets.filter((t) => t.team === team && !t.destroyed);
  }

  function livingUnits(team: Team): UnitHandle[] {
    return agents.filter((a) => a.unit.team === team && !a.unit.destroyed).map((a) => a.unit);
  }

  function countUnitsByKind(team: Team): Record<UnitKind, number> {
    const counts: Record<UnitKind, number> = {
      rifleman: 0,
      tank: 0,
      helicopter: 0,
      supplyTruck: 0,
    };
    for (const u of livingUnits(team)) {
      counts[u.kind as UnitKind] = (counts[u.kind as UnitKind] ?? 0) + 1;
    }
    return counts;
  }

  function countBuildingsByKind(team: Team): Record<BuildingKind, number> {
    const counts: Record<BuildingKind, number> = {
      barracks: 0,
      depot: 0,
      factory: 0,
      helipad: 0,
    };
    for (const b of livingBuildings(team)) {
      counts[b.kind] += 1;
    }
    return counts;
  }

  function addCoins(
    team: Team,
    amount: number,
    opts?: { world?: Vector3; popup?: boolean },
  ): void {
    coins[team] += amount;
    if (team === PLAYER_TEAM) hud.setCoins(coins[PLAYER_TEAM]);
    if (opts?.popup && opts.world) coinFx.spawn(opts.world, amount);
  }

  function trySpend(team: Team, cost: number): boolean {
    if (coins[team] < cost) return false;
    coins[team] -= cost;
    if (team === PLAYER_TEAM) hud.setCoins(coins[PLAYER_TEAM]);
    return true;
  }

  function markAttacker(entity: CombatEntity, attackerTeam: Team): void {
    if ("lastAttackerTeam" in entity) {
      (entity as TurretHandle).lastAttackerTeam = attackerTeam;
    }
  }

  const awardedTurrets = new WeakSet<TurretHandle>();

  function awardTurretBounty(turret: TurretHandle): void {
    if (awardedTurrets.has(turret)) return;
    const killer = turret.lastAttackerTeam;
    if (!killer || killer === turret.team) return;
    awardedTurrets.add(turret);
    addCoins(killer, TURRET_BOUNTY, {
      world: turret.root.position.clone(),
      popup: true,
    });
  }

  function placeBuilding(
    slot: Slot,
    kind: BuildingKind,
    opts?: { free?: boolean },
  ): boolean {
    if (slot.building && !slot.building.expired) return false;
    if (!opts?.free) {
      const cost = BUILDING_COST[kind];
      if (!trySpend(slot.team, cost)) return false;
    }

    const building = createBuildingOfKind(
      scene,
      `${slot.team}_${kind}_${slot.index}`,
      slot.team,
      kind,
    );
    building.root.position.x = slot.x;
    building.root.position.z = slot.z;
    building.root.position.y = slot.surfaceY;
    building.root.rotation.y = slot.rotY;
    building.root.scaling.setAll(0.85);
    slot.building = building;
    slot.spawnCooldown = 2.5 + Math.random() * 1.5;
    return true;
  }

  // Both sides start with a free barracks on a central platform
  const starterSlot = Math.floor((SLOT_COUNT - 1) / 2);
  for (const team of ["blue", "red"] as const) {
    const slot = slots.find((s) => s.team === team && s.index === starterSlot);
    if (slot) placeBuilding(slot, "barracks", { free: true });
  }

  function collapseBuilding(slot: Slot): boolean {
    const b = slot.building;
    if (!b || b.destroyed || b.collapsing) return false;
    if (livingBuildings(slot.team).length <= 1) return false;
    b.beginCollapse();
    return true;
  }

  function clearExpiredBuilding(slot: Slot): void {
    if (!slot.building?.expired) return;
    slot.building.dispose();
    slot.building = null;
    slot.spawnCooldown = 0;
  }

  function wireUnitCombat(unit: UnitHandle): void {
    if (unit.kind === "supplyTruck") return;

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

      if (isTankShell) {
        spawnExplosion(scene, hit, { scale: 1.15, duration: 0.55 });
        applyArealHit(hit, target, damage, TANK_SPLASH_RADIUS, unit.team, {
          impactFromX: from.x,
          impactFromZ: from.z,
          impactStrength: 8.5,
        });
        return;
      }

      if (unit.kind === "rifleman" || isHeliGun) {
        spawnBulletTrace(scene, muzzlePoint(unit), hit, {
          speed: isHeliGun ? 70 : 58,
          length: isHeliGun ? 1.1 : 0.95,
          thickness: isHeliGun ? 0.04 : 0.035,
          color: isHeliGun ? "#ffd060" : "#fff0a8",
        });
      }

      markAttacker(target, unit.team);
      const wasAlive = !target.destroyed;
      target.takeDamage(damage);
      if (wasAlive && target.destroyed && isTurret(target)) {
        awardTurretBounty(target);
      }
    });

    unit.setOnMissileHit((target, hit) => {
      spawnExplosion(scene, hit, { scale: 1.55, duration: 0.7 });
      applyArealHit(hit, target, unit.damage, MISSILE_SPLASH_RADIUS, unit.team);
    });
  }

  function isTurret(entity: CombatEntity): entity is TurretHandle {
    return "kind" in entity && (entity as TurretHandle).kind === "turret";
  }

  function wireTurretCombat(turret: TurretHandle): void {
    turret.setOnFire(() => {
      const target = findTurretFocus(turret);
      if (!target || target.destroyed) return;
      const hit = target.getHitPoint();
      spawnBulletTrace(scene, turret.getMuzzlePoint().clone(), hit, {
        speed: 62,
        length: 1.0,
        thickness: 0.04,
        color: "#ffe08a",
      });
      // Equal damage vs all targets — no type multipliers
      target.takeDamage(turret.damage);
    });
  }

  function findTurretFocus(turret: TurretHandle): CombatEntity | null {
    // Prefer sticky aim while still in range
    // (stored on a weak map via agent-like state on the handle itself)
    return turretAim.get(turret) ?? null;
  }

  const turretAim = new Map<TurretHandle, CombatEntity | null>();

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
      markAttacker(entity, attackerTeam);
      const wasAlive = !entity.destroyed;
      entity.takeDamage(dmg);
      if (wasAlive && entity.destroyed && isTurret(entity)) {
        awardTurretBounty(entity);
      }
      if (impact) {
        const strength = isMain ? impact.impactStrength : impact.impactStrength * 0.55;
        entity.applyImpact(impact.impactFromX, impact.impactFromZ, strength);
      }
    };

    for (const other of agents) {
      const p = other.unit.root.position;
      hitEntity(other.unit, p.x, p.z);
    }
    for (const slot of slots) {
      const b = slot.building;
      if (!b) continue;
      hitEntity(b, b.root.position.x, b.root.position.z);
    }
    for (const turret of turrets) {
      hitEntity(turret, turret.root.position.x, turret.root.position.z);
    }
  }

  function findFocus(unit: UnitHandle): CombatEntity | null {
    const agent = agents.find((a) => a.unit === unit);
    return agent?.focus ?? null;
  }

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
    return new Vector3(
      unit.root.position.x + sx * 0.55,
      unit.root.position.y + 1.05,
      unit.root.position.z + cz * 0.55,
    );
  }

  function spawnFrom(slot: Slot): void {
    const b = slot.building;
    if (!b || b.destroyed) return;

    const kind = b.spawns;
    const towardEnemy = b.team === "blue" ? 1 : -1;
    const spawnX = b.root.position.x + (Math.random() - 0.5) * 0.6;
    const spawnZ = b.root.position.z + towardEnemy * 2.1;
    const unit = createUnitOfKind(
      scene,
      `${b.team}_${kind}_${unitSeq++}`,
      b.team,
      kind,
    );
    unit.root.position.x = spawnX;
    unit.root.position.z = spawnZ;
    unit.root.position.y = 0;
    unit.root.rotation.y = towardEnemy > 0 ? 0 : Math.PI;
    unit.root.scaling.setAll(0.8);
    unit.fireRateHz = UNIT_STATS[kind].fireRateHz;

    const hpBar = createHpBar(scene, unit.root.name, TEAM_COLORS[b.team].secondary);
    hpBar.setRatio(1);

    const advanceZ = towardEnemy * (buildingZ - 3.5);
    const agent: Agent = {
      unit,
      hpBar,
      moveTarget: { x: spawnX + (Math.random() - 0.5) * 1.5, z: advanceZ },
      bypass: null,
      arrived: false,
      focus: null,
      lockedUnit: null,
      stuckTimer: 0,
      lastX: spawnX,
      lastZ: spawnZ,
      coinCooldown: SUPPLY_TRUCK_COIN_INTERVAL_SEC * (0.4 + Math.random() * 0.6),
    };
    agents.push(agent);
    wireUnitCombat(unit);
  }

  function canTargetUnit(attacker: UnitHandle, other: UnitHandle): boolean {
    if (other.destroyed || other.team === attacker.team) return false;
    if (attacker.kind === "supplyTruck") return false;
    if (attacker.kind === "tank" && other.kind === "helicopter") return false;
    return true;
  }

  function engageRange(attacker: UnitHandle, target: CombatEntity): number {
    if (attacker.kind === "helicopter") {
      const isTank =
        "kind" in target && (target as UnitHandle).kind === "tank";
      return isTank ? attacker.shootRange : HELI_GUN_RANGE;
    }
    return attacker.shootRange;
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

  function findBuildingInRange(unit: UnitHandle): CombatEntity | null {
    const pos = unit.root.position;
    let best: CombatEntity | null = null;
    let bestDist = Infinity;
    for (const slot of slots) {
      const b = slot.building;
      if (!b || b.destroyed || b.team === unit.team) continue;
      const range = engageRange(unit, b);
      const d = distXZ(pos, b.root.position);
      if (d <= range && d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    for (const turret of turrets) {
      if (turret.destroyed || turret.team === unit.team) continue;
      const range = engageRange(unit, turret);
      const d = distXZ(pos, turret.root.position);
      if (d <= range && d < bestDist) {
        bestDist = d;
        best = turret;
      }
    }
    return best;
  }

  /** Nearest hostile for a turret — units and buildings treated equally. */
  function acquireTurretTarget(turret: TurretHandle): CombatEntity | null {
    const pos = turret.root.position;
    const range = turret.shootRange;
    let best: CombatEntity | null = null;
    let bestDist = Infinity;

    const consider = (entity: CombatEntity, x: number, z: number) => {
      if (entity.destroyed || entity.team === turret.team) return;
      const d = Math.hypot(pos.x - x, pos.z - z);
      if (d <= range && d < bestDist) {
        bestDist = d;
        best = entity;
      }
    };

    for (const agent of agents) {
      const p = agent.unit.root.position;
      consider(agent.unit, p.x, p.z);
    }
    for (const slot of slots) {
      const b = slot.building;
      if (!b) continue;
      consider(b, b.root.position.x, b.root.position.z);
    }
    // Do not shoot other turrets — keeps lanes about units/buildings
    return best;
  }

  function moveToward(
    agent: Agent,
    goal: { x: number; z: number },
    dt: number,
  ): void {
    const { unit } = agent;
    const agentRadius =
      unit.kind === "tank"
        ? 0.7
        : unit.kind === "helicopter"
          ? 0
          : UNIT_STATS[unit.kind as UnitKind]?.radius ?? 0.4;
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

    // Supply trucks: advance + mint coins, never fight
    if (unit.kind === "supplyTruck") {
      agent.coinCooldown -= dt;
      if (agent.coinCooldown <= 0) {
        agent.coinCooldown = SUPPLY_TRUCK_COIN_INTERVAL_SEC;
        addCoins(unit.team, SUPPLY_TRUCK_COIN_AMOUNT, {
          world: unit.root.position.clone(),
          popup: true,
        });
      }

      if (agent.arrived) {
        const toward = unit.team === "blue" ? 1 : -1;
        agent.moveTarget = {
          x: unit.root.position.x + (Math.random() - 0.5) * 0.8,
          z: toward * (buildingZ - 2.2),
        };
        agent.bypass = null;
        agent.arrived = false;
        agent.stuckTimer = 0;
      }
      if (agent.moveTarget) {
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
      return;
    }

    if (agent.lockedUnit?.destroyed) {
      agent.lockedUnit = null;
    }

    if (!agent.lockedUnit) {
      agent.lockedUnit = findUnitToLock(unit);
      if (agent.lockedUnit) {
        agent.bypass = null;
        agent.stuckTimer = 0;
      }
    }

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

    if (agent.arrived) {
      const toward = unit.team === "blue" ? 1 : -1;
      agent.moveTarget = {
        x: unit.root.position.x + (Math.random() - 0.5) * 0.8,
        z: toward * (buildingZ - 2.2),
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

  /** Pick a counter building vs the player's current army / economy. */
  function aiPickBuildKind(): BuildingKind {
    const enemy = countUnitsByKind(PLAYER_TEAM);
    const enemyBuildings = countBuildingsByKind(PLAYER_TEAM);
    const own = countBuildingsByKind(AI_TEAM);

    const combatPressure =
      enemy.rifleman * 1 + enemy.tank * 2.2 + enemy.helicopter * 1.6;
    const economyPressure =
      enemy.supplyTruck * 1.5 + enemyBuildings.depot * 2;

    // Bootstrap: get something on the field
    if (own.barracks + own.factory + own.helipad + own.depot === 0) {
      return "barracks";
    }

    // Economy answer if player is farming hard and we have few depots
    if (economyPressure > 3 && own.depot < 2 && coins[AI_TEAM] >= BUILDING_COST.depot) {
      return "depot";
    }

    // Soft open: second building often a depot for late pressure
    const combatBuildings = own.barracks + own.factory + own.helipad;
    if (combatBuildings >= 1 && own.depot === 0 && coins[AI_TEAM] >= BUILDING_COST.depot) {
      if (Math.random() < 0.45) return "depot";
    }

    // Counter the dominant combat unit the player fields (or is building)
    const scores: Record<"rifleman" | "tank" | "helicopter", number> = {
      rifleman: enemy.rifleman + enemyBuildings.barracks * 1.5,
      tank: enemy.tank + enemyBuildings.factory * 1.5,
      helicopter: enemy.helicopter + enemyBuildings.helipad * 1.5,
    };
    let dominant: "rifleman" | "tank" | "helicopter" = "rifleman";
    let best = -1;
    for (const k of ["rifleman", "tank", "helicopter"] as const) {
      if (scores[k] > best) {
        best = scores[k];
        dominant = k;
      }
    }

    let counter: BuildingKind =
      dominant === "helicopter"
        ? "barracks"
        : dominant === "tank"
          ? "helipad"
          : "factory";

    // If no real pressure yet, diversify toward barracks / factory
    if (combatPressure < 1 && best < 1) {
      counter = own.barracks <= own.factory ? "barracks" : "factory";
    }

    // Avoid stacking too many of the same if we can afford a different answer
    if (own[counter] >= 3) {
      const alts: BuildingKind[] = ["barracks", "factory", "helipad", "depot"];
      const cheaper = alts
        .filter((k) => k !== counter && coins[AI_TEAM] >= BUILDING_COST[k])
        .sort((a, b) => BUILDING_COST[a] - BUILDING_COST[b]);
      if (cheaper.length) counter = cheaper[0];
    }

    return counter;
  }

  function runAiDecision(): void {
    if (gameOver) return;

    const empty = slots.filter((s) => s.team === AI_TEAM && !s.building);
    const kind = aiPickBuildKind();
    const cost = BUILDING_COST[kind];

    // Prefer building on empty sites
    if (empty.length > 0 && coins[AI_TEAM] >= cost) {
      const slot = empty[Math.floor(Math.random() * empty.length)];
      placeBuilding(slot, kind);
      return;
    }

    // Rebuild: collapse a poorly matching building if we can afford the counter
    const living = slots.filter(
      (s) => s.team === AI_TEAM && s.building && !s.building.destroyed,
    );
    if (living.length <= 1) return;
    if (coins[AI_TEAM] < cost + 20) return;

    const own = countBuildingsByKind(AI_TEAM);
    // Collapse excess of non-counter types
    const unwanted = living.filter((s) => s.building!.kind !== kind);
    if (unwanted.length === 0) return;
    // Prefer collapsing depots if we already have 2+, else random mismatch
    unwanted.sort((a, b) => {
      const score = (s: Slot) =>
        s.building!.kind === "depot" && own.depot > 1
          ? 0
          : s.building!.kind === kind
            ? 2
            : 1;
      return score(a) - score(b);
    });
    collapseBuilding(unwanted[0]);
  }

  function checkEndConditions(): void {
    if (gameOver || !anyUnitDestroyed) return;

    const enemyDead =
      livingUnits(AI_TEAM).length === 0 &&
      livingBuildings(AI_TEAM).length === 0 &&
      livingTurrets(AI_TEAM).length === 0;
    const playerDead =
      livingUnits(PLAYER_TEAM).length === 0 &&
      livingBuildings(PLAYER_TEAM).length === 0 &&
      livingTurrets(PLAYER_TEAM).length === 0;

    if (enemyDead) {
      gameOver = true;
      hud.showEndScreen("victory");
    } else if (playerDead) {
      gameOver = true;
      hud.showEndScreen("defeat");
    }
  }

  function openSlotModal(slot: Slot): void {
    if (gameOver || slot.team !== PLAYER_TEAM) return;
    selectedSlot?.platform.setHighlight(false);
    selectedSlot = slot;
    slot.platform.setHighlight(true);

    const occupied =
      slot.building && !slot.building.destroyed ? slot.building.kind : null;

    hud.openBuildModal({
      coins: coins[PLAYER_TEAM],
      occupied,
      canCollapse: occupied !== null && livingBuildings(PLAYER_TEAM).length > 1,
      onBuild: (kind) => {
        placeBuilding(slot, kind);
        slot.platform.setHighlight(false);
        selectedSlot = null;
      },
      onCollapse: () => {
        collapseBuilding(slot);
        slot.platform.setHighlight(false);
        selectedSlot = null;
      },
      onClose: () => {
        slot.platform.setHighlight(false);
        selectedSlot = null;
      },
    });
  }

  // Click vs drag on platforms
  let pointerDown: { x: number; y: number } | null = null;
  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    pointerDown = { x: e.clientX, y: e.clientY };
  };
  const onPointerUp = (e: PointerEvent) => {
    if (!pointerDown || e.button !== 0) {
      pointerDown = null;
      return;
    }
    const dx = e.clientX - pointerDown.x;
    const dy = e.clientY - pointerDown.y;
    pointerDown = null;
    if (dx * dx + dy * dy > CLICK_DRAG_PX * CLICK_DRAG_PX) return;
    if (gameOver) return;

    const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) =>
      pickToSlot.has(mesh.uniqueId),
    );
    if (!pick?.hit || !pick.pickedMesh) return;
    const slot = pickToSlot.get(pick.pickedMesh.uniqueId);
    if (slot) openSlotModal(slot);
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);

  for (const turret of turrets) wireTurretCombat(turret);

  // Wrap takeDamage to detect unit kills for the win gate
  const trackedDestroyed = new WeakSet<UnitHandle>();
  function noteUnitDeath(unit: UnitHandle): void {
    if (trackedDestroyed.has(unit)) return;
    trackedDestroyed.add(unit);
    anyUnitDestroyed = true;
  }

  function updateTurret(turret: TurretHandle, hpBar: HpBarHandle): void {
    if (turret.destroyed) {
      turret.setAimTarget(null);
      turretAim.set(turret, null);
      hpBar.setVisible(false);
      // Bounty may already have been awarded on the killing blow
      if (turret.lastAttackerTeam) awardTurretBounty(turret);
      return;
    }

    hpBar.setRatio(turret.hp / turret.maxHp);
    hpBar.update(
      turret.root.getAbsolutePosition(),
      TURRET_HP_BAR_HEIGHT,
      camera.globalPosition,
    );

    let focus = turretAim.get(turret) ?? null;
    if (focus?.destroyed) focus = null;
    if (focus) {
      const d = distXZ(turret.root.position, focus.root.position);
      if (d > turret.shootRange) focus = null;
    }
    if (!focus) focus = acquireTurretTarget(turret);
    turretAim.set(turret, focus);
    turret.setAimTarget(focus);
  }

  let elapsed = 0;
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    elapsed += dt;
    terrain.update(dt, elapsed);
    hud.update(dt);

    if (!gameOver) {
      // Passive income — HUD tweens; no floating +N
      addCoins(PLAYER_TEAM, COINS_PER_SEC * dt);
      addCoins(AI_TEAM, COINS_PER_SEC * dt);

      aiCooldown -= dt;
      if (aiCooldown <= 0) {
        aiCooldown = AI_DECISION_INTERVAL_SEC;
        runAiDecision();
      }
    }

    for (const slot of slots) {
      slot.platform.update(dt, elapsed);
      const b = slot.building;
      if (!b) continue;
      b.update(dt, elapsed);
      if (b.expired) {
        clearExpiredBuilding(slot);
        continue;
      }
      if (b.destroyed) continue;
      slot.spawnCooldown -= dt;
      if (slot.spawnCooldown <= 0) {
        spawnFrom(slot);
        slot.spawnCooldown = spawnIntervalFor(b.kind);
      }
    }

    for (let i = 0; i < turrets.length; i++) {
      updateTurret(turrets[i], turretHpBars[i]);
      turrets[i].update(dt, elapsed);
    }

    for (const agent of agents) {
      if (agent.unit.destroyed) noteUnitDeath(agent.unit);
      updateAgent(agent, dt);
    }

    for (const agent of agents) agent.unit.update(dt, elapsed);

    coinFx.update(dt, scene);

    for (let i = agents.length - 1; i >= 0; i--) {
      if (agents[i].unit.expired) {
        agents[i].hpBar.dispose();
        agents[i].unit.dispose();
        agents.splice(i, 1);
      }
    }

    for (let i = turrets.length - 1; i >= 0; i--) {
      if (!turrets[i].expired) continue;
      turretHpBars[i].dispose();
      turrets[i].dispose();
      turrets.splice(i, 1);
      turretHpBars.splice(i, 1);
    }

    checkEndConditions();
  });

  return {
    scene,
    dispose: () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointerup", onPointerUp);
      hud.dispose();
      coinFx.dispose();
      for (const agent of agents) {
        agent.hpBar.dispose();
        agent.unit.dispose();
      }
      for (const slot of slots) {
        slot.building?.dispose();
        slot.pickProxy.dispose();
        slot.platform.dispose();
      }
      for (let i = 0; i < turrets.length; i++) {
        turretHpBars[i].dispose();
        turrets[i].dispose();
      }
      terrain.dispose();
      scene.dispose();
    },
  };
}
