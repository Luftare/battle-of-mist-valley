/**
 * Mode picker: vs AI, create room, or join with a code.
 */
export function showMultiplayerLobby(opts: {
  onVsAi: () => void;
  onCreate: () => void;
  onJoin: (code: string) => void;
}): void {
  const host = document.createElement("div");
  host.id = "mpLobbyHost";
  host.className = "mp-lobby-host";
  host.innerHTML = `
    <div class="mp-lobby-panel" role="dialog" aria-labelledby="mpLobbyTitle">
      <h1 id="mpLobbyTitle" class="mp-lobby-title">Mist Valley</h1>
      <p class="mp-lobby-tip">Build, spawn, and siege. 1v1 uses an authoritative match server.</p>
      <button type="button" class="btn btn-primary mp-lobby-btn" id="mpVsAi">
        Play vs AI
      </button>
      <button type="button" class="btn mp-lobby-btn" id="mpCreate">
        Create room
      </button>
      <button type="button" class="btn mp-lobby-btn" id="mpJoin">
        Join room
      </button>
      <p class="mp-lobby-error" id="mpLobbyError" hidden></p>
    </div>
  `;
  document.body.appendChild(host);

  const errorEl = host.querySelector("#mpLobbyError") as HTMLParagraphElement;

  host.querySelector("#mpVsAi")?.addEventListener("click", () => {
    host.remove();
    opts.onVsAi();
  });
  host.querySelector("#mpCreate")?.addEventListener("click", () => {
    host.remove();
    opts.onCreate();
  });
  host.querySelector("#mpJoin")?.addEventListener("click", () => {
    const raw = window.prompt("Enter room code");
    if (raw === null) return;
    const code = raw.trim().toUpperCase();
    if (code.length < 4) {
      errorEl.hidden = false;
      errorEl.textContent = "Enter a 4-character room code.";
      return;
    }
    host.remove();
    opts.onJoin(code);
  });
}

export function showRoomWaiting(opts: {
  code: string;
  onCancel?: () => void;
}): { setStatus: (text: string) => void; dispose: () => void } {
  const host = document.createElement("div");
  host.id = "mpWaitHost";
  host.className = "mp-lobby-host";
  host.innerHTML = `
    <div class="mp-lobby-panel" role="status">
      <p class="mp-lobby-tip">Share this code</p>
      <p class="mp-lobby-code-display" id="mpWaitCode">${opts.code}</p>
      <p class="mp-lobby-tip" id="mpWaitStatus">Waiting for opponent…</p>
      <button type="button" class="btn mp-lobby-btn" id="mpWaitCancel">Cancel</button>
    </div>
  `;
  document.body.appendChild(host);
  const status = host.querySelector("#mpWaitStatus") as HTMLParagraphElement;
  host.querySelector("#mpWaitCancel")?.addEventListener("click", () => {
    host.remove();
    opts.onCancel?.();
  });
  return {
    setStatus: (text) => {
      status.textContent = text;
    },
    dispose: () => host.remove(),
  };
}
