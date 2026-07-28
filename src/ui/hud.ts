import type { BuildingKind } from "../buildings/types";
import {
  BUILDING_BLURB,
  BUILDING_COST,
  BUILDING_KINDS,
  BUILDING_LABEL,
  BUILDING_TO_UNIT,
  UNIT_LABEL,
} from "../game/stats";

export interface BuildModalOpts {
  coins: number;
  /** When set, platform already has a building — show collapse. */
  occupied: BuildingKind | null;
  canCollapse: boolean;
  onBuild: (kind: BuildingKind) => void;
  onCollapse: () => void;
  onClose: () => void;
}

export interface HudHandle {
  setCoins: (n: number) => void;
  /** Drive the displayed coin tween each frame. */
  update: (dt: number) => void;
  openBuildModal: (opts: BuildModalOpts) => void;
  /** Refresh build-card affordability while the modal stays open. */
  refreshBuildAfford: (coins: number) => void;
  closeModal: () => void;
  showEndScreen: (result: "victory" | "defeat") => void;
  dispose: () => void;
}

/**
 * DOM HUD: coin counter, build/collapse modal, victory / defeat overlay.
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
      <p>Tap your platforms to build · Collapse to rebuild</p>
    </div>
    <div class="hud-coins" id="hudCoins" aria-live="polite">
      <span class="coin-icon" aria-hidden="true"></span>
      <span class="coin-value" id="hudCoinValue">0</span>
    </div>
  `;
  root.appendChild(top);

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

  function closeModal(): void {
    modalHost.hidden = true;
    modalHost.innerHTML = "";
    modalHost.onclick = null;
    buildCards = [];
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
      if (!modalHost.hidden) applyBuildAfford(next);
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
    },
    openBuildModal: (opts) => {
      closeModal();
      modalHost.hidden = false;
      modalCoins = opts.coins;

      const panel = document.createElement("div");
      panel.className = "modal-panel";
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
      panel.setAttribute("aria-label", "Build menu");

      const title = document.createElement("h2");
      title.textContent = opts.occupied ? "Site occupied" : "Build on site";
      panel.appendChild(title);

      if (opts.occupied) {
        const info = document.createElement("p");
        info.className = "modal-sub";
        info.textContent = `${BUILDING_LABEL[opts.occupied]} · produces ${UNIT_LABEL[BUILDING_TO_UNIT[opts.occupied]]}`;
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
        const list = document.createElement("div");
        list.className = "build-list";
        buildCards = [];

        for (const kind of BUILDING_KINDS) {
          const cost = BUILDING_COST[kind];
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
            <div class="build-unit">Produces ${UNIT_LABEL[BUILDING_TO_UNIT[kind]]}</div>
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
      if (modalHost.hidden) return;
      applyBuildAfford(coins);
    },
    closeModal,
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
      root.innerHTML = "";
    },
  };
}
