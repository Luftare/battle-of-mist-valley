import { Scene, Vector3, type ArcRotateCamera } from "@babylonjs/core";
import {
  createBarracks,
  createDepot,
  createFactory,
  createHelipad,
  createResearchLab,
  type BuildingHandle,
  type BuildingKind,
  type ResearchLabHandle,
  type TurretHandle,
} from "../buildings";
import { createHpBar, type HpBarHandle } from "./hpBar";
import {
  BUILDING_HP_BAR_HEIGHT,
  TURRET_HP_BAR_HEIGHT,
  UNIT_STATS,
  type UnitKind,
} from "./stats";
import {
  UPGRADE_DEFS,
  UPGRADE_IDS,
  upgradeCost,
  type UpgradeId,
} from "./upgrades";
import { spawnExplosion } from "../fx/explosion";
import { spawnBulletTrace } from "../fx/bulletTrace";
import { createMissile, type MissileHandle } from "../fx/missile";
import type { CoinPopupFx } from "../fx/coinPopup";
import type { CaptureFlagHandle } from "../buildings/captureFlag";
import type { Team } from "../theme/colors";
import {
  createHelicopter,
  createRifleman,
  createSupplyTruck,
  createTank,
  type UnitHandle,
} from "../units";
import { approach } from "../units/types";
import type { HudHandle, UpgradeCardState } from "../ui/hud";
import type { TerrainHandle } from "../terrain/createTerrain";
import type {
  FocusKind,
  MatchEvent,
  MatchSnapshot,
  SlotSnapshot,
  UnitSnapshot,
} from "../sim/types";
import type { MatchDriver } from "../sim/driver";

export interface ViewSlot {
  team: Team;
  index: number;
  x: number;
  z: number;
  rotY: number;
  surfaceY: number;
  platform: {
    setSiteVisible: (v: boolean) => void;
    setHighlight: (v: boolean) => void;
    update: (dt: number, time: number) => void;
    setAttention: (on: boolean) => void;
    pickMesh: { uniqueId: number };
    dispose: () => void;
  };
  pickProxy: { uniqueId: number; dispose: () => void };
}

interface VisualUnit {
  id: number;
  unit: UnitHandle;
  hpBar: HpBarHandle;
}

interface VisualBuilding {
  id: number;
  handle: BuildingHandle;
  hpBar: HpBarHandle;
  slotIndex: number;
  team: Team;
}

