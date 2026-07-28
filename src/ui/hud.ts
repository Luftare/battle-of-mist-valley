import type { BuildingKind } from "../buildings/types";
import {
  BUILDING_BLURB,
  BUILDING_COST,
  BUILDING_KINDS,
  BUILDING_LABEL,
  BUILDING_TO_UNIT,
  UNIT_LABEL,
} from "../game/stats";
import {
  UPGRADE_DEFS,
  UPGRADE_IDS,
  upgradeCost,
  type UpgradeId,
} from "../game/upgrades";

export interface UpgradeCardState {
  id: UpgradeId;
  level: number;
  maxLevel: number;
  cost: number;
  /** 0–1 when this upgrade is the active research project. */
  progress: number | null;
  researching: boolean;
  /** Another project is already running. */
  blocked: boolean;
}

export interface BuildModalOpts {
  coins: number;
  /** When set, platform already has a building — show collapse / research. */
  occupied: BuildingKind | null;
  canCollapse: boolean;
  onBuild: (kind: BuildingKind) => void;
  onCollapse: () => void;
  onClose: () => void;
  /** Research Lab only — current upgrade board. */
  upgrades?: UpgradeCardState[];
  onResearch?: (id: UpgradeId) => void;
}

export interface HudHandle {
  setCoins: (n: number) => void;
  /** Drive the displayed coin tween each frame. */
  update: (dt: number) => void;
  openBuildModal: (opts: BuildModalOpts) => void;
  /** Refresh build-card affordability while the modal stays open. */
  refreshBuildAfford: (coins: number) => void;
  /** Refresh research cards (progress / levels / afford) while lab modal is open. */
  refreshResearchModal: (
    coins: number,
    upgrades: UpgradeCardState[],
  ) => void;
  closeModal: () => void;
  /** Juicy toast when an upgrade finishes. */
  showUpgradeToast: (label: string) => void;
  showEndScreen: (result: "victory" | "defeat") => void;
  dispose: () => void;
}

/**
 * DOM HUD: coin counter, build/collapse/research modal, victory / defeat overlay.
 */
