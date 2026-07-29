export { bakeThumbnails, THUMB_VIEW, type BakeThumbnailsOpts } from "./bakeThumbnails";
export {
  THUMB_REGISTRY,
  getThumbDef,
  resolveThumbDefs,
  type ThumbDef,
  type ThumbHandle,
} from "./registry";
export { THUMB_IDS, type ThumbId, type ThumbMap } from "./types";

import type { ThumbId, ThumbMap } from "./types";
import { THUMB_IDS } from "./types";

/** Static PNGs produced by `npm run bake-thumbs`. */
export function thumbUrl(id: ThumbId | string): string {
  return `/thumbs/${id}.png`;
}

/** Map of all baked thumb URLs for the HUD. */
export function staticThumbMap(): ThumbMap {
  const map: ThumbMap = {};
  for (const id of THUMB_IDS) {
    map[id as ThumbId] = thumbUrl(id);
  }
  return map;
}
