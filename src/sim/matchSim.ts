import type { BuildingKind } from "../buildings/types";
import { createAiBrain, type AiSlotView, type AiSnapshot } from "../game/aiStrategy";
import { bypassAroundObstacle, clampToPlayfield, steerToward } from "../game/pathfinding";
import {
  buildingLineZ,
  getBuildingSlotPositions,
  getTurretPositions,
} from "../game/slotLayout";
import {
  ACCURACY_AT_MAX_RANGE,
  ACCURACY_AT_POINT_BLANK,
  AI_DECISION_INTERVAL_SEC,
  BUILD_DURATION_SEC,
  BUILDING_COST,
  BUILDING_MAX_HP,
  BUILDING_TO_UNIT,
  COINS_PER_SEC,
  CORPSE_LIFETIME_SEC,
  FLAG_CAPTURE_RADIUS,
  FLAG_COINS_PER_SEC,
  HELI_GUN_DAMAGE,
  HELI_GUN_FIRE_HZ,
  HELI_GUN_RANGE,
  MISS_SCATTER_RADIUS,
  MISSILE_SPLASH_RADIUS,
  PLAY_DEPTH,
  PLAY_WIDTH,
  spawnIntervalForBuilding,
  STARTING_COINS,
  SUPPLY_TRUCK_COIN_AMOUNT,
  SUPPLY_TRUCK_COIN_INTERVAL_SEC,
  TANK_SPLASH_RADIUS,
  TURRET_BOUNTY,
  TURRET_DAMAGE,
  TURRET_FIRE_HZ,
  TURRET_MAX_HP,
  TURRET_SHOOT_RANGE,
  UNIT_STATS,
  type UnitKind,
} from "../game/stats";
import {
  createTeamTechLevels,
  heliGunFireRateMul,
  INFANTRY_ACCURACY_MUL,
  infantryProdMul,
  SUPPLY_SPEED_BONUS_PER_LEVEL,
  TANK_FIRE_RATE_MUL,
  TANK_HP_MUL,
  TANK_SPLASH_MUL,
  TURRET_RANGE_MUL,
  TURRET_REGEN_DELAY_SEC,
  TURRET_REGEN_HP_PER_SEC,
  UPGRADE_DEFS,
  upgradeCost,
  type UpgradeId,
} from "../game/upgrades";
import type { Team } from "../theme/colors";
import { distXZ, hitYForKind, shortestAngleDelta } from "./math";
import { createSimObstacles } from "./obstacles";
import { createRng, type Rng } from "./rng";
import type {
  FocusKind,
  MatchEvent,
  MatchSnapshot,
  PlayerCommand,
  ResearchSnapshot,
  WeaponKind,
} from "./types";

const TANK_HULL_TURN_SPEED = 0.45;
const TANK_ALIGN_RAD = 0.2;
const UNIT_SEP_PADDING = 0.28;
const UNIT_SEP_STEER = 1.35;
const UNIT_SEP_RESOLVE = 7;
const MISSILE_SPEED = 1.3 * 4;
const MISSILE_DIVE_RANGE = 2.6;
const MISSILE_HIT_RANGE = 0.55;
const MISSILE_CRUISE_Y = 2.7;
const HELI_MISSILE_HZ = 0.2;
const AI_TEAM: Team = "red";

export interface MatchSimOpts {
  seed?: number;
  vsAi?: boolean;
}

export interface MatchSim {
  enqueue: (team: Team, cmd: PlayerCommand) => void;
  start: () => void;
  readonly started: boolean;
  tick: (dt: number) => MatchEvent[];
  snapshot: () => MatchSnapshot;
}

interface FocusRef {
  kind: FocusKind;
  id: number;
}

interface SimBuilding {
  id: number;
  team: Team;
  kind: BuildingKind;
  hp: number;
  maxHp: number;
  constructing: boolean;
  collapsing: boolean;
  destroyed: boolean;
  constructAge: number;
  wreckAge: number;
}

interface SimSlot {
  team: Team;
  index: number;
  x: number;
  z: number;
  rotY: number;
  building: SimBuilding | null;
  spawnCooldown: number;
}

interface SimTurret {
  id: number;
  team: Team;
  x: number;
  z: number;
  hp: number;
  maxHp: number;
  shootRange: number;
  damage: number;
  destroyed: boolean;
  fireCooldown: number;
  lastHurt: number;
  lastAttacker: Team | null;
  bountyAwarded: boolean;
  focus: FocusRef | null;
}

interface SimUnit {
  id: number;
  team: Team;
  kind: UnitKind;
  x: number;
  z: number;
  yaw: number;
  hp: number;
  maxHp: number;
  damage: number;
  shootRange: number;
  moveSpeed: number;
  fireRateHz: number;
  destroyed: boolean;
  expired: boolean;
  wreckAge: number;
  moving: boolean;
  combat: boolean;
  missilesEnabled: boolean;
  fireCooldown: number;
  moveTarget: { x: number; z: number } | null;
  bypass: { x: number; z: number } | null;
  arrived: boolean;
  focus: FocusRef | null;
  lockedUnitId: number | null;
  stuckTimer: number;
  lastX: number;
  lastZ: number;
  coinCooldown: number;
  knockVx: number;
  knockVz: number;
}

interface SimMissile {
  id: number;
  heliId: number;
  team: Team;
  damage: number;
  target: FocusRef;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  cruiseY: number;
  age: number;
}

interface ActiveResearch {
  id: UpgradeId;
  elapsed: number;
  duration: number;
}

function spawnIntervalFor(kind: BuildingKind, infantryProdLevel = 0): number {
  const base = spawnIntervalForBuilding(kind);
  if (kind === "barracks") return base / infantryProdMul(infantryProdLevel);
  return base;
}

