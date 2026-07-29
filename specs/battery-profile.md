# Mobile battery drain — profiling report

**Date:** 2026-07-29  
**Product:** Mist Valley (auto-battler-3d), Babylon.js WebGL  
**Goal:** Identify what drains battery on mobile. No code fixes in this pass — findings and recommendations only.

Raw measurement dumps (supporting evidence):

- `specs/_profile-raw.json` — multi-device scenario samples + CDP timeline
- `specs/_profile-deep.json` — mesh inventory, frame costs, resolution scaling experiment
- `scripts/profile-battery.mjs`, `scripts/profile-deep.mjs` — reproducible Chrome/puppeteer harness

---

## Executive summary

Battery drain is dominated by **keeping the GPU and CPU busy every display refresh**, not by a single exotic effect.

The three largest contributors, in order of expected real-phone impact:

1. **Uncapped `requestAnimationFrame` render loop** — runs at the display refresh rate (often **120 Hz** on modern phones). There is no FPS cap.
2. **Native device-pixel rendering** via `adaptToDeviceRatio: true` — on an iPhone 14 Pro–class viewport this paints ~**3.0 megapixels every frame** (~181 MP/s at 60 Hz, ~**362 MP/s at 120 Hz**), with **MSAA antialiasing** enabled.
3. **Draw-call / mesh explosion** — hundreds of separate box meshes with no merging or instancing. Empty arena already ~**850 meshes / ~333 draw calls**; mid-combat (72 units, full bases) ~**3,170 meshes / ~1,300 draw calls** in the phone frustum (up to ~2,700 when more of the map is visible).

Secondary but material: continuous meadow animation + blob-shadow updates, alpha-blended shadows, lit `StandardMaterial` on almost everything, O(n²) unit separation/AI queries as armies grow, and full rendering during the paused onboarding screen.

---

## Methodology

### Tools

| Tool | Use |
|------|-----|
| Chrome (puppeteer-core) + mobile viewport / DPR emulation | Approximate phone CSS size and backing-store resolution |
| Babylon `SceneInstrumentation` / `EngineInstrumentation` | Frame time, render time, draw calls, GPU frame counter |
| Chrome DevTools Protocol `Tracing` | AnimationFrame / GPUTask / script activity over 5 s |
| Static code review | Engine options, render loop, terrain/unit update paths |

### Scenarios

| Scenario | Setup |
|----------|--------|
| Paused onboarding | Game `setPaused(true)`, tip overlay visible — **render loop still running** |
| Early play | Unpaused, mostly empty platforms |
| Mid-combat | Bootstrap: 20 buildings + 72 living units (dense but plausible late game) |
| Resolution sweep | Same combat scene at hardware scaling 1 / 0.5 / 0.33 / 0.25 |
| Devices | iPhone 14 Pro–like (393×852 @3×), Pixel 7–like (412×915 @2.625×), desktop 1280×720 @1× |

### Caveats

- Measurements ran in **headless Chrome on a desktop GPU**. Absolute GPU microseconds are not phone watts; **relative** ratios (paused→combat, 1×→3× pixels, draw-call growth) are the signal.
- Headless often stayed near **120 FPS** even under load (CPU/draw-call bound on the host). On a real mobile GPU, fill rate + MSAA + alpha blending will hurt more than these numbers show.
- Mid-combat was **seeded** for density; natural matches may be lighter early and heavier with wrecks/particles later.

---

## Measured results

### Backing store / fill rate (iPhone 14 Pro–like)

| Metric | Value |
|--------|------:|
| CSS size | 393 × 852 |
| Canvas buffer (`adaptToDeviceRatio`) | **1179 × 2556** |
| Pixels / frame | **3.01 MP** |
| At 60 FPS | ~181 MP/s |
| At 120 FPS (ProMotion-class) | ~**362 MP/s** |

Pixel 7–like: **2.60 MP/frame**. Desktop 1×: **0.92 MP/frame**.

