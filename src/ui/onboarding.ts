/**
 * Shown at every game start: short objective tip, then unpause play.
 */
export function showOnboarding(opts: { onDismiss: () => void }): void {
  const host = document.createElement("div");
  host.id = "onboardingHost";
  host.className = "onboard-host";
  host.innerHTML = `
    <div class="onboard-panel" role="dialog" aria-labelledby="onboardTitle">
      <div class="onboard-glow" aria-hidden="true"></div>
      <p class="onboard-kicker onboard-stagger" style="--d:0">Welcome to</p>
      <h1 id="onboardTitle" class="onboard-stagger" style="--d:1">Mist Valley</h1>
      <p class="onboard-subtitle onboard-stagger" style="--d:2">Auto-battler</p>
      <div class="onboard-objective-wrap onboard-stagger" style="--d:3">
        <p class="onboard-objective">Destroy the enemy base.</p>
      </div>
      <p class="onboard-tip onboard-stagger" style="--d:4">
        Tap a platform on your side to build. Units fight on their own.
      </p>
      <button type="button" class="btn btn-primary onboard-go onboard-stagger" style="--d:5" id="onboardGo">
        Got it, play!
      </button>
    </div>
  `;
  document.body.appendChild(host);

  const go = document.getElementById("onboardGo");
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
}
