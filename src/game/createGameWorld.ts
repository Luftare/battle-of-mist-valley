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
  createResearchLab,
  createTurret,
  type BuildingHandle,
  type BuildingKind,
  type PlatformHandle,
  type ResearchLabHandle,
  type TurretHandle,
} from "../buildings";
import { createCaptureFlag } from "../buildings/captureFlag";
import type { CombatEntity } from "./combatEntity";
import { createHpBar, type HpBarHandle } from "./hpBar";
import { bypassAroundObstacle, clampToPlayfield, steerToward } from "./pathfinding";
import {
  PLAY_WIDTH,
  PLAY_DEPTH,
  TURRETS_PER_TEAM,
  TURRET_FORWARD_FROM_BASE,
  FLAG_CAPTURE_RADIUS,
  FLAG_COINS_PER_SEC,
  SLOT_COUNT,
  SPAWN_INTERVAL_SEC,
  FACTORY_SPAWN_INTERVAL_SEC,
  HELI_GUN_DAMAGE,
  HELI_GUN_RANGE,
  TANK_SPLASH_RADIUS,
  MISSILE_SPLASH_RADIUS,
  ACCURACY_AT_POINT_BLANK,
  ACCURACY_AT_MAX_RANGE,
  MISS_SCATTER_RADIUS,
  UNIT_STATS,
  BUILDING_COST,
  BUILDING_HP_BAR_HEIGHT,
  COINS_PER_SEC,
  STARTING_COINS,
  SUPPLY_TRUCK_COIN_INTERVAL_SEC,
  SUPPLY_TRUCK_COIN_AMOUNT,
  AI_DECISION_INTERVAL_SEC,
  TURRET_BOUNTY,
  TURRET_HP_BAR_HEIGHT,
  TURRET_SHOOT_RANGE,
  type UnitKind,
} from "./stats";
import { createAiBrain, type AiSlotView, type AiSnapshot } from "./aiStrategy";
import {
  createTeamTechLevels,
  INFANTRY_ACCURACY_MUL,
  INFANTRY_PROD_MUL,
  SUPPLY_SPEED_BONUS_PER_LEVEL,
  TANK_HP_MUL,
  TANK_SPLASH_MUL,
  TANK_FIRE_RATE_MUL,
  TURRET_RANGE_MUL,
  TURRET_REGEN_DELAY_SEC,
  TURRET_REGEN_HP_PER_SEC,
  UPGRADE_DEFS,
  UPGRADE_IDS,
  upgradeCost,
  type UpgradeId,
} from "./upgrades";
import { spawnExplosion } from "../fx/explosion";
import { spawnBulletTrace } from "../fx/bulletTrace";
import { createCoinPopupFx } from "../fx/coinPopup";
import { createTerrain } from "../terrain/createTerrain";
import { type Team } from "../theme/colors";
import {
  createHelicopter,
  createRifleman,
  createSupplyTruck,
  createTank,
  type UnitHandle,
} from "../units";
import { approach, shortestAngleDelta } from "../units/types";
import { createHud, type UpgradeCardState } from "../ui/hud";

/** Hull yaw rate (rad/s) — tanks turn in place before driving. */
const TANK_HULL_TURN_SPEED = 0.45;
/** Must be within this angle of the path before translating. */
const TANK_ALIGN_RAD = 0.2;
/** Extra personal space beyond body radii for unit–unit evasion. */
const UNIT_SEP_PADDING = 0.28;
/** How strongly neighbor repulsion bends movement steering. */
const UNIT_SEP_STEER = 1.35;
/** How fast hard overlaps are resolved (fraction of push per second). */
const UNIT_SEP_RESOLVE = 7;

const PLAYER_TEAM: Team = "blue";
const AI_TEAM: Team = "red";
const CLICK_DRAG_PX = 12;

export interface GameWorld {
  scene: Scene;
  setPaused: (paused: boolean) => void;
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
  hpBar: HpBarHandle | null;
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
  if (kind === "researchLab") return createResearchLab(scene, name, team);
  return createHelipad(scene, name, team);
}

function distXZ(a: Vector3, b: Vector3): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.hypot(dx, dz);
}

/** Linear accuracy: 100% at 0 range → 50% at maxRange. */
function rollAccuracy(
  distance: number,
  maxRange: number,
  accuracyMul = 1,
): boolean {
  const t =
    maxRange <= 1e-6 ? 0 : Math.min(1, Math.max(0, distance / maxRange));
  const base =
    ACCURACY_AT_POINT_BLANK +
    (ACCURACY_AT_MAX_RANGE - ACCURACY_AT_POINT_BLANK) * t;
  const accuracy = Math.min(1, base * accuracyMul);
  return Math.random() < accuracy;
}

/** Aim point offset when a shot misses (mostly lateral to the shot line). */
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

function spawnIntervalFor(kind: BuildingKind, infantryProdBonus = false): number {
  if (kind === "researchLab") return Infinity;
  if (kind === "barracks" && infantryProdBonus) {
    return SPAWN_INTERVAL_SEC / INFANTRY_PROD_MUL;
  }
  if (kind === "factory") return FACTORY_SPAWN_INTERVAL_SEC;
  return SPAWN_INTERVAL_SEC;
}

/**
 * Auto battler arena: empty platforms, build/collapse economy, supply trucks, AI.
 */