### Frame cost (iPhone-like, Babylon instrumentation)

| Scenario | FPS (avg) | Frame time (avg) | Render time (avg) | Draw calls (avg) |
|----------|----------:|-----------------:|------------------:|-----------------:|
| Paused onboarding | ~120 | ~2.2–2.7 ms | ~0.9–1.3 ms | **~333** |
| Early play | ~120 | ~2.1 ms | ~0.85 ms | ~360–370 |
| Mid-combat (72 agents) | ~117–120 | **~7.6–8.0 ms** | **~3.1–3.3 ms** | **~1,300** |

Paused→combat: frame time **~3×**, draw calls **~4×**. The game is already spending meaningful CPU/GPU **before any units exist**.

Desktop mid-combat saw **~2,700 draw calls** and **~85 FPS / ~11 ms** frames — more of the map stays in view, confirming **draw-call cost scales with visible mesh count**.

### Scene inventory

| State | Meshes | Materials | Verts (approx) | Alpha-blended meshes |
|-------|-------:|----------:|---------------:|---------------------:|
| Empty / paused | **850** | 125 | 24k | ~25 |
| Mid-combat | **~3,170** | **~1,070** | 81k | ~170 |

Idle mesh breakdown (representative):

- Grass blades alone: **280** meshes (70 tufts × 4 boxes)
- Trees: **~114** meshes (+ blob shadows)
- Blue/red pads & turrets: **~450** meshes before any army

Combat adds ~12–28 meshes per unit (rifleman ~12 boxes + shadow + HP bar; tank/heli higher) with **no mesh merging**.

### Resolution experiment (same combat scene)

Babylon `hardwareScalingLevel` (lower = sharper / more pixels):

| Scale | Buffer | Megapixels | Render time (avg) | GPU counter (relative) |
|------:|--------|----------:|------------------:|-----------------------:|
| 1.0 | 393×852 | 0.33 | ~3.17 ms | baseline |
| 0.5 | 786×1704 | 1.34 | ~3.25 ms | ~same |
| **0.33 (current DPR)** | **1179×2556** | **3.01** | ~3.44 ms | higher |
| 0.25 | 1572×3408 | 5.36 | ~3.30 ms | **~2× GPU counter** |

On the desktop headless GPU, **CPU/draw calls dominate** until resolution is extreme. On phones, the 0.33→native path is the production default and will consume far more GPU energy than 1.0 (CSS pixels only).

### CDP timeline (5 s, early combat, iPhone-like)

Dominant event classes: `RunTask`, `GPUTask`, compositor frame pipeline, **`AnimationFrame` (~2.3k)**. Script time and GPU tasks both heavy — consistent with a always-on WebGL game loop, not occasional UI work.

### Visibility / pause behavior (code + observation)

- `visibilitychange` → `engine.stopRenderLoop()` when `document.hidden` — **good** for background tabs.
- `setPaused(true)` **does not stop rendering**. Onboarding still calls `scene.render()` every frame (~333 draw calls).
- While paused, sim time (`elapsed`) freezes, so grass sway holds still — but the **GPU still clears/draws the full scene** every rAF.

---

## Root causes (ranked)

### 1. Uncapped render loop at display refresh — **Critical**

```23:25:src/main.ts
engine.runRenderLoop(() => {
  game.scene.render();
});
```

No `engine.setHardwareScalingLevel` budget, no max FPS, no “render every Nth frame”. On 120 Hz phones this roughly **doubles** continuous GPU/CPU work versus 60 Hz for the same visual content.

**Why it drains battery:** Mobile SoCs cannot deep-sleep the GPU; sustained 120 Hz WebGL is one of the highest browser power states.

### 2. Full device-pixel ratio + MSAA — **Critical**

```10:14:src/main.ts
const engine = new Engine(canvas, true, {
  preserveDrawingBuffer: true,
  stencil: true,
  adaptToDeviceRatio: true,
});
```

