/**
 * First moments in-match: tip about platforms + confirm to start play.
 */
export function showBuildIntro(opts: { onConfirm: () => void }): void {
  const host = document.createElement("div");
  host.id = "buildIntroHost";
  host.className = "build-intro-host";
  host.innerHTML = `
    <div class="build-intro-panel" role="dialog" aria-labelledby="buildIntroTip">
      <p id="buildIntroTip" class="build-intro-tip">
        Tap a platform on your side to build. Units fight on their own.
      </p>
      <button type="button" class="btn btn-primary build-intro-go" id="buildIntroGo">
        START THE MISSION
      </button>
    </div>
  `;
  document.body.appendChild(host);

  const go = document.getElementById("buildIntroGo");
  go?.addEventListener(
    "click",
    () => {
      // Start camera while overlay fades — avoids a pause then snap at the end
      opts.onConfirm();
      host.classList.add("build-intro-host--out");
      window.setTimeout(() => host.remove(), 220);
    },
    { once: true },
  );
}

/** Shown after you confirm the build intro while the other player has not. */
export function showWaitingForPeer(): { dispose: () => void } {
  const existing = document.getElementById("mpPeerWaitHost");
  existing?.remove();
  const host = document.createElement("div");
  host.id = "mpPeerWaitHost";
  host.className = "build-intro-host build-intro-host--wait";
  host.innerHTML = `
    <div class="build-intro-panel" role="status">
      <p class="build-intro-tip">Waiting for the other player to start…</p>
    </div>
  `;
  document.body.appendChild(host);
  return {
    dispose: () => host.remove(),
  };
}
