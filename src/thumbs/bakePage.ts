import { bakeThumbnails } from "./bakeThumbnails";
import { THUMB_IDS } from "./registry";

declare global {
  interface Window {
    __THUMBS__?: Record<string, string>;
    __THUMBS_ERROR__?: string;
    /** Optional: `?ids=rifleman,tank` on the bake page URL. */
    __THUMB_IDS__?: string[];
  }
}

/**
 * Standalone bake page: captures thumbs and exposes them for the Node script.
 * Opened by `npm run bake-thumbs` via puppeteer-core.
 *
 * To bake a subset from the browser: bake-thumbs.html?ids=rifleman,tank
 */
async function main(): Promise<void> {
  const status = document.getElementById("status");
  const set = (msg: string) => {
    if (status) status.textContent = msg;
  };

  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("ids");
  const ids =
    window.__THUMB_IDS__ ??
    (fromQuery
      ? fromQuery
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : undefined);

  try {
    set(ids?.length ? `Baking ${ids.join(", ")}…` : "Baking thumbnails…");
    const thumbs = await bakeThumbnails({ ids });
    const payload: Record<string, string> = {};
    const bakedIds = ids?.length ? ids : THUMB_IDS;
    for (const id of bakedIds) {
      const url = thumbs[id as keyof typeof thumbs];
      if (!url) throw new Error(`Missing thumb: ${id}`);
      payload[id] = url;
    }
    window.__THUMBS__ = payload;
    set(`Done (${bakedIds.length} thumbs).`);
  } catch (err) {
    console.error(err);
    set(`Failed: ${err instanceof Error ? err.message : String(err)}`);
    window.__THUMBS_ERROR__ =
      err instanceof Error ? err.stack ?? err.message : String(err);
  }
}

void main();