- Second argument `true` → **antialias (MSAA)**.
- `adaptToDeviceRatio: true` → backing store = CSS × DPR (measured **3×** on Pro-class).

**Why it drains battery:** Fill rate and bandwidth scale with pixel count; MSAA multiplies fragment work. 3 MP × MSAA × 120 Hz is a thermal/battery worst case for a stylized low-poly game.

### 3. One draw call per box (no batching) — **Critical**

Units, grass, buildings, platforms, HP bars, and shadows are individual `MeshBuilder` meshes. Materials are mostly shared via `colorMat`, but **geometry is not merged or instanced**.

Measured: **~333 draw calls with zero units**, **~1,300+** in phone-frustum combat.

**Why it drains battery:** Each draw call burns CPU (Babylon scene graph, GL state) and keeps the GPU scheduling work even when triangle counts are modest (~12k–43k tris).

### 4. Always-on meadow “life” + blob shadows — **High**

Terrain update every frame (even contributing when unpaused):

- 70 grass tufts: rotation every frame  
- Standing trees: subtle sway + **`shadow.update()` every frame**  
- Rocks: tiny Y bob  

Blob shadows use **alpha blending** (`transparencyMode = ALPHA_BLEND`) — expensive on mobile tile-based GPUs (extra bandwidth, order-dependent passes). Mid-combat: **~117 shadow meshes**, **~170** alpha meshes total.

### 5. Full render while “paused” (onboarding) — **High**

Users staring at the tip screen still pay **~333 draw calls / full 3 MP buffer / uncapped FPS**. Perceived idle ≠ engine idle.

### 6. Combat simulation CPU scales poorly — **Medium–High (late game)**

Per frame with *n* agents (see `createGameWorld.ts`):

- `neighborSeparation` — O(n) per moving agent → overall **O(n²)**  
- `resolveUnitSeparation` — pairwise **O(n²)**  
- Target acquisition loops over agents/buildings/turrets  
- Every living unit: animation update, ground height sample, HP bar billboard (`getAbsolutePosition` + aim at camera)

Frame time rose from ~2.5 ms (empty) to **~7.6 ms** (72 agents) in instrumentation — mostly CPU/scene overhead before phone GPU limits kick in.

### 7. Material / object churn — **Medium**

- HP bars allocate **unique materials per bar** (`createHpBar`) → material count **~1,070** mid-combat.  
- Coin popups / explosions / tracers allocate meshes + materials dynamically.  
- Wreck smoke uses `ParticleSystem` (up to 120 particles, continuous) when units/buildings die — not dominant in the seeded mid sample (0 systems) but will spike during attrition.

### 8. Lighting model — **Medium**

Two lights (`HemisphericLight` + `DirectionalLight`) with lit `StandardMaterial` on most meshes. Cheap vs PBR, but still per-fragment lighting × mesh count. Many UI-like meshes (HP, shadows, flashes) correctly disable lighting; the meadow and units do not.

### 9. Engine flags that hinder GPU efficiency — **Low–Medium**

- `preserveDrawingBuffer: true` — often unnecessary for games; can block some compositor/GPU optimizations and increase memory traffic.  
- `stencil: true` — extra attachment cost if unused.  
- No `powerPreference: "low-power"` (or adaptive preference).

### 10. DOM / CSS — **Low**

HUD is light. Onboarding has a few infinite CSS animations (`onboard-glow-pulse`, button breathe). Negligible next to WebGL.

---

## What is *not* the main problem

- Triangle count alone (~12k idle / ~43k combat) is modest for 3D; **draw calls and resolution** hurt more than poly count.  
- No shadow maps / post-process stack / heavy PBR — good.  
- Tab-hide stop of the render loop is implemented (helpful when leaving the tab).  
- Fog is cheap linear fog.

---

## Recommendations (priority order)

Do not implement here — suggested order for a follow-up battery pass:

