import { missionBriefMapSvg } from "./missionBriefMap";

/**
 * Two-step title flow over the hill close-up:
 * 1) Welcome + PLAY
 * 2) Mission brief map + typed objective → continue into the match
 */
export function showOnboarding(opts: { onDismiss: () => void }): void {
  const host = document.createElement("div");
  host.id = "onboardingHost";
  host.className = "onboard-host";
  document.body.appendChild(host);

  const fadeSwap = (next: () => void) => {
    host.classList.add("onboard-host--swap");
    window.setTimeout(() => {
      next();
      host.classList.remove("onboard-host--swap");
    }, 220);
  };

  const showWelcome = () => {
    host.innerHTML = `
      <div class="onboard-panel" role="dialog" aria-labelledby="onboardTitle">
        <h1 id="onboardTitle" class="onboard-stagger" style="--d:0">Mist Valley</h1>
        <p class="onboard-subtitle onboard-stagger" style="--d:1">Auto-battler</p>
        <p class="onboard-desc onboard-stagger" style="--d:2">
          Build your base and counter the enemy forces.
        </p>
        <button type="button" class="btn btn-primary onboard-go onboard-stagger" style="--d:3" id="onboardGo">
          PLAY
        </button>
      </div>
    `;
    document.getElementById("onboardGo")?.addEventListener(
      "click",
      () => fadeSwap(showBrief),
      { once: true },
    );
  };

  const showBrief = () => {
    host.innerHTML = `
      <div class="onboard-panel onboard-panel--brief" role="dialog" aria-labelledby="onboardBriefKicker">
        <p id="onboardBriefKicker" class="onboard-kicker onboard-stagger" style="--d:0">Mission brief</p>
        <div class="brief-map brief-map--large onboard-stagger" style="--d:1">
          ${missionBriefMapSvg()}
        </div>
        <p id="onboardBrief" class="onboard-mission onboard-stagger" style="--d:2" aria-live="polite">
          <span id="onboardBriefText"></span><span class="onboard-cursor" id="onboardCursor" aria-hidden="true">▌</span>
        </p>
        <button type="button" class="btn btn-primary onboard-go" id="onboardContinue" hidden>
          CONTINUE
        </button>
      </div>
    `;

    const briefEl = document.getElementById("onboardBriefText");
    const cursorEl = document.getElementById("onboardCursor");
    const go = document.getElementById("onboardContinue") as HTMLButtonElement | null;
    const fullBrief =
      "Destroy the enemy base. Control the hill for extra resources.";
    let i = 0;

    const typeNext = () => {
      if (!briefEl) return;
      if (i >= fullBrief.length) {
        cursorEl?.classList.add("onboard-cursor--done");
        if (go) {
          go.hidden = false;
          go.classList.add("onboard-stagger");
          go.style.setProperty("--d", "0");
        }
        return;
      }
      briefEl.textContent = fullBrief.slice(0, i + 1);
      i += 1;
      const ch = fullBrief[i - 1];
      const delay =
        ch === ":" ? 74 : ch === "." ? 67 : ch === " " ? 12 : 9;
      window.setTimeout(typeNext, delay);
    };

    window.setTimeout(typeNext, 160);

    go?.addEventListener(
      "click",
      () => {
        host.classList.add("onboard-host--out");
        window.setTimeout(() => {
          host.remove();
          opts.onDismiss();
        }, 280);
      },
      { once: true },
    );
  };

  showWelcome();
}
