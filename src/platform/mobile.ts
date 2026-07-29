import type { Engine } from "@babylonjs/core";

/** Cap retina fill rate on phones/tablets (see specs/battery-profile.md). */
export const MOBILE_MAX_DPR = 1.5;

/** Target render rate on mobile — halves work vs uncapped 120 Hz panels. */
export const MOBILE_TARGET_FPS = 30;

export function isMobileDevice(): boolean {
  if (typeof window === "undefined") return false;
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  const narrow = window.matchMedia("(max-width: 900px)").matches;
  return coarse || narrow;
}

/** After `engine.resize()`, keep backing-store pixels ≤ CSS × MOBILE_MAX_DPR. */
export function applyMobilePixelCap(engine: Engine): void {
  if (!isMobileDevice()) return;
  const dpr = Math.min(window.devicePixelRatio, MOBILE_MAX_DPR);
  engine.setHardwareScalingLevel(1 / dpr);
}