export interface MatchView {
  applyEvents: (events: MatchEvent[]) => void;
  applySnapshot: (snap: MatchSnapshot) => void;
  updateVisuals: (dt: number, elapsed: number, camera: ArcRotateCamera) => void;
  allyFrontZ: (team: Team, towardEnemy?: 1 | -1) => number;
  slotAt: (team: Team, index: number) => ViewSlot | undefined;
  openBuildModal: (slot: ViewSlot) => void;
  livingBuildingCount: (team: Team) => number;
  dispose: () => void;
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

export function createMatchView(opts: {
  scene: Scene;
  terrain: TerrainHandle;
  hud: HudHandle;
  coinFx: CoinPopupFx;
  captureFlag: CaptureFlagHandle;
  slots: ViewSlot[];
  turrets: TurretHandle[];
  turretHpBars: HpBarHandle[];
  driver: MatchDriver;
  getGameOver: () => boolean;
  setGameOver: (over: boolean) => void;
}): MatchView {
  const {
    scene,
    terrain,
    hud,
    coinFx,
    captureFlag,
    slots,
    turrets,
    turretHpBars,
    driver,
  } = opts;
  const localTeam = driver.localTeam;
  const units = new Map<number, VisualUnit>();
  const buildings = new Map<number, VisualBuilding>();
  const wrecks: BuildingHandle[] = [];
  const visualMissiles = new Map<number, MissileHandle>();
  let lastSnap: MatchSnapshot | null = null;
  let researchModalOpen = false;
  let selectedSlot: ViewSlot | null = null;
  let endShown = false;

  const turretById = new Map<number, TurretHandle>();
  for (let i = 0; i < turrets.length; i++) {
    turretById.set(i + 1, turrets[i]);
    turrets[i].setAutoFire(false);
  }

  function slotOf(team: Team, index: number): ViewSlot | undefined {
    return slots.find((s) => s.team === team && s.index === index);
  }

  function livingBuildingCount(team: Team): number {
    let n = 0;
    for (const b of buildings.values()) {
      if (b.team === team && !b.handle.destroyed) n += 1;
    }
    return n;
  }

  function getUpgradeCards(snap: MatchSnapshot): UpgradeCardState[] {
    const levels = snap.tech[localTeam];
    const active = snap.research[localTeam];
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

  function resolveFocus(
    kind: FocusKind | null,
    id: number | null,
  ): UnitHandle | BuildingHandle | TurretHandle | null {
    if (!kind || id === null) return null;
    if (kind === "unit") return units.get(id)?.unit ?? null;
    if (kind === "turret") return turretById.get(id) ?? null;
    return buildings.get(id)?.handle ?? null;
  }

  function placeVisualBuilding(
    slot: ViewSlot,
    kind: BuildingKind,
    buildingId: number,
  ): void {
    if (buildings.has(buildingId)) return;
    const handle = createBuildingOfKind(
      scene,
      `${slot.team}_${kind}_${slot.index}`,
      slot.team,
      kind,
    );
    handle.root.position.x = slot.x;
    handle.root.position.z = slot.z;
    handle.root.position.y = slot.surfaceY;
    handle.root.rotation.y = slot.rotY;
    handle.root.scaling.setAll(0.85);
    const hpBar = createHpBar(scene, handle.root.name);
    hpBar.setRatio(1);
    buildings.set(buildingId, {
      id: buildingId,
      handle,
      hpBar,
      slotIndex: slot.index,
      team: slot.team,
    });
    slot.platform.setSiteVisible(false);
  }

  function detachBuilding(id: number): BuildingHandle | null {
    const vis = buildings.get(id);
    if (!vis) return null;
    vis.hpBar.dispose();
    buildings.delete(id);
    return vis.handle;
  }

  function disposeBuildingVisual(id: number): void {
    const vis = buildings.get(id);
    if (!vis) return;
    vis.hpBar.dispose();
    vis.handle.dispose();
    buildings.delete(id);
  }

  function spawnVisualUnit(ev: Extract<MatchEvent, { type: "UnitSpawned" }>): void {
    if (units.has(ev.unitId)) return;
    const unit = createUnitOfKind(
      scene,
      `${ev.team}_${ev.kind}_${ev.unitId}`,
      ev.team,
      ev.kind,
    );
    unit.root.position.x = ev.x;
    unit.root.position.z = ev.z;
    unit.root.position.y = terrain.getGroundYAt(ev.x, ev.z);
    unit.root.rotation.y = ev.yaw;
    unit.root.scaling.setAll(0.8);
    unit.setAutoFire(false);
    const hpBar = createHpBar(scene, unit.root.name);
    hpBar.setRatio(1);
    units.set(ev.unitId, { id: ev.unitId, unit, hpBar });
  }

  function playHitscanFx(ev: Extract<MatchEvent, { type: "UnitFired" }>): void {
    const impact = new Vector3(ev.impactX, ev.impactY, ev.impactZ);
    if (ev.weapon === "tank") {
      const attacker = units.get(ev.attackerId)?.unit;
      const team = attacker?.team ?? localTeam;
      const heavy = (lastSnap?.tech[team].tankSplash ?? 0) > 0;
      spawnExplosion(scene, impact, {
        scale: heavy ? 1.85 : 1.15,
        duration: 0.55,
      });
      attacker?.playFireFx();
      return;
    }
    if (ev.attackerKind === "turret") {
      const turret = turretById.get(ev.attackerId);
      turret?.playFireFx();
      if (turret) {
        spawnBulletTrace(scene, turret.getMuzzlePoint().clone(), impact, {
          speed: 62,
          length: 1.35,
          thickness: 0.075,
          color: "#fff4b8",
        });
      }
      return;
    }
    const attacker = units.get(ev.attackerId)?.unit;
    if (!attacker) return;
    attacker.playFireFx(ev.weapon === "heliGun" ? "gun" : "gun");
    const isHeliGun = ev.weapon === "heliGun";
    spawnBulletTrace(scene, attacker.getMuzzlePoint().clone(), impact, {
      speed: isHeliGun ? 70 : 58,
      length: isHeliGun ? 1.45 : 1.25,
      thickness: isHeliGun ? 0.08 : 0.07,
      color: isHeliGun ? "#ffe9a0" : "#fff8d8",
    });
  }

  function applyEvents(events: MatchEvent[]): void {
    for (const ev of events) {
      if (ev.type === "BuildingPlaced") {
        const slot = slotOf(ev.team, ev.slotIndex);
        if (slot) placeVisualBuilding(slot, ev.kind, ev.buildingId);
      } else if (ev.type === "BuildingCollapsed") {
        const vis = buildings.get(ev.buildingId);
        if (vis && !vis.handle.destroyed) vis.handle.beginCollapse();
        const handle = detachBuilding(ev.buildingId);
        if (handle) wrecks.push(handle);
        slotOf(ev.team, ev.slotIndex)?.platform.setSiteVisible(true);
      } else if (ev.type === "BuildingDestroyed") {
        const vis = buildings.get(ev.buildingId);
        if (vis && !vis.handle.destroyed) vis.handle.takeDamage(vis.handle.hp + 1);
        vis?.hpBar.setVisible(false);
      } else if (ev.type === "PadFreed") {
        for (const [id, vis] of buildings) {
          if (vis.team === ev.team && vis.slotIndex === ev.slotIndex) {
            vis.hpBar.dispose();
            if (!vis.handle.destroyed) vis.handle.beginCollapse();
            wrecks.push(vis.handle);
            buildings.delete(id);
          }
        }
        slotOf(ev.team, ev.slotIndex)?.platform.setSiteVisible(true);
      } else if (ev.type === "UnitSpawned") {
        spawnVisualUnit(ev);
      } else if (ev.type === "UnitDied") {
        const vis = units.get(ev.unitId);
        if (vis && !vis.unit.destroyed) vis.unit.destroy();
        vis?.hpBar.setVisible(false);
      } else if (ev.type === "TurretDied") {
        const turret = turretById.get(ev.turretId);
        if (turret && !turret.destroyed) turret.takeDamage(turret.hp + 1);
      } else if (ev.type === "UnitFired") {
        playHitscanFx(ev);
      } else if (ev.type === "MissileLaunch") {
        const heli = units.get(ev.heliId)?.unit;
        heli?.playFireFx("missile");
        const target = resolveFocus(ev.targetKind, ev.targetId);
        const missile = createMissile(
          scene,
          `missile_${ev.missileId}`,
          new Vector3(ev.x, ev.y, ev.z),
          () => {
            if (!target || target.destroyed) return null;
            return target.getHitPoint();
          },
          {
            cruiseY: ev.y,
            speed: 1.3 * 4,
            diveRange: 2.6,
            hitRange: 0.55,
          },
        );
        visualMissiles.set(ev.missileId, missile);
      } else if (ev.type === "MissileHit") {
        spawnExplosion(scene, new Vector3(ev.x, ev.y, ev.z), {
          scale: 1.55,
          duration: 0.7,
        });
        const m = visualMissiles.get(ev.missileId);
        m?.dispose();
        visualMissiles.delete(ev.missileId);
      } else if (ev.type === "ResearchComplete") {
        if (ev.team === localTeam) hud.showUpgradeToast(UPGRADE_DEFS[ev.id].label);
      } else if (ev.type === "TruckCoin") {
        if (ev.team === localTeam) {
          const vis = units.get(ev.unitId);
          if (vis) {
            coinFx.spawn(vis.unit.root.position.clone(), ev.amount, {
              follow: () => vis.unit.root.getAbsolutePosition(),
            });
          }
        }
      } else if (ev.type === "FlagCoin") {
        if (ev.team === localTeam) {
          const at = captureFlag.root.position.clone();
          at.y += 2.2;
          coinFx.spawn(at, ev.amount);
        }
      } else if (ev.type === "TurretBounty") {
        if (ev.killer === localTeam) {
          const turret = turretById.get(ev.turretId);
          if (turret) {
            coinFx.spawn(turret.root.position.clone(), ev.amount);
          }
        }
      } else if (ev.type === "FlagOwnerChanged") {
        captureFlag.setOwner(ev.owner);
        hud.setFlagOwner(ev.owner);
      } else if (ev.type === "MatchEnded") {
        opts.setGameOver(true);
        if (!endShown) {
          endShown = true;
          hud.showEndScreen(ev.winner === localTeam ? "victory" : "defeat");
        }
      }
    }
  }

  function syncBuildingFromSlot(s: SlotSnapshot): void {
    const vis = s.buildingId !== null ? buildings.get(s.buildingId) : undefined;
    if (!vis) return;
    if (s.destroyed && !vis.handle.destroyed) {
      vis.handle.takeDamage(vis.handle.hp + 1);
    }
    if (!vis.handle.destroyed && vis.handle.hp > s.hp) {
      vis.handle.takeDamage(vis.handle.hp - s.hp);
    }
    vis.hpBar.setVisible(!vis.handle.destroyed);
    if (!vis.handle.destroyed) vis.hpBar.setRatio(s.hp / Math.max(1, s.maxHp));
  }

  function syncUnit(s: UnitSnapshot, camera: ArcRotateCamera): void {
    const vis = units.get(s.id);
    if (!vis) return;
    if (s.destroyed && !vis.unit.destroyed) vis.unit.destroy();
    if (vis.unit.destroyed) {
      vis.hpBar.setVisible(false);
      return;
    }
    vis.unit.root.position.x = s.x;
    vis.unit.root.position.z = s.z;
    vis.unit.root.rotation.y = s.yaw;
    vis.unit.setMoving(s.moving);
    vis.unit.setCombat(s.combat);
    vis.unit.setAimTarget(resolveFocus(s.focusKind, s.focusId));
    vis.unit.setMissilesEnabled(s.missilesEnabled);
    if (s.kind === "tank") vis.unit.fireRateHz = UNIT_STATS.tank.fireRateHz;
    vis.hpBar.setVisible(true);
    vis.hpBar.setRatio(s.hp / Math.max(1, s.maxHp));
    vis.hpBar.update(
      vis.unit.root.getAbsolutePosition(),
      UNIT_STATS[s.kind].hpBarHeight,
      camera.globalPosition,
    );
    if (s.kind === "tank") terrain.ramTreesAt(s.x, s.z, 0.85);
  }

  function applySnapshot(snap: MatchSnapshot): void {
    lastSnap = snap;
    hud.setCoins(snap.coins[localTeam]);
    hud.setFlagOwner(snap.flagOwner);
    captureFlag.setOwner(snap.flagOwner);

    const presentBuildingIds = new Set<number>();
    for (const s of snap.slots) {
      if (s.kind && s.buildingId !== null) presentBuildingIds.add(s.buildingId);
    }
    for (const [id, vis] of buildings) {
      if (presentBuildingIds.has(id)) continue;
      disposeBuildingVisual(id);
      slotOf(vis.team, vis.slotIndex)?.platform.setSiteVisible(true);
    }

    for (const s of snap.slots) {
      slotOf(s.team, s.index)?.platform.setSiteVisible(s.kind === null);
      if (s.kind && s.buildingId !== null && !buildings.has(s.buildingId)) {
        const slot = slotOf(s.team, s.index);
        if (slot) placeVisualBuilding(slot, s.kind, s.buildingId);
      }
      syncBuildingFromSlot(s);
    }

    for (const t of snap.turrets) {
      const turret = turretById.get(t.id);
      const hpBar = turretHpBars[t.id - 1];
      if (!turret || !hpBar) continue;
      if (t.destroyed && !turret.destroyed) turret.takeDamage(turret.hp + 1);
      if (!turret.destroyed && turret.hp !== t.hp) {
        if (t.hp < turret.hp) turret.takeDamage(turret.hp - t.hp);
        else turret.heal(t.hp - turret.hp);
      }
      turret.shootRange = t.shootRange;
      turret.setAimTarget(resolveFocus(t.focusKind, t.focusId));
      hpBar.setVisible(!turret.destroyed);
      if (!turret.destroyed) {
        hpBar.setRatio(t.hp / Math.max(1, t.maxHp));
      }
    }

    for (const u of snap.units) {
      if (!units.has(u.id) && !u.destroyed) {
        spawnVisualUnit({
          type: "UnitSpawned",
          unitId: u.id,
          team: u.team,
          kind: u.kind,
          x: u.x,
          z: u.z,
          yaw: u.yaw,
          buildingId: 0,
        });
      }
    }

    if (snap.gameOver && !endShown) {
      opts.setGameOver(true);
      endShown = true;
      hud.showEndScreen(snap.winner === localTeam ? "victory" : "defeat");
    }

    if (researchModalOpen) {
      hud.refreshResearchModal(snap.coins[localTeam], getUpgradeCards(snap));
    }

    const active = snap.research[localTeam];
    const progress = active ? active.elapsed / active.duration : 0;
    for (const vis of buildings.values()) {
      if (vis.handle.kind !== "researchLab" || vis.handle.destroyed) continue;
      (vis.handle as ResearchLabHandle).setResearching(!!active, progress);
    }
  }

  function updateVisuals(dt: number, elapsed: number, camera: ArcRotateCamera): void {
    const snap = lastSnap;
    if (snap) {
      for (const u of snap.units) syncUnit(u, camera);
      for (const t of snap.turrets) {
        const hpBar = turretHpBars[t.id - 1];
        const turret = turretById.get(t.id);
        if (!hpBar || !turret || turret.destroyed) continue;
        hpBar.update(
          turret.root.getAbsolutePosition(),
          TURRET_HP_BAR_HEIGHT,
          camera.globalPosition,
        );
      }
      for (const s of snap.slots) {
        const vis = s.buildingId !== null ? buildings.get(s.buildingId) : undefined;
        if (!vis || vis.handle.destroyed) continue;
        vis.hpBar.update(
          vis.handle.root.getAbsolutePosition(),
          BUILDING_HP_BAR_HEIGHT,
          camera.globalPosition,
        );
      }
    }

    const tiltSpeed = 2.8;
    for (const vis of units.values()) {
      const unit = vis.unit;
      if (!unit.destroyed) {
        const { x, z } = unit.root.position;
        unit.root.position.y = terrain.getGroundYAt(x, z);
        if (unit.kind === "tank" || unit.kind === "supplyTruck") {
          const tilt = terrain.getGroundTiltAt(x, z, unit.root.rotation.y);
          const maxStep = tiltSpeed * dt;
          unit.root.rotation.x = approach(unit.root.rotation.x, tilt.pitch, maxStep);
          unit.root.rotation.z = approach(unit.root.rotation.z, tilt.roll, maxStep);
        }
      }
      unit.update(dt, elapsed);
    }

    for (const vis of buildings.values()) vis.handle.update(dt, elapsed);
    for (let i = wrecks.length - 1; i >= 0; i--) {
      wrecks[i].update(dt, elapsed);
      if (wrecks[i].expired) {
        wrecks[i].dispose();
        wrecks.splice(i, 1);
      }
    }
    for (const turret of turrets) turret.update(dt, elapsed);

    for (const [id, missile] of visualMissiles) {
      if (!missile.update(dt)) {
        missile.dispose();
        visualMissiles.delete(id);
      }
    }

    for (const vis of units.values()) {
      if (vis.unit.expired) {
        vis.hpBar.dispose();
        vis.unit.dispose();
        units.delete(vis.id);
      }
    }
    for (const [id, vis] of buildings) {
      if (vis.handle.expired) {
        vis.hpBar.dispose();
        vis.handle.dispose();
        buildings.delete(id);
      }
    }
  }

  function openBuildModal(slot: ViewSlot): void {
    if (opts.getGameOver() || slot.team !== localTeam) return;
    selectedSlot?.platform.setHighlight(false);
    selectedSlot = slot;
    slot.platform.setHighlight(true);
    const snap = lastSnap;
    const slotSnap = snap?.slots.find(
      (s) => s.team === slot.team && s.index === slot.index,
    );
    const occupied =
      slotSnap && !slotSnap.destroyed ? slotSnap.kind : null;
    researchModalOpen = occupied === "researchLab" && !slotSnap?.constructing;
    hud.openBuildModal({
      coins: snap?.coins[localTeam] ?? 0,
      occupied,
      canCollapse: occupied !== null && livingBuildingCount(localTeam) > 1,
      upgrades: researchModalOpen && snap ? getUpgradeCards(snap) : undefined,
      onBuild: (kind) => {
        driver.enqueue({ type: "build", slotIndex: slot.index, kind });
        slot.platform.setHighlight(false);
        selectedSlot = null;
        researchModalOpen = false;
      },
      onResearch: (id: UpgradeId) => {
        driver.enqueue({ type: "research", id });
      },
      onCollapse: () => {
        driver.enqueue({ type: "collapse", slotIndex: slot.index });
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

  return {
    applyEvents,
    applySnapshot,
    updateVisuals,
    allyFrontZ: (team, towardEnemy = 1) => {
      let bestAlong = -1e9;
      const consider = (z: number) => {
        bestAlong = Math.max(bestAlong, towardEnemy * z);
      };
      for (const slot of slots) {
        if (slot.team !== team) continue;
        consider(slot.z);
      }
      for (const vis of buildings.values()) {
        if (vis.team !== team || vis.handle.destroyed) continue;
        consider(vis.handle.root.position.z);
      }
      for (const turret of turrets) {
        if (turret.team !== team || turret.destroyed) continue;
        consider(turret.root.position.z);
      }
      for (const vis of units.values()) {
        if (vis.unit.team !== team || vis.unit.destroyed) continue;
        consider(vis.unit.root.position.z);
      }
      return towardEnemy * bestAlong;
    },
    slotAt: slotOf,
    openBuildModal,
    livingBuildingCount,
    dispose: () => {
      for (const vis of units.values()) {
        vis.hpBar.dispose();
        vis.unit.dispose();
      }
      units.clear();
      for (const vis of buildings.values()) {
        vis.hpBar.dispose();
        vis.handle.dispose();
      }
      buildings.clear();
      for (const w of wrecks) w.dispose();
      wrecks.length = 0;
      for (const m of visualMissiles.values()) m.dispose();
      visualMissiles.clear();
    },
  };
}