### P0 — Cap work rate

1. **Cap FPS to 30 on mobile** (or 30 battery / 60 “quality”). Use a frame accumulator or Babylon’s rendering throttle patterns so ProMotion cannot run the game at 120 Hz.
2. **Stop the render loop while paused** (onboarding / end screen), or render at 10–15 FPS with static content. Resume on dismiss.
3. **Respect `visibilitychange`** (already present) and also pause on `pagehide` / low-power if available.

### P0 — Cut pixels

4. **Disable or soften `adaptToDeviceRatio` on mobile** — e.g. render at CSS size, or `min(dpr, 1.5)` / `1.75` max. Target ≤ ~1.0–1.5 MP/frame.
5. **Turn off MSAA on mobile** (`new Engine(canvas, false, …)` or dynamic). Low-poly style rarely needs it; FXAA-at-30fps or none is enough.
6. Set `preserveDrawingBuffer: false` unless a screenshot feature needs it.

### P1 — Cut draw calls

7. **Merge or thin-instance** grass (single mesh / buffer with per-instance phases).  
8. **Merge static prop meshes** (tree canopies, rock clusters, platform kits) after build.  
9. **Instancing** for repeated unit parts or at least merge per-unit rigid groups.  
10. Share **two HP-bar materials** globally instead of per-instance materials.  
11. Consider a single ground-projected **shadow atlas / decal** instead of hundreds of alpha ground planes.

### P1 — Idle & sim thrift

12. **Distance / LOD**: stop animating grass/trees outside a radius or when off-camera; update tree shadows every N frames.  
13. **Spatial hash** for separation / targeting to avoid O(n²).  
14. Throttle AI / non-visible unit animation to 10–20 Hz.  
15. Hide or simplify HP bars beyond a distance; update billboards every other frame.

### P2 — Combat FX budget

16. Cap concurrent particle systems / explosion debris.  
17. Pool bullet traces and coin labels; avoid per-popup `DynamicTexture` where a shared font atlas works.  
18. Optional “Battery saver” UI: 30 FPS, no MSAA, 1× pixel ratio, reduced grass count.

### Validation plan (after fixes)

Re-run `scripts/profile-battery.mjs` / `profile-deep.mjs` and track:

| KPI | Current (phone-like) | Target suggestion |
|-----|---------------------:|------------------:|
| Buffer megapixels | ~3.0 | ≤ 1.0–1.5 |
| FPS while playing | uncapped (~120 host) | **30** (or 60 max) |
| Draw calls (empty) | ~333 | ≤ 80–120 |
| Draw calls (72 units) | ~1,300 | ≤ 250–400 |
| Frame time empty | ~2.5 ms | lower + fewer wakes |
| Paused onboarding | full render | **0 FPS** or ≤ 15 |

On-device: Safari/Chrome remote inspect + iOS Energy gauge / Android `dumpsys batterystats` for before/after.

---

## Code anchors (quick reference)

| Area | Location |
|------|----------|
| Engine + rAF loop | `src/main.ts` |
| Per-frame sim | `src/game/createGameWorld.ts` (`onBeforeRenderObservable`) |
| Meadow animation / shadows | `src/terrain/createTerrain.ts` (`update`) |
| Blob shadows (alpha) | `src/units/shadow.ts` |
| Unit mesh density | `src/units/*.ts`, `src/theme/materials.ts` |
| HP bar materials | `src/game/hpBar.ts` |
| Particles | `src/fx/wreckSmoke.ts`, `src/fx/explosion.ts` |

---

## Bottom line

The game feels “always hot” on mobile because it **renders a retina-resolution, MSAA WebGL framebuffer at the panel’s full refresh rate**, while submitting **hundreds to thousands of tiny draw calls** every frame — including on the paused welcome screen. Combat then multiplies mesh/CPU cost. Lowering resolution × refresh rate and batching meshes will move the needle far more than polishing individual unit animations.