export function createHud(): HudHandle {
  const root = document.getElementById("hud");
  if (!root) throw new Error("Missing #hud");

  root.innerHTML = "";
  root.style.pointerEvents = "none";

  const top = document.createElement("div");
  top.className = "hud-top";
  top.innerHTML = `
    <div class="hud-brand">
      <h1>Auto Battler</h1>
      <p>Tap your platforms to build · Research Lab unlocks upgrades</p>
    </div>
    <div class="hud-coins" id="hudCoins" aria-live="polite">
      <span class="coin-icon" aria-hidden="true"></span>
      <span class="coin-value" id="hudCoinValue">0</span>
    </div>
  `;
  root.appendChild(top);

  const toastHost = document.createElement("div");
  toastHost.id = "upgradeToastHost";
  toastHost.className = "upgrade-toast-host";
  toastHost.setAttribute("aria-live", "polite");
  document.body.appendChild(toastHost);

  const modalHost = document.createElement("div");
  modalHost.id = "buildModalHost";
  modalHost.className = "modal-host";
  modalHost.hidden = true;
  document.body.appendChild(modalHost);

  const endHost = document.createElement("div");
  endHost.id = "endScreenHost";
  endHost.className = "end-host";
  endHost.hidden = true;
  document.body.appendChild(endHost);

  const coinEl = () => document.getElementById("hudCoinValue") as HTMLElement;
  const coinsWrap = () => document.getElementById("hudCoins") as HTMLElement;

  let targetCoins = 0;
  let displayCoins = 0;
  let pulseTimer = 0;
  let pulseDir: "up" | "down" | null = null;
  let modalCoins = 0;
  let buildCards: HTMLButtonElement[] = [];
  let researchCards: HTMLButtonElement[] = [];
  let modalMode: "build" | "site" | "research" | null = null;
  let toastTimer = 0;

  function closeModal(): void {
    modalHost.hidden = true;
    modalHost.innerHTML = "";
    modalHost.onclick = null;
    buildCards = [];
    researchCards = [];
    modalMode = null;
  }

  function paintCoins(): void {
    const el = coinEl();
    if (!el) return;
    el.textContent = String(Math.round(displayCoins));
  }

  function applyBuildAfford(coins: number): void {
    modalCoins = coins;
    for (const card of buildCards) {
      const cost = Number(card.dataset.cost ?? 0);
      card.disabled = coins < cost;
    }
  }

  function paintUpgradeCard(card: HTMLButtonElement, u: UpgradeCardState): void {
    const def = UPGRADE_DEFS[u.id];
    const done = u.level >= u.maxLevel;
    const levelTag =
      u.maxLevel > 1 ? ` · ${u.level}/${u.maxLevel}` : u.level > 0 ? " · Done" : "";

    let status = "";
    if (u.researching && u.progress !== null) {
      status = `<div class="upgrade-progress"><span style="width:${Math.round(u.progress * 100)}%"></span></div>
        <div class="upgrade-status">Researching… ${Math.round(u.progress * 100)}%</div>`;
    } else if (done) {
      status = `<div class="upgrade-status upgrade-status--done">Unlocked</div>`;
    } else if (u.blocked) {
      status = `<div class="upgrade-status">Queue busy</div>`;
    }

    card.dataset.cost = String(u.cost);
    card.dataset.id = u.id;
    card.className = `build-card upgrade-card${done ? " upgrade-card--done" : ""}${
      u.researching ? " upgrade-card--active" : ""
    }`;
    card.disabled =
      done || u.researching || u.blocked || modalCoins < u.cost;
    card.innerHTML = `
      <div class="build-card-head">
        <span class="build-name">${def.label}${levelTag}</span>
        <span class="build-cost">${done ? "—" : u.cost}</span>
      </div>
      <div class="build-blurb">${def.blurb}</div>
      <div class="upgrade-meta">${def.durationSec}s research</div>
      ${status}
    `;
  }

  function patchUpgradeCard(card: HTMLButtonElement, u: UpgradeCardState): void {
    const done = u.level >= u.maxLevel;
    card.dataset.cost = String(u.cost);
    card.disabled =
      done || u.researching || u.blocked || modalCoins < u.cost;
    card.classList.toggle("upgrade-card--done", done);
    card.classList.toggle("upgrade-card--active", u.researching);

    const bar = card.querySelector(".upgrade-progress > span") as HTMLElement | null;
    const status = card.querySelector(".upgrade-status") as HTMLElement | null;
    if (u.researching && u.progress !== null) {
      if (bar) {
        bar.style.width = `${Math.round(u.progress * 100)}%`;
      } else {
        paintUpgradeCard(card, u);
        return;
      }
      if (status) {
        status.textContent = `Researching… ${Math.round(u.progress * 100)}%`;
        status.classList.remove("upgrade-status--done");
      }
    } else if (!u.researching && card.classList.contains("upgrade-card--active")) {
      // Research just finished / switched — full repaint for level tags
      paintUpgradeCard(card, u);
    } else {
      // Affordability / blocked-only updates
      card.disabled =
        done || u.researching || u.blocked || modalCoins < u.cost;
    }
  }

  function applyResearchState(coins: number, upgrades: UpgradeCardState[]): void {
    modalCoins = coins;
    const byId = new Map(upgrades.map((u) => [u.id, u]));
    for (const card of researchCards) {
      const id = card.dataset.id as UpgradeId | undefined;
      if (!id) continue;
      const u = byId.get(id);
      if (u) patchUpgradeCard(card, u);
    }
  }

  return {
    setCoins: (n) => {
      const next = Math.max(0, n);
      const delta = next - targetCoins;
      if (Math.abs(delta) < 1e-4) return;
      // Pulse only on meaningful jumps (spend / truck / bounty), not passive drip
      if (Math.abs(delta) >= 0.95) {
        pulseDir = delta > 0 ? "up" : "down";
        pulseTimer = 0.35;
        const wrap = coinsWrap();
        if (wrap) {
          wrap.classList.remove("coin-pulse-up", "coin-pulse-down");
          void wrap.offsetWidth;
          wrap.classList.add(pulseDir === "up" ? "coin-pulse-up" : "coin-pulse-down");
        }
      }
      targetCoins = next;
      if (!modalHost.hidden && modalMode === "build") applyBuildAfford(next);
    },
    update: (dt) => {
      const diff = targetCoins - displayCoins;
      if (Math.abs(diff) < 0.05) {
        displayCoins = targetCoins;
      } else {
        // Ease toward target: faster on big jumps, smooth tick on small ones
        const rate = Math.max(18, Math.abs(diff) * 6);
        displayCoins += Math.sign(diff) * Math.min(Math.abs(diff), rate * dt);
      }
      paintCoins();

      if (pulseTimer > 0) {
        pulseTimer -= dt;
        if (pulseTimer <= 0) {
          coinsWrap()?.classList.remove("coin-pulse-up", "coin-pulse-down");
          pulseDir = null;
        }
      }

      if (toastTimer > 0) {
        toastTimer -= dt;
        if (toastTimer <= 0) {
          toastHost.classList.remove("upgrade-toast-host--show");
          toastHost.innerHTML = "";
        }
      }
    },
    openBuildModal: (opts) => {
      closeModal();
      modalHost.hidden = false;
      modalCoins = opts.coins;

      const panel = document.createElement("div");
      panel.className = "modal-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");

      const isLab = opts.occupied === "researchLab";
      panel.setAttribute(
        "aria-label",
        isLab ? "Research lab" : opts.occupied ? "Site occupied" : "Build menu",
      );

      const title = document.createElement("h2");
      title.textContent = isLab
        ? "Research Lab"
        : opts.occupied
          ? "Site occupied"
          : "Build on site";
      panel.appendChild(title);

      if (isLab && opts.upgrades && opts.onResearch) {
        modalMode = "research";

        const info = document.createElement("p");
        info.className = "modal-sub";
        info.textContent = "Pick an upgrade — one project at a time.";
        panel.appendChild(info);

        const list = document.createElement("div");
        list.className = "build-list";
        researchCards = [];

        for (const id of UPGRADE_IDS) {
          const u =
            opts.upgrades.find((x) => x.id === id) ??
            ({
              id,
              level: 0,
              maxLevel: UPGRADE_DEFS[id].maxLevel,
              cost: upgradeCost(UPGRADE_DEFS[id], 0),
              progress: null,
              researching: false,
              blocked: false,
            } satisfies UpgradeCardState);
          const card = document.createElement("button");
          card.type = "button";
          paintUpgradeCard(card, u);
          card.addEventListener("click", () => {
            if (card.disabled) return;
            opts.onResearch?.(id);
          });
          list.appendChild(card);
          researchCards.push(card);
        }
        panel.appendChild(list);

        const collapseBtn = document.createElement("button");
        collapseBtn.type = "button";
        collapseBtn.className = "btn btn-danger";
        collapseBtn.textContent = opts.canCollapse
          ? "Collapse building"
          : "Can't collapse last building";
        collapseBtn.disabled = !opts.canCollapse;
        collapseBtn.addEventListener("click", () => {
          closeModal();
          opts.onCollapse();
        });
        panel.appendChild(collapseBtn);
      } else if (opts.occupied) {
        modalMode = "site";
        const unit = BUILDING_TO_UNIT[opts.occupied];
        const info = document.createElement("p");
        info.className = "modal-sub";
        info.textContent = unit
          ? `${BUILDING_LABEL[opts.occupied]} · produces ${UNIT_LABEL[unit]}`
          : BUILDING_LABEL[opts.occupied];
        panel.appendChild(info);

        const collapseBtn = document.createElement("button");
        collapseBtn.type = "button";
        collapseBtn.className = "btn btn-danger";
        collapseBtn.textContent = opts.canCollapse
          ? "Collapse building"
          : "Can't collapse last building";
        collapseBtn.disabled = !opts.canCollapse;
        collapseBtn.addEventListener("click", () => {
          closeModal();
          opts.onCollapse();
        });
        panel.appendChild(collapseBtn);
      } else {
        modalMode = "build";
        const list = document.createElement("div");
        list.className = "build-list";
        buildCards = [];

        for (const kind of BUILDING_KINDS) {
          const cost = BUILDING_COST[kind];
          const unit = BUILDING_TO_UNIT[kind];
          const card = document.createElement("button");
          card.type = "button";
          card.className = `build-card build-card--${kind}`;
          card.dataset.cost = String(cost);
          card.disabled = modalCoins < cost;
          card.innerHTML = `
            <div class="build-card-head">
              <span class="build-name">${BUILDING_LABEL[kind]}</span>
              <span class="build-cost">${cost}</span>
            </div>
            <div class="build-unit">${
              unit ? `Produces ${UNIT_LABEL[unit]}` : "Unlocks upgrades"
            }</div>
            <div class="build-blurb">${BUILDING_BLURB[kind]}</div>
          `;
          card.addEventListener("click", () => {
            if (modalCoins < cost) return;
            closeModal();
            opts.onBuild(kind);
          });
          list.appendChild(card);
          buildCards.push(card);
        }
        panel.appendChild(list);
      }

      const closeBtn = document.createElement("button");
      closeBtn.type = "button";
      closeBtn.className = "btn btn-ghost";
      closeBtn.textContent = "Close";
      closeBtn.addEventListener("click", () => {
        closeModal();
        opts.onClose();
      });
      panel.appendChild(closeBtn);

      modalHost.appendChild(panel);
      modalHost.onclick = (e) => {
        if (e.target === modalHost) {
          closeModal();
          opts.onClose();
        }
      };
    },
    refreshBuildAfford: (coins) => {
      if (modalHost.hidden || modalMode !== "build") return;
      applyBuildAfford(coins);
    },
    refreshResearchModal: (coins, upgrades) => {
      if (modalHost.hidden || modalMode !== "research") return;
      applyResearchState(coins, upgrades);
    },
    closeModal,
    showUpgradeToast: (label) => {
      toastHost.innerHTML = `<div class="upgrade-toast"><span class="upgrade-toast-icon" aria-hidden="true"></span><strong>Upgrade complete</strong><span>${label}</span></div>`;
      toastHost.classList.remove("upgrade-toast-host--show");
      void toastHost.offsetWidth;
      toastHost.classList.add("upgrade-toast-host--show");
      toastTimer = 2.8;
    },
    showEndScreen: (result) => {
      closeModal();
      endHost.hidden = false;
      endHost.innerHTML = `
        <div class="end-panel end-panel--${result}">
          <h2>${result === "victory" ? "Victory" : "Defeat"}</h2>
          <p>${
            result === "victory"
              ? "Enemy forces wiped out."
              : "Your bases and army are gone."
          }</p>
          <button type="button" class="btn btn-primary" id="endReload">Play again</button>
        </div>
      `;
      document.getElementById("endReload")?.addEventListener("click", () => {
        window.location.reload();
      });
    },
    dispose: () => {
      closeModal();
      modalHost.remove();
      endHost.remove();
      toastHost.remove();
      root.innerHTML = "";
    },
  };
}