export function createMatchSim(opts: MatchSimOpts = {}): MatchSim {
  const rng: Rng = createRng(opts.seed ?? 1);
  const vsAi = opts.vsAi ?? false;
  const halfX = PLAY_WIDTH * 0.5;
  const halfZ = PLAY_DEPTH * 0.5;
  const buildingZ = buildingLineZ(halfZ);
  const field = createSimObstacles();

  const coins: Record<Team, number> = {
    blue: STARTING_COINS,
    red: STARTING_COINS,
  };
  const techLevels: Record<Team, Record<UpgradeId, number>> = {
    blue: createTeamTechLevels(),
    red: createTeamTechLevels(),
  };
  const activeResearch: Record<Team, ActiveResearch | null> = {
    blue: null,
    red: null,
  };

  const slots: SimSlot[] = getBuildingSlotPositions(halfX, halfZ).map((p) => ({
    team: p.team,
    index: p.index,
    x: p.x,
    z: p.z,
    rotY: p.team === "blue" ? 0 : Math.PI,
    building: null,
    spawnCooldown: 0,
  }));

  let nextTurretId = 1;
  const turrets: SimTurret[] = [];
  for (const team of ["blue", "red"] as const) {
    const positions = getTurretPositions(halfX, halfZ).filter((p) =>
      team === "blue" ? p.z < 0 : p.z > 0,
    );
    for (const p of positions) {
      turrets.push({
        id: nextTurretId++,
        team,
        x: p.x,
        z: p.z,
        hp: TURRET_MAX_HP,
        maxHp: TURRET_MAX_HP,
        shootRange: TURRET_SHOOT_RANGE,
        damage: TURRET_DAMAGE,
        destroyed: false,
        fireCooldown: rng.range(0.3, 0.7),
        lastHurt: -999,
        lastAttacker: null,
        bountyAwarded: false,
        focus: null,
      });
    }
  }

  const units: SimUnit[] = [];
  const missiles: SimMissile[] = [];
  const wreckBuildings: SimBuilding[] = [];

  let nextBuildingId = 100;
  let nextUnitId = 1000;
  let nextMissileId = 10000;
  let elapsed = 0;
  let tickCount = 0;
  let started = false;
  let gameOver = false;
  let winner: Team | null = null;
  let anyBuildingDestroyed = false;
  let flagOwner: Team | null = null;
  let flagCoinCooldown = 0;
  let aiCooldown = vsAi
    ? AI_DECISION_INTERVAL_SEC * (0.25 + rng.next() * 0.35)
    : Infinity;
  const aiBrain = vsAi ? createAiBrain() : null;
  if (aiBrain && typeof console !== "undefined") {
    console.info(`[AI] Strategy: ${aiBrain.label}`);
  }

  const pending: { team: Team; cmd: PlayerCommand }[] = [];
  const events: MatchEvent[] = [];

  function emit(ev: MatchEvent): void {
    events.push(ev);
  }

  function livingBuildings(team: Team): SimBuilding[] {
    return slots
      .filter((s) => s.team === team && s.building && !s.building.destroyed)
      .map((s) => s.building!);
  }

  function countBuildingsByKind(team: Team): Record<BuildingKind, number> {
    const counts: Record<BuildingKind, number> = {
      barracks: 0,
      depot: 0,
      factory: 0,
      helipad: 0,
      researchLab: 0,
    };
    for (const b of livingBuildings(team)) counts[b.kind] += 1;
    return counts;
  }

  function teamHasLab(team: Team): boolean {
    return livingBuildings(team).some(
      (b) => b.kind === "researchLab" && !b.constructing,
    );
  }

  function trySpend(team: Team, cost: number): boolean {
    if (coins[team] < cost) return false;
    coins[team] -= cost;
    return true;
  }

  function addCoins(team: Team, amount: number): void {
    coins[team] += amount;
  }

  function tankFireRateHz(team: Team): number {
    const base = UNIT_STATS.tank.fireRateHz;
    return techLevels[team].tankFireRate > 0 ? base * TANK_FIRE_RATE_MUL : base;
  }

  function heliChinGunFireRateHz(team: Team): number {
    return HELI_GUN_FIRE_HZ * heliGunFireRateMul(techLevels[team].heliGunFireRate);
  }

  function placeBuilding(slot: SimSlot, kind: BuildingKind): boolean {
    if (slot.building && !slot.building.destroyed) return false;
    if (slot.building?.destroyed) return false;
    const cost = BUILDING_COST[kind];
    if (!trySpend(slot.team, cost)) return false;
    const building: SimBuilding = {
      id: nextBuildingId++,
      team: slot.team,
      kind,
      hp: BUILDING_MAX_HP,
      maxHp: BUILDING_MAX_HP,
      constructing: true,
      collapsing: false,
      destroyed: false,
      constructAge: 0,
      wreckAge: 0,
    };
    slot.building = building;
    slot.spawnCooldown = 2.5 + rng.next() * 1.5;
    emit({
      type: "BuildingPlaced",
      team: slot.team,
      slotIndex: slot.index,
      kind,
      buildingId: building.id,
    });
    return true;
  }

  function noteBuildingDeath(): void {
    if (!anyBuildingDestroyed) anyBuildingDestroyed = true;
  }

  function freePadKeepWreck(slot: SimSlot): void {
    const b = slot.building;
    if (!b) return;
    wreckBuildings.push(b);
    slot.building = null;
    slot.spawnCooldown = 0;
    emit({ type: "PadFreed", team: slot.team, slotIndex: slot.index });
  }

  function collapseBuilding(slot: SimSlot): boolean {
    const b = slot.building;
    if (!b || b.destroyed || b.collapsing) return false;
    if (livingBuildings(slot.team).length <= 1) return false;
    b.collapsing = true;
    b.constructing = false;
    b.destroyed = true;
    b.hp = 0;
    noteBuildingDeath();
    emit({
      type: "BuildingCollapsed",
      team: slot.team,
      slotIndex: slot.index,
      buildingId: b.id,
    });
    freePadKeepWreck(slot);
    return true;
  }

  function destroyBuilding(slot: SimSlot, b: SimBuilding): void {
    if (b.destroyed) return;
    b.destroyed = true;
    b.constructing = false;
    b.hp = 0;
    noteBuildingDeath();
    emit({
      type: "BuildingDestroyed",
      team: slot.team,
      slotIndex: slot.index,
      buildingId: b.id,
    });
  }

  function applyUpgradeEffect(team: Team, id: UpgradeId): void {
    if (id === "heliMissiles") {
      for (const u of units) {
        if (u.team === team && u.kind === "helicopter" && !u.destroyed) {
          u.missilesEnabled = true;
        }
      }
    }
    if (id === "heliGunFireRate") {
      for (const u of units) {
        if (u.team === team && u.kind === "helicopter" && !u.destroyed) {
          u.fireRateHz = heliChinGunFireRateHz(team);
        }
      }
    }
    if (id === "turretRange") {
      for (const t of turrets) {
        if (t.team === team && !t.destroyed) {
          t.shootRange = TURRET_SHOOT_RANGE * TURRET_RANGE_MUL;
        }
      }
    }
    if (id === "tankHp") {
      for (const u of units) {
        if (u.team === team && u.kind === "tank" && !u.destroyed) {
          u.maxHp *= TANK_HP_MUL;
          u.hp *= TANK_HP_MUL;
        }
      }
    }
    if (id === "tankFireRate") {
      for (const u of units) {
        if (u.team === team && u.kind === "tank" && !u.destroyed) {
          u.fireRateHz = tankFireRateHz(team);
        }
      }
    }
  }

  function completeResearch(team: Team, id: UpgradeId): void {
    techLevels[team][id] += 1;
    activeResearch[team] = null;
    applyUpgradeEffect(team, id);
    emit({ type: "ResearchComplete", team, id });
  }

  function beginResearch(team: Team, id: UpgradeId): boolean {
    if (activeResearch[team]) return false;
    if (!teamHasLab(team)) return false;
    const def = UPGRADE_DEFS[id];
    const level = techLevels[team][id];
    if (level >= def.maxLevel) return false;
    const cost = upgradeCost(def, level);
    if (!trySpend(team, cost)) return false;
    activeResearch[team] = { id, elapsed: 0, duration: def.durationSec };
    emit({ type: "ResearchStarted", team, id });
    return true;
  }

  function tickResearch(team: Team, dt: number): void {
    const active = activeResearch[team];
    if (!active) return;
    if (!teamHasLab(team)) return;
    active.elapsed += dt;
    if (active.elapsed >= active.duration) completeResearch(team, active.id);
  }

  function applyCommand(team: Team, cmd: PlayerCommand): boolean {
    if (gameOver) return false;
    if (cmd.type === "build") {
      const slot = slots.find((s) => s.team === team && s.index === cmd.slotIndex);
      if (!slot) return false;
      return placeBuilding(slot, cmd.kind);
    }
    if (cmd.type === "collapse") {
      const slot = slots.find((s) => s.team === team && s.index === cmd.slotIndex);
      if (!slot) return false;
      return collapseBuilding(slot);
    }
    return beginResearch(team, cmd.id);
  }

  function bodyRadius(kind: UnitKind): number {
    return UNIT_STATS[kind].radius;
  }

  function posOfFocus(ref: FocusRef): { x: number; z: number; y: number } | null {
    if (ref.kind === "unit") {
      const u = units.find((n) => n.id === ref.id);
      if (!u || u.destroyed) return null;
      return { x: u.x, z: u.z, y: hitYForKind(u.kind) };
    }
    if (ref.kind === "turret") {
      const t = turrets.find((n) => n.id === ref.id);
      if (!t || t.destroyed) return null;
      return { x: t.x, z: t.z, y: hitYForKind("turret") };
    }
    for (const slot of slots) {
      if (slot.building?.id === ref.id && !slot.building.destroyed) {
        return { x: slot.x, z: slot.z, y: hitYForKind("building") };
      }
    }
    return null;
  }

  function entityDestroyed(ref: FocusRef): boolean {
    return posOfFocus(ref) === null;
  }

  function canTargetUnit(attacker: SimUnit, other: SimUnit): boolean {
    if (other.destroyed || other.team === attacker.team) return false;
    if (attacker.kind === "supplyTruck") return false;
    if (attacker.kind === "tank" && other.kind === "helicopter") return false;
    return true;
  }

  function engageRange(attacker: SimUnit, target: FocusRef): number {
    if (attacker.kind === "helicopter") {
      const useMissile =
        attacker.missilesEnabled &&
        target.kind === "unit" &&
        (() => {
          const u = units.find((n) => n.id === target.id);
          return u?.kind === "tank" || u?.kind === "supplyTruck";
        })();
      return useMissile ? attacker.shootRange : HELI_GUN_RANGE;
    }
    return attacker.shootRange;
  }

  function rollAccuracy(distance: number, maxRange: number, accuracyMul = 1): boolean {
    const t =
      maxRange <= 1e-6 ? 0 : Math.min(1, Math.max(0, distance / maxRange));
    const base =
      ACCURACY_AT_POINT_BLANK +
      (ACCURACY_AT_MAX_RANGE - ACCURACY_AT_POINT_BLANK) * t;
    return rng.chance(Math.min(1, base * accuracyMul));
  }

  function scatterAim(
    fromX: number,
    fromZ: number,
    _fromY: number,
    aimX: number,
    aimY: number,
    aimZ: number,
  ): { x: number; y: number; z: number } {
    const dx = aimX - fromX;
    const dz = aimZ - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    const fx = dx / len;
    const fz = dz / len;
    const px = -fz;
    const pz = fx;
    const radius = MISS_SCATTER_RADIUS;
    const lat = rng.signed(radius);
    const along = rng.signed(radius * 0.4);
    return {
      x: aimX + px * lat + fx * along,
      y: aimY + rng.signed(radius * 0.3),
      z: aimZ + pz * lat + fz * along,
    };
  }

  function markAttacker(ref: FocusRef, team: Team): void {
    if (ref.kind !== "turret") return;
    const t = turrets.find((n) => n.id === ref.id);
    if (t) t.lastAttacker = team;
  }

  function awardTurretBounty(turret: SimTurret): void {
    if (turret.bountyAwarded) return;
    const killer = turret.lastAttacker;
    if (!killer || killer === turret.team) return;
    turret.bountyAwarded = true;
    addCoins(killer, TURRET_BOUNTY);
    emit({
      type: "TurretBounty",
      turretId: turret.id,
      killer,
      amount: TURRET_BOUNTY,
    });
  }

  function killUnit(u: SimUnit): void {
    if (u.destroyed) return;
    u.destroyed = true;
    u.combat = false;
    u.moving = false;
    u.focus = null;
    u.lockedUnitId = null;
    emit({ type: "UnitDied", unitId: u.id });
  }

  function killTurret(t: SimTurret): void {
    if (t.destroyed) return;
    t.destroyed = true;
    t.focus = null;
    emit({ type: "TurretDied", turretId: t.id });
    awardTurretBounty(t);
  }

  function damageFocus(ref: FocusRef, amount: number, attackerTeam: Team): void {
    if (amount <= 0) return;
    markAttacker(ref, attackerTeam);
    if (ref.kind === "unit") {
      const u = units.find((n) => n.id === ref.id);
      if (!u || u.destroyed) return;
      u.hp = Math.max(0, u.hp - amount);
      if (u.hp <= 0) killUnit(u);
      return;
    }
    if (ref.kind === "turret") {
      const t = turrets.find((n) => n.id === ref.id);
      if (!t || t.destroyed) return;
      t.lastHurt = elapsed;
      t.hp = Math.max(0, t.hp - amount);
      if (t.hp <= 0) killTurret(t);
      return;
    }
    for (const slot of slots) {
      const b = slot.building;
      if (!b || b.id !== ref.id || b.destroyed) continue;
      b.hp = Math.max(0, b.hp - amount);
      if (b.hp <= 0) destroyBuilding(slot, b);
      return;
    }
  }

  function applyKnock(ref: FocusRef, fromX: number, fromZ: number, strength: number): void {
    if (ref.kind !== "unit") return;
    const u = units.find((n) => n.id === ref.id);
    if (!u || u.destroyed || u.kind === "helicopter") return;
    const dx = u.x - fromX;
    const dz = u.z - fromZ;
    const len = Math.hypot(dx, dz) || 1;
    u.knockVx += (dx / len) * strength * 0.35;
    u.knockVz += (dz / len) * strength * 0.35;
  }

  function applyArealHit(
    cx: number,
    cz: number,
    main: FocusRef | null,
    baseDamage: number,
    radius: number,
    attackerTeam: Team,
    impact?: { fromX: number; fromZ: number; strength: number },
  ): void {
    const hit = (kind: FocusKind, id: number, x: number, z: number) => {
      const isMain = main !== null && main.kind === kind && main.id === id;
      if (!isMain) {
        if (Math.hypot(cx - x, cz - z) > radius) return;
      }
      const dmg = isMain ? baseDamage : baseDamage * 0.5;
      const ref: FocusRef = { kind, id };
      damageFocus(ref, dmg, attackerTeam);
      if (impact) {
        applyKnock(
          ref,
          impact.fromX,
          impact.fromZ,
          isMain ? impact.strength : impact.strength * 0.55,
        );
      }
    };

    for (const u of units) {
      if (u.destroyed || u.team === attackerTeam) continue;
      hit("unit", u.id, u.x, u.z);
    }
    for (const slot of slots) {
      const b = slot.building;
      if (!b || b.destroyed || b.team === attackerTeam) continue;
      hit("building", b.id, slot.x, slot.z);
    }
    for (const t of turrets) {
      if (t.destroyed || t.team === attackerTeam) continue;
      hit("turret", t.id, t.x, t.z);
    }
  }

  function fireHitscan(
    fromX: number,
    fromZ: number,
    fromY: number,
    attackerId: number,
    attackerKind: "unit" | "turret",
    attackerTeam: Team,
    weapon: WeaponKind,
    target: FocusRef,
    damage: number,
    maxRange: number,
    accuracyMul: number,
    splash?: { radius: number; impactStrength: number },
  ): void {
    const aim = posOfFocus(target);
    if (!aim) return;
    const didHit = rollAccuracy(distXZ(fromX, fromZ, aim.x, aim.z), maxRange, accuracyMul);
    const impact = didHit
      ? { x: aim.x, y: aim.y, z: aim.z }
      : scatterAim(fromX, fromZ, fromY, aim.x, aim.y, aim.z);
    emit({
      type: "UnitFired",
      attackerId,
      attackerKind,
      targetId: target.id,
      targetKind: target.kind,
      didHit,
      impactX: impact.x,
      impactY: impact.y,
      impactZ: impact.z,
      weapon,
    });
    if (splash) {
      applyArealHit(
        impact.x,
        impact.z,
        didHit ? target : null,
        damage,
        splash.radius,
        attackerTeam,
        { fromX, fromZ, strength: splash.impactStrength },
      );
      return;
    }
    if (!didHit) return;
    damageFocus(target, damage, attackerTeam);
  }

  function spawnFrom(slot: SimSlot): void {
    const b = slot.building;
    if (!b || b.destroyed || !BUILDING_TO_UNIT[b.kind]) return;
    const kind = BUILDING_TO_UNIT[b.kind]!;
    const towardEnemy = b.team === "blue" ? 1 : -1;
    const spawnX = slot.x + rng.signed(0.3);
    const spawnZ = slot.z + towardEnemy * 2.1;
    const stats = UNIT_STATS[kind];
    const supplyRate =
      1 + SUPPLY_SPEED_BONUS_PER_LEVEL * techLevels[b.team].supplySpeed;
    const advanceZ = towardEnemy * (buildingZ - 3.5);
    const unit: SimUnit = {
      id: nextUnitId++,
      team: b.team,
      kind,
      x: spawnX,
      z: spawnZ,
      yaw: towardEnemy > 0 ? 0 : Math.PI,
      hp: stats.maxHp,
      maxHp: stats.maxHp,
      damage: stats.damage,
      shootRange: stats.shootRange,
      moveSpeed: stats.moveSpeed,
      fireRateHz:
        kind === "tank"
          ? tankFireRateHz(b.team)
          : kind === "helicopter"
            ? heliChinGunFireRateHz(b.team)
            : stats.fireRateHz,
      destroyed: false,
      expired: false,
      wreckAge: 0,
      moving: false,
      combat: false,
      missilesEnabled: kind === "helicopter" && techLevels[b.team].heliMissiles > 0,
      fireCooldown: 0,
      moveTarget: { x: spawnX + rng.signed(0.75), z: advanceZ },
      bypass: null,
      arrived: false,
      focus: null,
      lockedUnitId: null,
      stuckTimer: 0,
      lastX: spawnX,
      lastZ: spawnZ,
      coinCooldown:
        (SUPPLY_TRUCK_COIN_INTERVAL_SEC / supplyRate) * rng.range(0.4, 1),
      knockVx: 0,
      knockVz: 0,
    };
    if (kind === "tank" && techLevels[b.team].tankHp > 0) {
      unit.maxHp *= TANK_HP_MUL;
      unit.hp *= TANK_HP_MUL;
    }
    units.push(unit);
    emit({
      type: "UnitSpawned",
      unitId: unit.id,
      team: unit.team,
      kind,
      x: spawnX,
      z: spawnZ,
      yaw: unit.yaw,
      buildingId: b.id,
    });
  }

  function findUnitToLock(unit: SimUnit): SimUnit | null {
    let best: SimUnit | null = null;
    let bestDist = Infinity;
    for (const other of units) {
      if (!canTargetUnit(unit, other)) continue;
      const d = distXZ(unit.x, unit.z, other.x, other.z);
      const range = engageRange(unit, { kind: "unit", id: other.id });
      if (d <= range && d < bestDist) {
        bestDist = d;
        best = other;
      }
    }
    return best;
  }

  function isEngagingVictim(attacker: SimUnit, victim: SimUnit): boolean {
    if (attacker.destroyed) return false;
    if (attacker.lockedUnitId !== victim.id && attacker.focus?.id !== victim.id) {
      return false;
    }
    return (
      distXZ(attacker.x, attacker.z, victim.x, victim.z) <=
      engageRange(attacker, { kind: "unit", id: victim.id })
    );
  }

  function findEnemyEngaging(victim: SimUnit): SimUnit | null {
    let best: SimUnit | null = null;
    let bestDist = Infinity;
    for (const other of units) {
      if (!canTargetUnit(victim, other)) continue;
      if (!isEngagingVictim(other, victim)) continue;
      const d = distXZ(victim.x, victim.z, other.x, other.z);
      if (d < bestDist) {
        bestDist = d;
        best = other;
      }
    }
    return best;
  }

  function findBuildingInRange(unit: SimUnit): FocusRef | null {
    let best: FocusRef | null = null;
    let bestDist = Infinity;
    for (const slot of slots) {
      const b = slot.building;
      if (!b || b.destroyed || b.team === unit.team) continue;
      const ref: FocusRef = { kind: "building", id: b.id };
      const d = distXZ(unit.x, unit.z, slot.x, slot.z);
      if (d <= engageRange(unit, ref) && d < bestDist) {
        bestDist = d;
        best = ref;
      }
    }
    for (const t of turrets) {
      if (t.destroyed || t.team === unit.team) continue;
      const ref: FocusRef = { kind: "turret", id: t.id };
      const d = distXZ(unit.x, unit.z, t.x, t.z);
      if (d <= engageRange(unit, ref) && d < bestDist) {
        bestDist = d;
        best = ref;
      }
    }
    return best;
  }

  function findClosestEnemyStructure(unit: SimUnit): FocusRef | null {
    let best: FocusRef | null = null;
    let bestDist = Infinity;
    for (const slot of slots) {
      const b = slot.building;
      if (!b || b.destroyed || b.team === unit.team) continue;
      const d = distXZ(unit.x, unit.z, slot.x, slot.z);
      if (d < bestDist) {
        bestDist = d;
        best = { kind: "building", id: b.id };
      }
    }
    for (const t of turrets) {
      if (t.destroyed || t.team === unit.team) continue;
      const d = distXZ(unit.x, unit.z, t.x, t.z);
      if (d < bestDist) {
        bestDist = d;
        best = { kind: "turret", id: t.id };
      }
    }
    return best;
  }

  function acquireTurretTarget(turret: SimTurret): FocusRef | null {
    let best: FocusRef | null = null;
    let bestDist = Infinity;
    const consider = (kind: FocusKind, id: number, x: number, z: number, team: Team) => {
      if (team === turret.team) return;
      const d = distXZ(turret.x, turret.z, x, z);
      if (d <= turret.shootRange && d < bestDist) {
        bestDist = d;
        best = { kind, id };
      }
    };
    for (const u of units) {
      if (u.destroyed) continue;
      consider("unit", u.id, u.x, u.z, u.team);
    }
    for (const slot of slots) {
      const b = slot.building;
      if (!b || b.destroyed) continue;
      consider("building", b.id, slot.x, slot.z, b.team);
    }
    return best;
  }

  function sameMoveLayer(a: UnitKind, b: UnitKind): boolean {
    return (a === "helicopter") === (b === "helicopter");
  }

  function neighborSeparation(unit: SimUnit): { x: number; z: number } {
    const ra = bodyRadius(unit.kind);
    let sx = 0;
    let sz = 0;
    for (const other of units) {
      if (other === unit || other.destroyed) continue;
      if (!sameMoveLayer(unit.kind, other.kind)) continue;
      const prefer = ra + bodyRadius(other.kind) + UNIT_SEP_PADDING;
      const dx = unit.x - other.x;
      const dz = unit.z - other.z;
      const d = Math.hypot(dx, dz);
      if (d >= prefer) continue;
      if (d < 1e-4) {
        sx += rng.signed(0.5);
        sz += rng.signed(0.5);
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
    const living = units.filter((u) => !u.destroyed);
    const n = living.length;
    if (n < 2) return;
    const pushX = new Float64Array(n);
    const pushZ = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      const a = living[i];
      const ra = bodyRadius(a.kind);
      for (let j = i + 1; j < n; j++) {
        const b = living[j];
        if (!sameMoveLayer(a.kind, b.kind)) continue;
        const minDist = ra + bodyRadius(b.kind) + UNIT_SEP_PADDING * 0.55;
        let dx = a.x - b.x;
        let dz = a.z - b.z;
        let d = Math.hypot(dx, dz);
        if (d >= minDist) continue;
        if (d < 1e-4) {
          const ang = rng.angle();
          dx = Math.cos(ang);
          dz = Math.sin(ang);
          d = 1;
        }
        const push = (minDist - d) * 0.5;
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
      const u = living[i];
      const px = pushX[i];
      const pz = pushZ[i];
      if (px * px + pz * pz < 1e-8) continue;
      const next = clampToPlayfield(u.x + px * rate, u.z + pz * rate, halfX, halfZ, 1.4);
      u.x = next.x;
      u.z = next.z;
    }
  }

  function moveToward(unit: SimUnit, goal: { x: number; z: number }, dt: number): void {
    const agentRadius =
      unit.kind === "tank" ? 0.7 : unit.kind === "helicopter" ? 0 : bodyRadius(unit.kind);
    const obstacles =
      unit.kind === "helicopter"
        ? []
        : unit.kind === "tank"
          ? field.rockObstacles
          : field.obstacles;
    const from = { x: unit.x, z: unit.z };
    const steerGoal = unit.bypass ?? goal;
    const moved = Math.hypot(from.x - unit.lastX, from.z - unit.lastZ);
    if (moved < unit.moveSpeed * dt * 0.25) unit.stuckTimer += dt;
    else unit.stuckTimer = Math.max(0, unit.stuckTimer - dt * 0.5);
    unit.lastX = from.x;
    unit.lastZ = from.z;

    if (unit.stuckTimer > 0.55 && !unit.bypass && obstacles.length > 0) {
      const bypass = bypassAroundObstacle(from, goal, obstacles, agentRadius);
      if (bypass) {
        unit.bypass = clampToPlayfield(bypass.x, bypass.z, halfX, halfZ, 1.4);
        unit.stuckTimer = 0;
      }
    }

    let dir = steerToward(from, steerGoal, obstacles, {
      arriveDist: unit.bypass ? 0.55 : 0.45,
      agentRadius,
    });
    const sep = neighborSeparation(unit);
    const sepLen = Math.hypot(sep.x, sep.z);
    if (sepLen > 1e-4) {
      if (!dir) dir = { x: sep.x / sepLen, z: sep.z / sepLen };
      else {
        dir = { x: dir.x + sep.x * UNIT_SEP_STEER, z: dir.z + sep.z * UNIT_SEP_STEER };
        const len = Math.hypot(dir.x, dir.z);
        if (len > 1e-5) dir = { x: dir.x / len, z: dir.z / len };
      }
    }
    if (!dir) {
      if (unit.bypass) {
        unit.bypass = null;
        unit.stuckTimer = 0;
        return;
      }
      unit.moving = false;
      return;
    }
    const yaw = Math.atan2(dir.x, dir.z);
    if (unit.kind === "tank") {
      const dy = shortestAngleDelta(unit.yaw, yaw);
      unit.yaw += Math.sign(dy) * Math.min(Math.abs(dy), TANK_HULL_TURN_SPEED * dt);
      if (Math.abs(dy) > TANK_ALIGN_RAD) {
        unit.moving = false;
        unit.stuckTimer = 0;
        unit.lastX = unit.x;
        unit.lastZ = unit.z;
        return;
      }
      unit.moving = true;
      const step = unit.moveSpeed * dt;
      const fx = Math.sin(unit.yaw);
      const fz = Math.cos(unit.yaw);
      const next = clampToPlayfield(
        unit.x + fx * step,
        unit.z + fz * step,
        halfX,
        halfZ,
        1.4,
      );
      unit.x = next.x;
      unit.z = next.z;
      field.ramTreesAt(next.x, next.z, 0.85);
      return;
    }
    unit.moving = true;
    const step = unit.moveSpeed * dt;
    const next = clampToPlayfield(
      unit.x + dir.x * step,
      unit.z + dir.z * step,
      halfX,
      halfZ,
      1.4,
    );
    unit.x = next.x;
    unit.z = next.z;
    const dy = shortestAngleDelta(unit.yaw, yaw);
    unit.yaw += Math.sign(dy) * Math.min(Math.abs(dy), 5 * dt);
  }

  function faceTarget(unit: SimUnit, target: FocusRef, dt: number): void {
    const p = posOfFocus(target);
    if (!p) return;
    const yaw = Math.atan2(p.x - unit.x, p.z - unit.z);
    if (unit.kind === "tank") {
      const dy = shortestAngleDelta(unit.yaw, yaw);
      unit.yaw += Math.sign(dy) * Math.min(Math.abs(dy), TANK_HULL_TURN_SPEED * dt);
    } else {
      const dy = shortestAngleDelta(unit.yaw, yaw);
      unit.yaw += Math.sign(dy) * Math.min(Math.abs(dy), 4 * dt);
    }
  }

  function enterCombat(unit: SimUnit): void {
    if (!unit.combat) {
      unit.combat = true;
      if (unit.kind === "rifleman") unit.fireCooldown = rng.range(0.15, 0.35);
      else if (unit.kind === "tank") unit.fireCooldown = 0.35;
      else if (unit.kind === "helicopter") unit.fireCooldown = rng.range(0.25, 0.45);
    }
  }

  function unitShouldMissile(unit: SimUnit, target: FocusRef): boolean {
    if (!unit.missilesEnabled || unit.kind !== "helicopter") return false;
    if (target.kind !== "unit") return false;
    const u = units.find((n) => n.id === target.id);
    return u?.kind === "tank" || u?.kind === "supplyTruck";
  }

  function fireUnit(unit: SimUnit): void {
    const target = unit.focus;
    if (!target) return;
    const aim = posOfFocus(target);
    if (!aim) return;
    if (unitShouldMissile(unit, target)) {
      const dx = aim.x - unit.x;
      const dz = aim.z - unit.z;
      const len = Math.hypot(dx, dz) || 1;
      const missile: SimMissile = {
        id: nextMissileId++,
        heliId: unit.id,
        team: unit.team,
        damage: unit.damage,
        target,
        x: unit.x,
        y: MISSILE_CRUISE_Y,
        z: unit.z,
        vx: dx / len,
        vy: 0,
        vz: dz / len,
        cruiseY: MISSILE_CRUISE_Y,
        age: 0,
      };
      missiles.push(missile);
      emit({
        type: "MissileLaunch",
        missileId: missile.id,
        heliId: unit.id,
        targetId: target.id,
        targetKind: target.kind,
        x: missile.x,
        y: missile.y,
        z: missile.z,
      });
      return;
    }

    let damage = unit.kind === "helicopter" ? HELI_GUN_DAMAGE : unit.damage;
    if (unit.kind === "rifleman" && target.kind === "unit") {
      const victim = units.find((n) => n.id === target.id);
      if (victim?.kind === "helicopter") damage *= 2;
    }
    const maxRange = engageRange(unit, target);
    const accuracyMul =
      unit.kind === "rifleman" && techLevels[unit.team].infantryAccuracy > 0
        ? INFANTRY_ACCURACY_MUL
        : 1;
    const weapon: WeaponKind =
      unit.kind === "tank" ? "tank" : unit.kind === "helicopter" ? "heliGun" : "rifle";
    const splash =
      unit.kind === "tank"
        ? {
            radius:
              techLevels[unit.team].tankSplash > 0
                ? TANK_SPLASH_RADIUS * TANK_SPLASH_MUL
                : TANK_SPLASH_RADIUS,
            impactStrength:
              techLevels[unit.team].tankSplash > 0 ? 14 : 8.5,
          }
        : undefined;
    fireHitscan(
      unit.x,
      unit.z,
      hitYForKind(unit.kind),
      unit.id,
      "unit",
      unit.team,
      weapon,
      target,
      damage,
      maxRange,
      accuracyMul,
      splash,
    );
  }

  function updateUnitCombatFire(unit: SimUnit, dt: number): void {
    if (!unit.combat || !unit.focus) return;
    if (entityDestroyed(unit.focus)) return;
    unit.fireCooldown -= dt;
    if (unit.fireCooldown > 0) return;
    const missile = unitShouldMissile(unit, unit.focus);
    unit.fireCooldown = 1 / (missile ? HELI_MISSILE_HZ : unit.fireRateHz);
    fireUnit(unit);
  }

  function updateAgent(unit: SimUnit, dt: number): void {
    if (unit.destroyed) return;
    unit.x += unit.knockVx * dt;
    unit.z += unit.knockVz * dt;
    unit.knockVx *= Math.exp(-8 * dt);
    unit.knockVz *= Math.exp(-8 * dt);
    const clamped = clampToPlayfield(unit.x, unit.z, halfX, halfZ, 1.4);
    unit.x = clamped.x;
    unit.z = clamped.z;

    if (unit.kind === "supplyTruck") {
      unit.coinCooldown -= dt;
      if (unit.coinCooldown <= 0) {
        const supplyRate =
          1 + SUPPLY_SPEED_BONUS_PER_LEVEL * techLevels[unit.team].supplySpeed;
        unit.coinCooldown = SUPPLY_TRUCK_COIN_INTERVAL_SEC / supplyRate;
        addCoins(unit.team, SUPPLY_TRUCK_COIN_AMOUNT);
        emit({
          type: "TruckCoin",
          unitId: unit.id,
          team: unit.team,
          amount: SUPPLY_TRUCK_COIN_AMOUNT,
        });
      }
      if (unit.arrived || !unit.moveTarget) {
        unit.moving = false;
        killUnit(unit);
        return;
      }
      moveToward(unit, unit.moveTarget, dt);
      if (
        !unit.bypass &&
        Math.hypot(unit.x - unit.moveTarget.x, unit.z - unit.moveTarget.z) < 0.5
      ) {
        unit.arrived = true;
        unit.moveTarget = null;
        unit.moving = false;
        killUnit(unit);
      }
      return;
    }

    if (unit.lockedUnitId !== null) {
      const locked = units.find((n) => n.id === unit.lockedUnitId);
      if (!locked || locked.destroyed) unit.lockedUnitId = null;
    }

    const attacker = findEnemyEngaging(unit);
    if (attacker) {
      const locked = unit.lockedUnitId
        ? units.find((n) => n.id === unit.lockedUnitId)
        : undefined;
      const lockedFightsUs = locked ? isEngagingVictim(locked, unit) : false;
      if (!locked || locked === attacker || !lockedFightsUs) {
        if (unit.lockedUnitId !== attacker.id) {
          unit.lockedUnitId = attacker.id;
          unit.bypass = null;
          unit.stuckTimer = 0;
        }
      }
    }

    if (!unit.lockedUnitId) {
      const found = findUnitToLock(unit);
      if (found) {
        unit.lockedUnitId = found.id;
        unit.bypass = null;
        unit.stuckTimer = 0;
      }
    }

    if (unit.lockedUnitId) {
      const locked = units.find((n) => n.id === unit.lockedUnitId);
      if (locked && !locked.destroyed) {
        unit.focus = { kind: "unit", id: locked.id };
        const d = distXZ(unit.x, unit.z, locked.x, locked.z);
        if (d <= engageRange(unit, unit.focus)) {
          enterCombat(unit);
          unit.moving = false;
          unit.bypass = null;
          faceTarget(unit, unit.focus, dt);
          updateUnitCombatFire(unit, dt);
        } else {
          unit.combat = false;
          moveToward(unit, { x: locked.x, z: locked.z }, dt);
        }
        return;
      }
    }

    if (unit.arrived) {
      const siege = findClosestEnemyStructure(unit);
      if (siege) {
        unit.focus = siege;
        const p = posOfFocus(siege);
        if (p) {
          const d = distXZ(unit.x, unit.z, p.x, p.z);
          if (d <= engageRange(unit, siege)) {
            enterCombat(unit);
            unit.moving = false;
            unit.bypass = null;
            faceTarget(unit, siege, dt);
            updateUnitCombatFire(unit, dt);
          } else {
            unit.combat = false;
            moveToward(unit, { x: p.x, z: p.z }, dt);
          }
          return;
        }
      }
      unit.focus = null;
      unit.combat = false;
      unit.moving = false;
      return;
    }

    const building = findBuildingInRange(unit);
    if (building) {
      unit.focus = building;
      enterCombat(unit);
      unit.moving = false;
      unit.bypass = null;
      faceTarget(unit, building, dt);
      updateUnitCombatFire(unit, dt);
      return;
    }

    unit.focus = null;
    unit.combat = false;
    if (!unit.moveTarget) {
      unit.moving = false;
      return;
    }
    moveToward(unit, unit.moveTarget, dt);
    if (
      !unit.bypass &&
      Math.hypot(unit.x - unit.moveTarget.x, unit.z - unit.moveTarget.z) < 0.5
    ) {
      unit.arrived = true;
      unit.moveTarget = null;
      unit.moving = false;
    }
  }

  function isEnemyTargetingTurret(turret: SimTurret): boolean {
    for (const u of units) {
      if (u.destroyed || u.team === turret.team) continue;
      if (u.focus?.kind === "turret" && u.focus.id === turret.id) return true;
    }
    return false;
  }

  function updateTurret(turret: SimTurret, dt: number): void {
    if (turret.destroyed) return;
    let focus = turret.focus;
    if (focus && entityDestroyed(focus)) focus = null;
    if (focus) {
      const p = posOfFocus(focus);
      if (!p || distXZ(turret.x, turret.z, p.x, p.z) > turret.shootRange) {
        focus = null;
      }
    }
    if (!focus) focus = acquireTurretTarget(turret);
    turret.focus = focus;

    if (
      techLevels[turret.team].turretRegen > 0 &&
      turret.hp < turret.maxHp &&
      !isEnemyTargetingTurret(turret)
    ) {
      if (elapsed - turret.lastHurt >= TURRET_REGEN_DELAY_SEC) {
        turret.hp = Math.min(turret.maxHp, turret.hp + TURRET_REGEN_HP_PER_SEC * dt);
      }
    }

    if (!focus) return;
    turret.fireCooldown -= dt;
    if (turret.fireCooldown > 0) return;
    turret.fireCooldown = 1 / TURRET_FIRE_HZ;
    fireHitscan(
      turret.x,
      turret.z,
      hitYForKind("turret"),
      turret.id,
      "turret",
      turret.team,
      "turret",
      focus,
      turret.damage,
      turret.shootRange,
      1,
    );
  }

  function updateMissiles(dt: number): void {
    for (let i = missiles.length - 1; i >= 0; i--) {
      const m = missiles[i];
      m.age += dt;
      const target = posOfFocus(m.target);
      if (!target) {
        m.y -= 2 * dt;
        m.x += m.vx * MISSILE_SPEED * dt;
        m.z += m.vz * MISSILE_SPEED * dt;
        if (m.age > 6 || m.y < 0.1) missiles.splice(i, 1);
        continue;
      }
      const horiz = Math.hypot(target.x - m.x, target.z - m.z);
      const diving = horiz < MISSILE_DIVE_RANGE;
      const tx = target.x;
      const ty = diving ? target.y : m.cruiseY;
      const tz = target.z;
      const dx = tx - m.x;
      const dy = ty - m.y;
      const dz = tz - m.z;
      const dist = Math.hypot(dx, dy, dz);
      if (dist < MISSILE_HIT_RANGE) {
        emit({
          type: "MissileHit",
          missileId: m.id,
          targetId: m.target.id,
          x: m.x,
          y: m.y,
          z: m.z,
        });
        applyArealHit(m.x, m.z, m.target, m.damage, MISSILE_SPLASH_RADIUS, m.team);
        missiles.splice(i, 1);
        continue;
      }
      if (dist > 1e-5) {
        const inv = 1 / dist;
        const wx = dx * inv;
        const wy = dy * inv;
        const wz = dz * inv;
        const turn = Math.min(1, 4.5 * dt);
        m.vx += (wx - m.vx) * turn;
        m.vy += (wy - m.vy) * turn;
        m.vz += (wz - m.vz) * turn;
        const vlen = Math.hypot(m.vx, m.vy, m.vz) || 1;
        m.vx /= vlen;
        m.vy /= vlen;
        m.vz /= vlen;
      }
      m.x += m.vx * MISSILE_SPEED * dt;
      m.y += m.vy * MISSILE_SPEED * dt;
      m.z += m.vz * MISSILE_SPEED * dt;
    }
  }

  function buildAiSnapshot(): AiSnapshot {
    const empty: AiSlotView[] = [];
    const occupied: AiSlotView[] = [];
    for (const slot of slots) {
      if (slot.team !== AI_TEAM) continue;
      const b = slot.building;
      if (!b || (b.destroyed && b.wreckAge >= CORPSE_LIFETIME_SEC)) {
        empty.push({ index: slot.index, x: slot.x, kind: null, canCollapse: false });
        continue;
      }
      if (b.destroyed || b.collapsing) continue;
      occupied.push({
        index: slot.index,
        x: slot.x,
        kind: b.kind,
        canCollapse: true,
      });
    }
    return {
      coins: coins[AI_TEAM],
      counts: countBuildingsByKind(AI_TEAM),
      empty,
      occupied,
      researching: activeResearch[AI_TEAM] !== null,
      labReady: teamHasLab(AI_TEAM),
      tech: { ...techLevels[AI_TEAM] },
      elapsed,
    };
  }

  function nextAiCooldown(): number {
    const rich = coins[AI_TEAM] >= 120;
    const openPads = slots.some((s) => s.team === AI_TEAM && !s.building);
    const base = rich && openPads ? 4.5 : rich ? 6 : AI_DECISION_INTERVAL_SEC;
    return base * rng.range(0.75, 1.25);
  }

  function runAiDecision(): void {
    if (!aiBrain || gameOver) return;
    const maxActions = coins[AI_TEAM] > 200 ? 3 : coins[AI_TEAM] > 100 ? 2 : 1;
    for (let n = 0; n < maxActions; n++) {
      const action = aiBrain.decide(buildAiSnapshot());
      if (action.type === "noop") break;
      if (action.type === "research") {
        if (!beginResearch(AI_TEAM, action.id)) break;
        continue;
      }
      if (action.type === "build") {
        const slot = slots.find(
          (s) => s.team === AI_TEAM && s.index === action.slotIndex,
        );
        if (!slot || !placeBuilding(slot, action.kind)) break;
        continue;
      }
      const slot = slots.find(
        (s) => s.team === AI_TEAM && s.index === action.slotIndex,
      );
      if (!slot || !collapseBuilding(slot)) break;
      break;
    }
  }

  function checkEndConditions(): void {
    if (gameOver || !anyBuildingDestroyed) return;
    const redDead = livingBuildings("red").length === 0;
    const blueDead = livingBuildings("blue").length === 0;
    if (redDead) {
      gameOver = true;
      winner = "blue";
      emit({ type: "MatchEnded", winner: "blue" });
    } else if (blueDead) {
      gameOver = true;
      winner = "red";
      emit({ type: "MatchEnded", winner: "red" });
    }
  }

  function takeSnapshot(): MatchSnapshot {
    const researchSnap = (team: Team): ResearchSnapshot | null => {
      const a = activeResearch[team];
      return a ? { id: a.id, elapsed: a.elapsed, duration: a.duration } : null;
    };
    return {
      tick: tickCount,
      elapsed,
      coins: { blue: coins.blue, red: coins.red },
      tech: {
        blue: { ...techLevels.blue },
        red: { ...techLevels.red },
      },
      research: { blue: researchSnap("blue"), red: researchSnap("red") },
      flagOwner,
      gameOver,
      winner,
      slots: slots.map((s) => {
        const b = s.building;
        return {
          team: s.team,
          index: s.index,
          x: s.x,
          z: s.z,
          buildingId: b?.id ?? null,
          kind: b && !b.destroyed ? b.kind : null,
          hp: b && !b.destroyed ? b.hp : 0,
          maxHp: b?.maxHp ?? BUILDING_MAX_HP,
          constructing: !!b && b.constructing,
          collapsing: !!b && b.collapsing,
          destroyed: !b || b.destroyed,
          constructAge: b?.constructAge ?? 0,
        };
      }),
      turrets: turrets.map((t) => ({
        id: t.id,
        team: t.team,
        x: t.x,
        z: t.z,
        hp: t.hp,
        maxHp: t.maxHp,
        destroyed: t.destroyed,
        shootRange: t.shootRange,
        focusId: t.focus?.id ?? null,
        focusKind: t.focus?.kind ?? null,
      })),
      units: units.filter((u) => !u.expired).map((u) => ({
        id: u.id,
        team: u.team,
        kind: u.kind,
        x: u.x,
        z: u.z,
        yaw: u.yaw,
        hp: u.hp,
        maxHp: u.maxHp,
        destroyed: u.destroyed,
        moving: u.moving,
        combat: u.combat,
        focusId: u.focus?.id ?? null,
        focusKind: u.focus?.kind ?? null,
        missilesEnabled: u.missilesEnabled,
      })),
      missiles: missiles.map((m) => ({
        id: m.id,
        heliId: m.heliId,
        x: m.x,
        y: m.y,
        z: m.z,
        yaw: Math.atan2(m.vx, m.vz),
        pitch: -Math.atan2(m.vy, Math.hypot(m.vx, m.vz)),
        targetId: m.target.id,
      })),
    };
  }

  return {
    enqueue: (team, cmd) => {
      pending.push({ team, cmd });
    },
    start: () => {
      started = true;
    },
    get started() {
      return started;
    },
    tick: (dt: number) => {
      events.length = 0;
      if (!started) return [];
      elapsed += dt;
      tickCount += 1;

      while (pending.length > 0) {
        const item = pending.shift()!;
        applyCommand(item.team, item.cmd);
      }

      if (!gameOver) {
        addCoins("blue", COINS_PER_SEC * dt);
        addCoins("red", COINS_PER_SEC * dt);

        let blueIn = false;
        let redIn = false;
        for (const u of units) {
          if (u.destroyed) continue;
          if (u.x * u.x + u.z * u.z > FLAG_CAPTURE_RADIUS * FLAG_CAPTURE_RADIUS) {
            continue;
          }
          if (u.team === "blue") blueIn = true;
          else redIn = true;
          if (blueIn && redIn) break;
        }
        let nextOwner: Team | null = null;
        if (blueIn && !redIn) nextOwner = "blue";
        else if (redIn && !blueIn) nextOwner = "red";
        if (nextOwner !== flagOwner) {
          flagOwner = nextOwner;
          emit({ type: "FlagOwnerChanged", owner: flagOwner });
        }
        if (flagOwner) {
          flagCoinCooldown -= dt;
          if (flagCoinCooldown <= 0) {
            flagCoinCooldown = 1;
            addCoins(flagOwner, FLAG_COINS_PER_SEC);
          }
        } else {
          flagCoinCooldown = 0;
        }

        if (vsAi) {
          aiCooldown -= dt;
          if (aiCooldown <= 0) {
            runAiDecision();
            aiCooldown = nextAiCooldown();
          }
        }

        tickResearch("blue", dt);
        tickResearch("red", dt);
      }

      for (const slot of slots) {
        const b = slot.building;
        if (!b) continue;
        if (b.destroyed) {
          b.wreckAge += dt;
          if (b.wreckAge >= CORPSE_LIFETIME_SEC) {
            slot.building = null;
            slot.spawnCooldown = 0;
            emit({ type: "PadFreed", team: slot.team, slotIndex: slot.index });
          }
          continue;
        }
        if (b.constructing) {
          b.constructAge += dt;
          if (b.constructAge >= BUILD_DURATION_SEC) {
            b.constructing = false;
            emit({
              type: "ConstructionComplete",
              buildingId: b.id,
              slotIndex: slot.index,
              team: slot.team,
            });
          } else {
            continue;
          }
        }
        if (gameOver) continue;
        if (b.kind === "researchLab") continue;
        slot.spawnCooldown -= dt;
        if (slot.spawnCooldown <= 0) {
          spawnFrom(slot);
          slot.spawnCooldown = spawnIntervalFor(
            b.kind,
            techLevels[b.team].infantryProd,
          );
        }
      }

      for (let i = wreckBuildings.length - 1; i >= 0; i--) {
        wreckBuildings[i].wreckAge += dt;
        if (wreckBuildings[i].wreckAge >= CORPSE_LIFETIME_SEC) {
          wreckBuildings.splice(i, 1);
        }
      }

      if (!gameOver) {
        for (const t of turrets) updateTurret(t, dt);
        for (const u of units) updateAgent(u, dt);
        resolveUnitSeparation(dt);
        updateMissiles(dt);
      }

      for (const u of units) {
        if (!u.destroyed) continue;
        u.wreckAge += dt;
        if (u.wreckAge >= CORPSE_LIFETIME_SEC) u.expired = true;
      }
      for (let i = units.length - 1; i >= 0; i--) {
        if (units[i].expired) units.splice(i, 1);
      }

      checkEndConditions();
      return events.slice();
    },
    snapshot: takeSnapshot,
  };
}