export function createGameWorld(engine: Engine, canvas: HTMLCanvasElement): GameWorld {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.55, 0.72, 0.88, 1);
  scene.ambientColor = new Color3(0.35, 0.4, 0.32);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(0.62, 0.75, 0.88);
  scene.fogStart = 30;
  scene.fogEnd = 50;

  const halfX = PLAY_WIDTH * 0.5;
  const halfZ = PLAY_DEPTH * 0.5;
  /** Base line along Z: blue south (−Z), red north (+Z). */
  const buildingZ = halfZ - 2.4;

  // Locked isometric view — drag pans the target; angle/zoom stay fixed
  // ~30° off pure south so own (blue) side is nearer the camera
  const CAM_ALPHA = Math.PI + Math.PI / 3;
  const CAM_BETA = 0.95;
  const CAM_RADIUS = 42;

  const camera = new ArcRotateCamera(
    "gameCamera",
    CAM_ALPHA,
    CAM_BETA,
    CAM_RADIUS,
    new Vector3(0, 0.4, 0),
    scene,
  );
  camera.lowerAlphaLimit = CAM_ALPHA;
  camera.upperAlphaLimit = CAM_ALPHA;
  camera.lowerBetaLimit = CAM_BETA;
  camera.upperBetaLimit = CAM_BETA;
  camera.lowerRadiusLimit = CAM_RADIUS;
  camera.upperRadiusLimit = CAM_RADIUS;
  camera.panningAxis = new Vector3(1, 0, 1);
  camera.mapPanning = true;
  camera.panningSensibility = 55;
  camera.panningInertia = 0.6;
  // Custom forward limit based on ally progress — no radial pan cap
  camera.panningDistanceLimit = 0;
  // Left-drag pans (no Ctrl / no orbit). Wheel zoom removed below.
  camera.attachControl(true, false, 0);
  camera.inputs.removeByType("ArcRotateCameraMouseWheelInput");
  camera.useInputToRestoreState = false;

  /**
   * Peek past ally front while dragging: logical overshoot is compressed with
   * an asymptotic curve toward CAM_PEEK_LIMIT (limit as x→∞, never reached).
   * Peeking enables follow mode; return-to-front runs after release.
   */
  const CAM_PEEK_LIMIT = 7.5;
  /** Ease rate back to the front after releasing a peek / forced retreat. */
  const CAM_RETURN_RATE = 4.0;
  /** When the front advances, catch the soft limit quickly. */
  const CAM_FRONT_ADVANCE_RATE = 10;
  /** When the front retreats (e.g. lead unit dies), ease the limit back. */
  const CAM_FRONT_RETREAT_RATE = 1.65;
  /** Smooth-damp time for follow catch-up (higher = gentler accel). */
  const CAM_FOLLOW_SMOOTH_TIME = 0.75;
  const CAM_FOLLOW_MAX_SPEED = 16;
  /** Ignore front dips smaller than this while following at the tip. */
  const CAM_FOLLOW_RETREAT_DEADZONE = 1.35;
  /** Peek past the front by this much to arm follow mode. */
  const CAM_PEEK_FOLLOW_ARM = 0.2;
  /** Backward pan (world −Z) past this disables follow. */
  const CAM_FOLLOW_CANCEL_DELTA = 0.04;
  const CAM_TARGET_Y = 0.4;
  const CAM_LIM_X = halfX - 2.2;
  const CAM_MIN_Z = -buildingZ - 2.5;
  /** Smoothed +Z pan limit — lags behind raw ally front on retreats. */
  let smoothedFrontZ = -buildingZ;
  /** Uncapped Z while peeking (null when synced to the displayed target). */
  let camLogicalZ: number | null = null;
  /** Last Z we wrote to the camera — used to measure pan input deltas. */
  let lastDisplayedZ = 0;
  /** After a peek, keep the camera tracking the lead until the player pans back. */
  let camFollow = false;
  let camFollowVel = 0;

  const hemi = new HemisphericLight("hemi", new Vector3(0.2, 1, 0.3), scene);
  hemi.intensity = 0.75;
  hemi.groundColor = new Color3(0.25, 0.28, 0.18);
  hemi.diffuse = new Color3(0.95, 0.95, 0.88);

  const sun = new DirectionalLight("sun", new Vector3(-0.45, -0.85, -0.3), scene);
  sun.position = new Vector3(12, 22, 10);
  sun.intensity = 0.85;
  sun.diffuse = new Color3(1, 0.97, 0.9);

  const terrain = createTerrain(scene, PLAY_WIDTH, PLAY_DEPTH);
  const captureFlag = createCaptureFlag(scene, terrain.getGroundYAt);
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

  interface ActiveResearch {
    id: UpgradeId;
    elapsed: number;
    duration: number;
  }

  const techLevels: Record<Team, Record<UpgradeId, number>> = {
    blue: createTeamTechLevels(),
    red: createTeamTechLevels(),
  };
  const activeResearch: Record<Team, ActiveResearch | null> = {
    blue: null,
    red: null,
  };
  /** Wall-clock of last damage taken — used for out-of-combat regen. */
  const turretLastHurt = new WeakMap<TurretHandle, number>();
  let researchModalOpen = false;

  let anyBuildingDestroyed = false;
  let gameOver = false;
  let elapsed = 0;
  let aiCooldown = AI_DECISION_INTERVAL_SEC * (0.25 + Math.random() * 0.35);
  const aiBrain = createAiBrain();
  if (typeof console !== "undefined") {
    console.info(`[AI] Strategy: ${aiBrain.label}`);
  }
  let flagCoinCooldown = 0;
  let selectedSlot: Slot | null = null;

  // 8 slots along each end (blue south / red north)
  const xMin = -halfX + 2.2;
  const xMax = halfX - 2.2;
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
        hpBar: null,
        spawnCooldown: 0,
      });
    }
  }

  // Three defensive turrets per team, spaced like CSS space-around (inset from edges)
  for (const team of ["blue", "red"] as const) {
    const zSign = team === "blue" ? -1 : 1;
    const tz = zSign * (buildingZ - TURRET_FORWARD_FROM_BASE);
    for (let i = 0; i < TURRETS_PER_TEAM; i++) {
      const t = (i + 0.5) / TURRETS_PER_TEAM;
      const tx = xMin + (xMax - xMin) * t;
      const label =
        i === 0 ? "W" : i === TURRETS_PER_TEAM - 1 ? "E" : `M${i}`;
      const turret = createTurret(scene, `${team}_turret_${label}`, team);
      turret.root.position.x = tx;
      turret.root.position.z = tz;
      turret.root.position.y = terrain.getGroundYAtFootprint(tx, tz, 2.1 * 0.5 * 0.9);
      turret.root.scaling.setAll(0.9);
      turrets.push(turret);

      const hpBar = createHpBar(scene, turret.root.name);
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

  function countBuildingsByKind(team: Team): Record<BuildingKind, number> {
    const counts: Record<BuildingKind, number> = {
      barracks: 0,
      depot: 0,
      factory: 0,
      helipad: 0,
      researchLab: 0,
    };
    for (const b of livingBuildings(team)) {
      counts[b.kind] += 1;
    }
    return counts;
  }

  function teamHasLab(team: Team): boolean {
    return livingBuildings(team).some(
      (b) => b.kind === "researchLab" && !b.constructing,
    );
  }

  function getUpgradeCards(team: Team): UpgradeCardState[] {
    const levels = techLevels[team];
    const active = activeResearch[team];
    return UPGRADE_IDS.map((id) => {
      const def = UPGRADE_DEFS[id];
      const level = levels[id];
      const researching = active?.id === id;
      return {
        id,
        level,
        maxLevel: def.maxLevel,
        cost: upgradeCost(def, level),
        progress: researching && active ? active.elapsed / active.duration : null,
        researching,
        blocked: active !== null && !researching,
      };
    });
  }

  function syncLabVisuals(team: Team): void {
    const active = activeResearch[team];
    const progress = active ? active.elapsed / active.duration : 0;
    for (const slot of slots) {
      if (slot.team !== team || slot.building?.kind !== "researchLab") continue;
      const lab = slot.building as ResearchLabHandle;
      if (lab.destroyed) continue;
      lab.setResearching(!!active, progress);
    }
  }

  function tankFireRateHz(team: Team): number {
    const base = UNIT_STATS.tank.fireRateHz;
    return techLevels[team].tankFireRate > 0 ? base * TANK_FIRE_RATE_MUL : base;
  }

  function applyUpgradeEffect(team: Team, id: UpgradeId): void {
    if (id === "heliMissiles") {
      for (const agent of agents) {
        if (agent.unit.team === team && agent.unit.kind === "helicopter") {
          agent.unit.setMissilesEnabled(true);
        }
      }
    }
    if (id === "turretRange") {
      for (const turret of turrets) {
        if (turret.team === team && !turret.destroyed) {
          turret.shootRange = TURRET_SHOOT_RANGE * TURRET_RANGE_MUL;
        }
      }
    }
    if (id === "tankHp") {
      for (const agent of agents) {
        if (
          agent.unit.team === team &&
          agent.unit.kind === "tank" &&
          !agent.unit.destroyed
        ) {
          agent.unit.applyMaxHpBonus(TANK_HP_MUL);
        }
      }
    }
    if (id === "tankFireRate") {
      for (const agent of agents) {
        if (
          agent.unit.team === team &&
          agent.unit.kind === "tank" &&
          !agent.unit.destroyed
        ) {
          agent.unit.fireRateHz = tankFireRateHz(team);
        }
      }
    }
  }

  function completeResearch(team: Team, id: UpgradeId): void {
    techLevels[team][id] += 1;
    activeResearch[team] = null;
    applyUpgradeEffect(team, id);
    syncLabVisuals(team);
    if (team === PLAYER_TEAM) {
      hud.showUpgradeToast(UPGRADE_DEFS[id].label);
      if (researchModalOpen) {
        hud.refreshResearchModal(coins[PLAYER_TEAM], getUpgradeCards(PLAYER_TEAM));
      }
    }
  }

  function beginResearch(team: Team, id: UpgradeId): boolean {
    if (activeResearch[team]) return false;
    if (!teamHasLab(team)) return false;
    const def = UPGRADE_DEFS[id];
    const level = techLevels[team][id];
    if (level >= def.maxLevel) return false;
    const cost = upgradeCost(def, level);
    if (!trySpend(team, cost)) return false;
    activeResearch[team] = {
      id,
      elapsed: 0,
      duration: def.durationSec,
    };
    syncLabVisuals(team);
    if (team === PLAYER_TEAM && researchModalOpen) {
      hud.refreshResearchModal(coins[PLAYER_TEAM], getUpgradeCards(PLAYER_TEAM));
    }
    return true;
  }

  function tickResearch(team: Team, dt: number): void {
    const active = activeResearch[team];
    if (!active) {
      syncLabVisuals(team);
      if (team === PLAYER_TEAM && researchModalOpen) {
        hud.refreshResearchModal(coins[PLAYER_TEAM], getUpgradeCards(PLAYER_TEAM));
      }
      return;
    }
    if (!teamHasLab(team)) {
      // Pause while no lab stands — progress is kept
      syncLabVisuals(team);
      return;
    }
    active.elapsed += dt;
    syncLabVisuals(team);
    if (team === PLAYER_TEAM && researchModalOpen) {
      hud.refreshResearchModal(coins[PLAYER_TEAM], getUpgradeCards(PLAYER_TEAM));
    }
    if (active.elapsed >= active.duration) {
      completeResearch(team, active.id);
    }
  }

  function addCoins(
    team: Team,
    amount: number,
    opts?: {
      world?: Vector3;
      popup?: boolean;
      /** Keep the popup anchored over a moving unit while it rises. */
      follow?: () => Vector3;
    },
  ): void {
    coins[team] += amount;
    if (team === PLAYER_TEAM) hud.setCoins(coins[PLAYER_TEAM]);
    // Only the player sees floating coin numbers
    if (
      team === PLAYER_TEAM &&
      opts?.popup &&
      (opts.follow || opts.world)
    ) {
      coinFx.spawn(opts.world ?? opts.follow!(), amount, {
        follow: opts.follow,
      });
    }
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
    if (slot.building?.expired) clearExpiredBuilding(slot);
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
    const hpBar = createHpBar(scene, building.root.name);
    hpBar.setRatio(1);
    slot.hpBar = hpBar;
    slot.spawnCooldown = 2.5 + Math.random() * 1.5;
    slot.platform.setSiteVisible(false);
    return true;
  }

  // Both sides start with empty platforms — player/AI choose what to build

  function collapseBuilding(slot: Slot): boolean {
    const b = slot.building;
    if (!b || b.destroyed || b.collapsing) return false;
    if (livingBuildings(slot.team).length <= 1) return false;
    b.beginCollapse();
    return true;
  }

  function clearExpiredBuilding(slot: Slot): void {
    if (!slot.building?.expired) return;
    slot.hpBar?.dispose();
    slot.hpBar = null;
    slot.building.dispose();
    slot.building = null;
    slot.spawnCooldown = 0;
    slot.platform.setSiteVisible(true);
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

      const maxRange = engageRange(unit, target);
      const accuracyMul =
        unit.kind === "rifleman" && techLevels[unit.team].infantryAccuracy > 0
          ? INFANTRY_ACCURACY_MUL
          : 1;
      const didHit = rollAccuracy(distXZ(from, hit), maxRange, accuracyMul);
      const impactAt = didHit ? hit : scatterAim(from, hit);

      if (isTankShell) {
        // Misses still detonate as splash AOE (no guaranteed primary hit)
        const splash =
          techLevels[unit.team].tankSplash > 0
            ? TANK_SPLASH_RADIUS * TANK_SPLASH_MUL
            : TANK_SPLASH_RADIUS;
        const heavy = splash > TANK_SPLASH_RADIUS;
        spawnExplosion(scene, impactAt, {
          scale: heavy ? 1.85 : 1.15,
          duration: 0.55,
        });
        applyArealHit(
          impactAt,
          didHit ? target : null,
          damage,
          splash,
          unit.team,
          {
            impactFromX: from.x,
            impactFromZ: from.z,
            impactStrength: heavy ? 14 : 8.5,
          },
        );
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

      markAttacker(target, unit.team);
      const wasAlive = !target.destroyed;
      target.takeDamage(damage);
      if (wasAlive && target.destroyed && isTurret(target)) {
        awardTurretBounty(target);
      }
    });

    unit.setOnMissileHit((target, hit) => {
      // Guided missiles always hit
      spawnExplosion(scene, hit, { scale: 1.55, duration: 0.7 });
      applyArealHit(hit, target, unit.damage, MISSILE_SPLASH_RADIUS, unit.team);
    });
  }

  function isTurret(entity: CombatEntity): entity is TurretHandle {
    return "kind" in entity && (entity as TurretHandle).kind === "turret";
  }

  function wireTurretCombat(turret: TurretHandle): void {
    const rawTakeDamage = turret.takeDamage.bind(turret);
    turret.takeDamage = (amount) => {
      if (amount > 0) turretLastHurt.set(turret, elapsed);
      rawTakeDamage(amount);
    };
    turret.setOnFire(() => {
      const target = findTurretFocus(turret);
      if (!target || target.destroyed) return;
      const hit = target.getHitPoint();
      const from = turret.root.position;
      const didHit = rollAccuracy(distXZ(from, hit), turret.shootRange);
      const impactAt = didHit ? hit : scatterAim(from, hit);
      spawnBulletTrace(scene, turret.getMuzzlePoint().clone(), impactAt, {
        speed: 62,
        length: 1.35,
        thickness: 0.075,
        color: "#fff4b8",
      });
      if (!didHit) return;
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
    mainTarget: CombatEntity | null,
    baseDamage: number,
    radius: number,
    attackerTeam: Team,
    impact?: { impactFromX: number; impactFromZ: number; impactStrength: number },
  ): void {
    const hitEntity = (entity: CombatEntity, x: number, z: number) => {
      if (entity.destroyed || entity.team === attackerTeam) return;
      const isMain = mainTarget !== null && entity === mainTarget;
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

  function spawnFrom(slot: Slot): void {
    const b = slot.building;
    if (!b || b.destroyed) return;
    if (!b.spawns) return;

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
    unit.root.position.y = terrain.getGroundYAt(spawnX, spawnZ);
    unit.root.rotation.y = towardEnemy > 0 ? 0 : Math.PI;
    unit.root.scaling.setAll(0.8);
    unit.fireRateHz =
      kind === "tank" ? tankFireRateHz(b.team) : UNIT_STATS[kind].fireRateHz;

    if (kind === "tank" && techLevels[b.team].tankHp > 0) {
      unit.applyMaxHpBonus(TANK_HP_MUL);
    }
    if (kind === "helicopter" && techLevels[b.team].heliMissiles > 0) {
      unit.setMissilesEnabled(true);
    }

    const hpBar = createHpBar(scene, unit.root.name);
    hpBar.setRatio(1);

    const supplyRate =
      1 + SUPPLY_SPEED_BONUS_PER_LEVEL * techLevels[b.team].supplySpeed;
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
      coinCooldown:
        (SUPPLY_TRUCK_COIN_INTERVAL_SEC / supplyRate) *
        (0.4 + Math.random() * 0.6),
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
      const useMissile =
        techLevels[attacker.team].heliMissiles > 0 &&
        "kind" in target &&
        ((target as UnitHandle).kind === "tank" ||
          (target as UnitHandle).kind === "supplyTruck");
      return useMissile ? attacker.shootRange : HELI_GUN_RANGE;
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

  /** True when this agent is in range and aiming/locking the victim (actively shooting). */
  function isEngagingVictim(attacker: Agent, victim: UnitHandle): boolean {
    if (attacker.unit.destroyed) return false;
    if (attacker.lockedUnit !== victim && attacker.focus !== victim) return false;
    return (
      distXZ(attacker.unit.root.position, victim.root.position) <=
      engageRange(attacker.unit, victim)
    );
  }

  /**
   * Closest enemy unit currently shooting at `victim`.
   * Used so we drop chase targets and answer fire.
   */
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

  /** True when an enemy unit has this turret locked as its combat focus. */
  function isEnemyTargetingTurret(turret: TurretHandle): boolean {
    for (const agent of agents) {
      if (agent.unit.destroyed || agent.unit.team === turret.team) continue;
      if (agent.focus === turret) return true;
    }
    return false;
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

  /** Nearest living enemy structure (built slot or map turret) for base assault. */
  function findClosestEnemyStructure(unit: UnitHandle): CombatEntity | null {
    const pos = unit.root.position;
    let best: CombatEntity | null = null;
    let bestDist = Infinity;
    for (const slot of slots) {
      const b = slot.building;
      if (!b || b.destroyed || b.team === unit.team) continue;
      const d = distXZ(pos, b.root.position);
      if (d < bestDist) {
        bestDist = d;
        best = b;
      }
    }
    for (const turret of turrets) {
      if (turret.destroyed || turret.team === unit.team) continue;
      const d = distXZ(pos, turret.root.position);
      if (d < bestDist) {
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

  function bodyRadius(unit: UnitHandle): number {
    return UNIT_STATS[unit.kind as UnitKind]?.radius ?? 0.4;
  }

  function sameMoveLayer(a: UnitHandle, b: UnitHandle): boolean {
    return (a.kind === "helicopter") === (b.kind === "helicopter");
  }

  /** Soft repulsion from nearby units (steering blend). */
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

  /**
   * Resolve overlaps after all agents move — keeps idle combat clumps from stacking.
   */
  function resolveUnitSeparation(dt: number): void {
    const n = agents.length;
    if (n < 2) return;
    const pushX = new Float64Array(n);
    const pushZ = new Float64Array(n);

    for (let i = 0; i < n; i++) {
      const a = agents[i].unit;
      if (a.destroyed) continue;
      const ra = bodyRadius(a);
      const ax = a.root.position.x;
      const az = a.root.position.z;
      for (let j = i + 1; j < n; j++) {
        const b = agents[j].unit;
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
      const unit = agents[i].unit;
      if (unit.destroyed) continue;
      const px = pushX[i];
      const pz = pushZ[i];
      if (px * px + pz * pz < 1e-8) continue;
      const next = clampToPlayfield(
        unit.root.position.x + px * rate,
        unit.root.position.z + pz * rate,
        halfX,
        halfZ,
        1.4,
      );
      unit.root.position.x = next.x;
      unit.root.position.z = next.z;
    }
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
          : bodyRadius(unit);
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
        agent.bypass = clampToPlayfield(bypass.x, bypass.z, halfX, halfZ, 1.4);
        agent.stuckTimer = 0;
      }
    }

    let dir = steerToward(from, steerGoal, obstacles, {
      arriveDist: agent.bypass ? 0.55 : 0.45,
      agentRadius,
    });

    const sep = neighborSeparation(agent);
    const sepLen = Math.hypot(sep.x, sep.z);
    if (sepLen > 1e-4) {
      if (!dir) {
        // Arrived at goal but crowded — still sidestep
        dir = { x: sep.x / sepLen, z: sep.z / sepLen };
      } else {
        dir = {
          x: dir.x + sep.x * UNIT_SEP_STEER,
          z: dir.z + sep.z * UNIT_SEP_STEER,
        };
        const len = Math.hypot(dir.x, dir.z);
        if (len > 1e-5) {
          dir = { x: dir.x / len, z: dir.z / len };
        }
      }
    }

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
        halfX,
        halfZ,
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
      halfX,
      halfZ,
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

    // Supply trucks: advance + mint coins, never fight — despawn on arrival
    if (unit.kind === "supplyTruck") {
      agent.coinCooldown -= dt;
      if (agent.coinCooldown <= 0) {
        const supplyRate =
          1 + SUPPLY_SPEED_BONUS_PER_LEVEL * techLevels[unit.team].supplySpeed;
        agent.coinCooldown = SUPPLY_TRUCK_COIN_INTERVAL_SEC / supplyRate;
        addCoins(unit.team, SUPPLY_TRUCK_COIN_AMOUNT, {
          world: unit.root.position.clone(),
          popup: true,
          follow: () => unit.root.getAbsolutePosition(),
        });
      }

      if (agent.arrived || !agent.moveTarget) {
        unit.setMoving(false);
        unit.destroy();
        agent.hpBar.setVisible(false);
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
        agent.moveTarget = null;
        unit.setMoving(false);
        unit.destroy();
        agent.hpBar.setVisible(false);
      }
      return;
    }

    if (agent.lockedUnit?.destroyed) {
      agent.lockedUnit = null;
    }

    // Prefer enemies actively shooting us over a passive / out-of-reach chase target
    const attacker = findEnemyEngaging(unit);
    if (attacker) {
      const locked = agent.lockedUnit;
      const lockedAgent = locked
        ? agents.find((a) => a.unit === locked)
        : undefined;
      const lockedFightsUs = lockedAgent
        ? isEngagingVictim(lockedAgent, unit)
        : false;
      if (!locked || locked === attacker || !lockedFightsUs) {
        if (locked !== attacker) {
          agent.lockedUnit = attacker;
          agent.bypass = null;
          agent.stuckTimer = 0;
        }
      }
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

    // At the enemy base: siege the closest living building or turret until none remain
    if (agent.arrived) {
      const siege = findClosestEnemyStructure(unit);
      if (siege) {
        agent.focus = siege;
        const d = distXZ(unit.root.position, siege.root.position);
        if (d <= engageRange(unit, siege)) {
          unit.setCombat(true);
          unit.setAimTarget(siege);
          unit.setMoving(false);
          agent.bypass = null;
          faceTarget(unit, siege, dt);
        } else {
          unit.setCombat(false);
          unit.setAimTarget(null);
          moveToward(
            agent,
            { x: siege.root.position.x, z: siege.root.position.z },
            dt,
          );
        }
        return;
      }
      agent.focus = null;
      unit.setCombat(false);
      unit.setAimTarget(null);
      unit.setMoving(false);
      return;
    }

    // En route: shoot buildings/turrets already in range, else keep marching
    const building = findBuildingInRange(unit);
    if (building) {
      agent.focus = building;
      unit.setCombat(true);
      unit.setAimTarget(building);
      unit.setMoving(false);
      agent.bypass = null;
      faceTarget(unit, building, dt);
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
      !agent.bypass &&
      Math.hypot(
        unit.root.position.x - agent.moveTarget.x,
        unit.root.position.z - agent.moveTarget.z,
      ) < 0.5
    ) {
      agent.arrived = true;
      agent.moveTarget = null;
      unit.setMoving(false);
    }
  }

  function buildAiSnapshot(): AiSnapshot {
    const empty: AiSlotView[] = [];
    const occupied: AiSlotView[] = [];
    for (const slot of slots) {
      if (slot.team !== AI_TEAM) continue;
      const b = slot.building;
      // Pad is free only when empty or fully expired
      if (!b || b.expired) {
        empty.push({ index: slot.index, x: slot.x, kind: null, canCollapse: false });
        continue;
      }
      // Destroyed / collapsing wreck still occupies the pad
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
    // Think faster when sitting on unspent coins or open pads
    const rich = coins[AI_TEAM] >= 120;
    const openPads = slots.some(
      (s) => s.team === AI_TEAM && (!s.building || s.building.expired),
    );
    const base = rich && openPads ? 4.5 : rich ? 6 : AI_DECISION_INTERVAL_SEC;
    return base * (0.75 + Math.random() * 0.5);
  }

  function runAiDecision(): void {
    if (gameOver) return;

    // Spend aggressively: take several actions per tick while we can
    const maxActions = coins[AI_TEAM] > 200 ? 3 : coins[AI_TEAM] > 100 ? 2 : 1;
    for (let n = 0; n < maxActions; n++) {
      const snap = buildAiSnapshot();
      const action = aiBrain.decide(snap);
      if (action.type === "noop") break;

      if (action.type === "research") {
        if (!beginResearch(AI_TEAM, action.id)) break;
        continue;
      }

      if (action.type === "build") {
        const slot = slots.find(
          (s) => s.team === AI_TEAM && s.index === action.slotIndex,
        );
        if (!slot) break;
        if (!placeBuilding(slot, action.kind)) break;
        continue;
      }

      if (action.type === "collapse") {
        const slot = slots.find(
          (s) => s.team === AI_TEAM && s.index === action.slotIndex,
        );
        if (!slot || !collapseBuilding(slot)) break;
        // Collapse frees the pad only after teardown — pending rebuild handled by brain
        break;
      }
    }
  }

  function checkEndConditions(): void {
    if (gameOver || !anyBuildingDestroyed) return;

    // Structures only — leftover units do not keep a team alive
    const enemyDead = livingBuildings(AI_TEAM).length === 0;
    const playerDead = livingBuildings(PLAYER_TEAM).length === 0;

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
    researchModalOpen =
      occupied === "researchLab" && !slot.building!.constructing;

    hud.openBuildModal({
      coins: coins[PLAYER_TEAM],
      occupied,
      canCollapse: occupied !== null && livingBuildings(PLAYER_TEAM).length > 1,
      upgrades: researchModalOpen ? getUpgradeCards(PLAYER_TEAM) : undefined,
      onBuild: (kind) => {
        placeBuilding(slot, kind);
        slot.platform.setHighlight(false);
        selectedSlot = null;
        researchModalOpen = false;
      },
      onResearch: (id) => {
        beginResearch(PLAYER_TEAM, id);
      },
      onCollapse: () => {
        collapseBuilding(slot);
        slot.platform.setHighlight(false);
        selectedSlot = null;
        researchModalOpen = false;
      },
      onClose: () => {
        slot.platform.setHighlight(false);
        selectedSlot = null;
        researchModalOpen = false;
      },
    });
  }

  // Click vs drag on platforms + camera pan tracking
  let pointerDown: { x: number; y: number } | null = null;
  let camDragging = false;

  /**
   * Furthest ally progress toward the enemy (+Z for blue).
   * Empty pads count so the home line is always reachable.
   */
  function allyFrontZ(): number {
    let front = -buildingZ;
    for (const slot of slots) {
      if (slot.team !== PLAYER_TEAM) continue;
      front = Math.max(front, slot.z);
      const b = slot.building;
      if (b && !b.destroyed) {
        front = Math.max(front, b.root.position.z);
      }
    }
    for (const turret of turrets) {
      if (turret.team !== PLAYER_TEAM || turret.destroyed) continue;
      front = Math.max(front, turret.root.position.z);
    }
    for (const agent of agents) {
      if (agent.unit.team !== PLAYER_TEAM || agent.unit.destroyed) continue;
      front = Math.max(front, agent.unit.root.position.z);
    }
    return front;
  }

  /** Map uncapped overshoot → (0, CAM_PEEK_LIMIT) — approaches but never hits. */
  function asymptotePeek(rawOvershoot: number): number {
    if (rawOvershoot <= 0) return 0;
    return (CAM_PEEK_LIMIT * rawOvershoot) / (rawOvershoot + CAM_PEEK_LIMIT);
  }

  /** Inverse of asymptotePeek for seeding logical Z from a displayed peek. */
  function invertAsymptotePeek(displayedOvershoot: number): number {
    if (displayedOvershoot <= 0) return 0;
    const d = Math.min(displayedOvershoot, CAM_PEEK_LIMIT * 0.999);
    return (CAM_PEEK_LIMIT * d) / (CAM_PEEK_LIMIT - d);
  }

  /** Critically-damped chase — gentle accel without jitter on small target noise. */
  function smoothDampZ(
    current: number,
    target: number,
    smoothTime: number,
    maxSpeed: number,
    dt: number,
  ): number {
    const st = Math.max(0.0001, smoothTime);
    const omega = 2 / st;
    const x = omega * dt;
    const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
    let change = current - target;
    const maxChange = maxSpeed * st;
    change = Math.max(-maxChange, Math.min(maxChange, change));
    const temp = (camFollowVel + omega * change) * dt;
    camFollowVel = (camFollowVel - omega * temp) * exp;
    let output = current - change + (change + temp) * exp;
    if (target - current > 0 === output > target) {
      output = target;
      camFollowVel = 0;
    }
    return output;
  }

  /**
   * Soft +Z pan limit from ally front.
   * Peeking remaps through an asymptotic curve and arms follow mode.
   * Follow gently tracks the lead forward; backward drag cancels it.
   */
  function updateCameraBounds(dt: number): void {
    const rawFront = allyFrontZ();
    const frontRate =
      rawFront >= smoothedFrontZ ? CAM_FRONT_ADVANCE_RATE : CAM_FRONT_RETREAT_RATE;
    smoothedFrontZ += (rawFront - smoothedFrontZ) * (1 - Math.exp(-frontRate * dt));
    const softMaxZ = smoothedFrontZ;

    let x = camera.target.x;
    let z = camera.target.z;
    x = Math.max(-CAM_LIM_X, Math.min(CAM_LIM_X, x));

    if (camDragging) {
      const inputDelta = z - lastDisplayedZ;
      if (camLogicalZ === null) {
        if (z > softMaxZ) {
          camLogicalZ = softMaxZ + invertAsymptotePeek(z - softMaxZ);
        } else {
          camLogicalZ = z;
        }
      } else {
        camLogicalZ += inputDelta;
      }
      camLogicalZ = Math.max(CAM_MIN_Z, camLogicalZ);

      // Dragging homeward leaves the camera where the player put it
      if (inputDelta < -CAM_FOLLOW_CANCEL_DELTA) {
        camFollow = false;
        camFollowVel = 0;
      }

      if (camLogicalZ > softMaxZ) {
        const rawOver = camLogicalZ - softMaxZ;
        z = softMaxZ + asymptotePeek(rawOver);
        if (asymptotePeek(rawOver) >= CAM_PEEK_FOLLOW_ARM) {
          camFollow = true;
        }
        const t = asymptotePeek(rawOver) / CAM_PEEK_LIMIT;
        const keep = Math.max(0.04, 1 - t * t);
        camera.inertialPanningX *= keep;
        camera.inertialPanningY *= keep;
      } else {
        z = camLogicalZ;
      }
    } else {
      camLogicalZ = null;
      z = Math.max(CAM_MIN_Z, z);

      if (z > softMaxZ) {
        const overshoot = z - softMaxZ;
        // While following, ignore tiny lead pushbacks; big collapses still pull back
        const holdThroughDip =
          camFollow && overshoot <= CAM_FOLLOW_RETREAT_DEADZONE;
        if (holdThroughDip) {
          camFollowVel = 0;
          camera.inertialPanningX = 0;
          camera.inertialPanningY = 0;
        } else {
          z = softMaxZ + overshoot * Math.exp(-CAM_RETURN_RATE * dt);
          camera.inertialPanningX = 0;
          camera.inertialPanningY = 0;
          camFollowVel = 0;
        }
      } else if (camFollow) {
        if (softMaxZ > z + 0.04) {
          // Lead is forward — ease the view up with gentle acceleration
          z = smoothDampZ(
            z,
            softMaxZ,
            CAM_FOLLOW_SMOOTH_TIME,
            CAM_FOLLOW_MAX_SPEED,
            dt,
          );
        } else {
          camFollowVel *= Math.exp(-6 * dt);
        }
      }
    }

    camera.target.x = x;
    camera.target.y = CAM_TARGET_Y;
    camera.target.z = z;
    lastDisplayedZ = z;
  }

  const onPointerDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    pointerDown = { x: e.clientX, y: e.clientY };
    camDragging = false;
  };
  const onPointerMove = (e: PointerEvent) => {
    if (!pointerDown || (e.buttons & 1) === 0) return;
    const dx = e.clientX - pointerDown.x;
    const dy = e.clientY - pointerDown.y;
    if (dx * dx + dy * dy > CLICK_DRAG_PX * CLICK_DRAG_PX) {
      camDragging = true;
    }
  };
  const onPointerUp = (e: PointerEvent) => {
    if (e.button !== 0) return;
    const wasDragging = camDragging;
    const down = pointerDown;
    pointerDown = null;
    camDragging = false;
    if (!down) return;
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (wasDragging || dx * dx + dy * dy > CLICK_DRAG_PX * CLICK_DRAG_PX) {
      // Released after a pan — rubberband runs in updateCameraBounds
      return;
    }
    if (gameOver) return;

    const pick = scene.pick(scene.pointerX, scene.pointerY, (mesh) =>
      pickToSlot.has(mesh.uniqueId),
    );
    if (!pick?.hit || !pick.pickedMesh) return;
    const slot = pickToSlot.get(pick.pickedMesh.uniqueId);
    if (slot) openSlotModal(slot);
  };
  const onPointerCancel = () => {
    pointerDown = null;
    camDragging = false;
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerCancel);
  window.addEventListener("pointerup", onPointerUp);

  for (const turret of turrets) wireTurretCombat(turret);

  const notedDestroyedBuildings = new WeakSet<BuildingHandle>();
  function noteBuildingDeath(building: BuildingHandle): void {
    if (notedDestroyedBuildings.has(building)) return;
    notedDestroyedBuildings.add(building);
    anyBuildingDestroyed = true;
  }

  function updateTurret(turret: TurretHandle, hpBar: HpBarHandle, dt: number): void {
    if (turret.destroyed) {
      turret.setAimTarget(null);
      turretAim.set(turret, null);
      hpBar.setVisible(false);
      // Bounty may already have been awarded on the killing blow
      if (turret.lastAttackerTeam) awardTurretBounty(turret);
      return;
    }

    let focus = turretAim.get(turret) ?? null;
    if (focus?.destroyed) focus = null;
    if (focus) {
      const d = distXZ(turret.root.position, focus.root.position);
      if (d > turret.shootRange) focus = null;
    }
    if (!focus) focus = acquireTurretTarget(turret);
    turretAim.set(turret, focus);
    turret.setAimTarget(focus);

    // Auto-Repair Nanites: heal when no enemy is targeting this turret
    if (
      techLevels[turret.team].turretRegen > 0 &&
      turret.hp < turret.maxHp &&
      !isEnemyTargetingTurret(turret)
    ) {
      const lastHurt = turretLastHurt.get(turret) ?? -999;
      if (elapsed - lastHurt >= TURRET_REGEN_DELAY_SEC) {
        turret.heal(TURRET_REGEN_HP_PER_SEC * dt);
      }
    }

    hpBar.setRatio(turret.hp / turret.maxHp);
    hpBar.update(
      turret.root.getAbsolutePosition(),
      TURRET_HP_BAR_HEIGHT,
      camera.globalPosition,
    );
  }

  // `elapsed` is declared near AI setup so snapshots can read match time
  let paused = false;
  scene.onBeforeRenderObservable.add(() => {
    const dt = Math.min(0.05, engine.getDeltaTime() / 1000);
    if (paused) {
      // Meadow + empty pads keep a little life under the tip overlay
      terrain.update(dt, elapsed);
      for (const slot of slots) slot.platform.update(dt, elapsed);
      return;
    }
    elapsed += dt;
    terrain.update(dt, elapsed);
    hud.update(dt);
    updateCameraBounds(dt);

    if (!gameOver) {
      // Passive income — HUD tweens; no floating +N
      addCoins(PLAYER_TEAM, COINS_PER_SEC * dt);
      addCoins(AI_TEAM, COINS_PER_SEC * dt);

      // Hill flag capture: sole-team presence → team color + 2 coins/sec
      let playerInRange = false;
      let aiInRange = false;
      for (const agent of agents) {
        if (agent.unit.destroyed) continue;
        const dx = agent.unit.root.position.x;
        const dz = agent.unit.root.position.z;
        if (dx * dx + dz * dz > FLAG_CAPTURE_RADIUS * FLAG_CAPTURE_RADIUS) continue;
        if (agent.unit.team === PLAYER_TEAM) playerInRange = true;
        else aiInRange = true;
        if (playerInRange && aiInRange) break;
      }
      let flagOwner: Team | null = null;
      if (playerInRange && !aiInRange) flagOwner = PLAYER_TEAM;
      else if (aiInRange && !playerInRange) flagOwner = AI_TEAM;
      captureFlag.setOwner(flagOwner);
      if (flagOwner) {
        flagCoinCooldown -= dt;
        if (flagCoinCooldown <= 0) {
          flagCoinCooldown = 1;
          const flagPos = captureFlag.root.getAbsolutePosition();
          addCoins(flagOwner, FLAG_COINS_PER_SEC, {
            world: flagPos.clone(),
            popup: true,
            follow: () => captureFlag.root.getAbsolutePosition(),
          });
        }
      } else {
        flagCoinCooldown = 0;
      }

      aiCooldown -= dt;
      if (aiCooldown <= 0) {
        runAiDecision();
        aiCooldown = nextAiCooldown();
      }

      tickResearch(PLAYER_TEAM, dt);
      tickResearch(AI_TEAM, dt);
    }

    captureFlag.update(dt, elapsed);

    for (const slot of slots) {
      slot.platform.update(dt, elapsed);
      const b = slot.building;
      if (!b) continue;
      b.update(dt, elapsed);
      if (b.expired) {
        clearExpiredBuilding(slot);
        continue;
      }
      if (b.destroyed) {
        noteBuildingDeath(b);
        slot.hpBar?.setVisible(false);
        continue;
      }
      if (slot.hpBar) {
        slot.hpBar.setVisible(true);
        slot.hpBar.setRatio(b.hp / b.maxHp);
        slot.hpBar.update(
          b.root.getAbsolutePosition(),
          BUILDING_HP_BAR_HEIGHT,
          camera.globalPosition,
        );
      }
      if (gameOver) continue;
      if (b.constructing) continue;
      if (b.kind === "researchLab") continue;
      slot.spawnCooldown -= dt;
      if (slot.spawnCooldown <= 0) {
        spawnFrom(slot);
        slot.spawnCooldown = spawnIntervalFor(
          b.kind,
          techLevels[b.team].infantryProd > 0,
        );
      }
    }

    if (gameOver) {
      // Freeze living combatants — no moves, aims, or shots
      for (const agent of agents) {
        const unit = agent.unit;
        if (unit.destroyed) {
          agent.hpBar.setVisible(false);
          continue;
        }
        unit.setCombat(false);
        unit.setMoving(false);
        unit.setAimTarget(null);
        agent.lockedUnit = null;
        agent.focus = null;
        agent.hpBar.setRatio(unit.hp / unit.maxHp);
        agent.hpBar.update(
          unit.root.getAbsolutePosition(),
          UNIT_STATS[unit.kind as UnitKind].hpBarHeight,
          camera.globalPosition,
        );
      }
      for (let i = 0; i < turrets.length; i++) {
        const turret = turrets[i];
        const hpBar = turretHpBars[i];
        if (turret.destroyed) {
          turret.setAimTarget(null);
          hpBar.setVisible(false);
          continue;
        }
        turret.setAimTarget(null);
        turretAim.set(turret, null);
        hpBar.setRatio(turret.hp / turret.maxHp);
        hpBar.update(
          turret.root.getAbsolutePosition(),
          TURRET_HP_BAR_HEIGHT,
          camera.globalPosition,
        );
      }
    } else {
      for (let i = 0; i < turrets.length; i++) {
        updateTurret(turrets[i], turretHpBars[i], dt);
        turrets[i].update(dt, elapsed);
      }

      for (const agent of agents) {
        updateAgent(agent, dt);
      }
      resolveUnitSeparation(dt);
    }

    for (const agent of agents) agent.unit.update(dt, elapsed);
    if (gameOver) {
      // Keep wreck sinks / smoke going without combat AI
      for (const turret of turrets) turret.update(dt, elapsed);
    }

    // Keep living units seated on the low-poly ground facets
    const tiltSpeed = 2.8; // rad/s — ease across facet edges
    for (const agent of agents) {
      const unit = agent.unit;
      if (unit.destroyed) continue;
      const { x, z } = unit.root.position;
      unit.root.position.y = terrain.getGroundYAt(x, z);
      if (unit.kind === "tank" || unit.kind === "supplyTruck") {
        const tilt = terrain.getGroundTiltAt(x, z, unit.root.rotation.y);
        const maxStep = tiltSpeed * dt;
        unit.root.rotation.x = approach(unit.root.rotation.x, tilt.pitch, maxStep);
        unit.root.rotation.z = approach(unit.root.rotation.z, tilt.roll, maxStep);
      }
    }

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
    setPaused: (value: boolean) => {
      paused = value;
    },
    dispose: () => {
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("pointerup", onPointerUp);
      hud.dispose();
      coinFx.dispose();
      captureFlag.dispose();
      for (const agent of agents) {
        agent.hpBar.dispose();
        agent.unit.dispose();
      }
      for (const slot of slots) {
        slot.hpBar?.dispose();
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
