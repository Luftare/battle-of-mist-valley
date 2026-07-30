import { FLAG_COINS_PER_SEC } from "../game/stats";
import { missionBriefMapSvg } from "./missionBriefMap";

const HOST_ID = "hillBriefHost";

export function closeHillBriefModal(): void {
  document.getElementById(HOST_ID)?.remove();
}

/**
 * Explains the center hill: map + capture rules + bonus income.
 */
export function showHillBriefModal(): void {
  if (document.getElementById(HOST_ID)) return;

  const host = document.createElement("div");
  host.id = HOST_ID;
  host.className = "modal-host hill-brief-host";
  host.innerHTML = `
    <div class="modal-panel hill-brief-panel" role="dialog" aria-labelledby="hillBriefTitle">
      <h2 id="hillBriefTitle">Center Hill</h2>
      <p class="modal-sub">Strategic capture point in the middle of the valley.</p>
      <div class="hill-brief-map brief-map">
        ${missionBriefMapSvg()}
      </div>
      <div class="hill-brief-body">
        <p>
          The hill flag marks the capture zone. Keep only your units inside the dashed ring
          to claim it — if both teams are present, or nobody is there, the hill stays neutral.
        </p>
        <p class="hill-brief-reward">
          <span class="hill-brief-reward-icon" aria-hidden="true"></span>
          While your team holds the hill, you gain
          <strong>${FLAG_COINS_PER_SEC} extra coins</strong> every second.
        </p>
      </div>
      <button type="button" class="btn btn-ghost" id="hillBriefClose">Close</button>
    </div>
  `;
  document.body.appendChild(host);

  const close = () => closeHillBriefModal();
  document.getElementById("hillBriefClose")?.addEventListener("click", close, { once: true });
  host.addEventListener(
    "click",
    (e) => {
      if (e.target === host) close();
    },
    { once: true },
  );
}
