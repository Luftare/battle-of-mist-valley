/**
 * Mobile-oriented battery / performance profiler for Mist Valley.
 * Uses puppeteer-core + system Chrome; writes JSON to specs/_profile-raw.json
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "specs", "_profile-raw.json");
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.GAME_URL || "http://127.0.0.1:5174/";

const DEVICES = [
  {
    name: "iPhone14Pro_like",
    viewport: { width: 393, height: 852, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  },
  {
    name: "Pixel7_like",
    viewport: { width: 412, height: 915, deviceScaleFactor: 2.625, isMobile: true, hasTouch: true },
    userAgent:
      "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  },
  {
    name: "desktop_1x",
    viewport: { width: 1280, height: 720, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
    userAgent:
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
];

async function waitForProfile(page, timeoutMs = 30000) {
  await page.waitForFunction(() => window.__AB3D_PROFILE__, { timeout: timeoutMs });
}

async function sampleMetrics(page, durationMs, sampleEveryMs = 250) {
  return page.evaluate(
    async ({ durationMs, sampleEveryMs }) => {
      const p = window.__AB3D_PROFILE__;
      const { engine, game, sceneInstr, engineInstr, canvas } = p;
      const scene = game.scene;
      const samples = [];
      const t0 = performance.now();

      const meshBreakdown = () => {
        const counts = {
          total: scene.meshes.length,
          visible: 0,
          transparent: 0,
          shadows: 0,
          hpBars: 0,
          grass: 0,
          trees: 0,
          rocks: 0,
          other: 0,
        };
        for (const m of scene.meshes) {
          if (m.isVisible && m.visibility > 0) counts.visible++;
          if (m.material?.needAlphaBlending?.() || (m.material?.alpha ?? 1) < 1) {
            counts.transparent++;
          }
          const n = m.name || "";
          if (n.includes("shadow")) counts.shadows++;
          else if (n.includes("hp")) counts.hpBars++;
          else if (n.startsWith("grass_")) counts.grass++;
          else if (n.startsWith("tree_")) counts.trees++;
          else if (n.startsWith("rock_")) counts.rocks++;
          else counts.other++;
        }
        return counts;
      };

      while (performance.now() - t0 < durationMs) {
        const snap = game.getProfileSnapshot();
        const fps = engine.getFps();
        const dt = engine.getDeltaTime();
        const gpuLast = engineInstr.gpuFrameTimeCounter?.lastSecAverage ?? 0;
        const gpuCurrent = engineInstr.gpuFrameTimeCounter?.current ?? 0;
        samples.push({
          t: performance.now() - t0,
          fps,
          deltaMs: dt,
          frameTimeMs: sceneInstr.frameTimeCounter?.lastSecAverage ?? 0,
          renderTimeMs: sceneInstr.renderTimeCounter?.lastSecAverage ?? 0,
          interFrameMs: sceneInstr.interFrameTimeCounter?.lastSecAverage ?? 0,
          activeMeshes: sceneInstr.activeMeshesCounter?.current ?? scene.getActiveMeshes?.()?.length ?? 0,
          drawCalls: sceneInstr.drawCallsCounter?.current ?? 0,
          gpuFrameUsAvg: gpuLast,
          gpuFrameUsCurrent: gpuCurrent,
          canvasCssW: canvas.clientWidth,
          canvasCssH: canvas.clientHeight,
          canvasBufW: canvas.width,
          canvasBufH: canvas.height,
          hardwareScaling: engine.getHardwareScalingLevel(),
          devicePixelRatio: window.devicePixelRatio,
          ...snap,
        });
        await new Promise((r) => setTimeout(r, sampleEveryMs));
      }

      const materials = new Set();
      for (const m of scene.meshes) {
        if (m.material) materials.add(m.material.uniqueId);
      }

      return {
        samples,
        sceneStatic: {
          meshes: meshBreakdown(),
          materials: materials.size,
          lights: scene.lights.length,
          cameras: scene.cameras.length,
          particleSystems: scene.particleSystems.length,
          animations: scene.animationGroups?.length ?? 0,
          fogMode: scene.fogMode,
          clearColor: scene.clearColor?.asArray?.() ?? null,
          antialias: engine.getCaps ? true : null,
          engineDescription: engine.description || null,
          webGLVersion: engine.webGLVersion,
          powerPreference: engine._glContextAttributes?.powerPreference ?? "unknown",
          preserveDrawingBuffer: engine._glContextAttributes?.preserveDrawingBuffer ?? null,
          stencil: engine.isStencilEnable,
          adaptToDeviceRatio: true,
        },
        finalSnapshot: game.getProfileSnapshot(),
      };
    },
    { durationMs, sampleEveryMs },
  );
}

function summarize(samples) {
  if (!samples.length) return null;
  const avg = (key) => samples.reduce((s, x) => s + (x[key] || 0), 0) / samples.length;
  const max = (key) => Math.max(...samples.map((x) => x[key] || 0));
  const min = (key) => Math.min(...samples.map((x) => x[key] || 0));
  const last = samples[samples.length - 1];
  return {
    sampleCount: samples.length,
    fps: { avg: avg("fps"), min: min("fps"), max: max("fps") },
    deltaMs: { avg: avg("deltaMs"), max: max("deltaMs") },
    frameTimeMs: { avg: avg("frameTimeMs"), max: max("frameTimeMs") },
    renderTimeMs: { avg: avg("renderTimeMs"), max: max("renderTimeMs") },
    interFrameMs: { avg: avg("interFrameMs"), max: max("interFrameMs") },
    activeMeshes: { avg: avg("activeMeshes"), max: max("activeMeshes") },
    drawCalls: { avg: avg("drawCalls"), max: max("drawCalls") },
    gpuFrameUsAvg: { avg: avg("gpuFrameUsAvg"), max: max("gpuFrameUsAvg") },
    livingAgents: { last: last.livingAgents, max: max("livingAgents") },
    buildings: { last: last.buildingCount, max: max("buildingCount") },
    particleSystems: { last: last.particleSystems, max: max("particleSystems") },
    resolution: {
      css: `${last.canvasCssW}x${last.canvasCssH}`,
      buffer: `${last.canvasBufW}x${last.canvasBufH}`,
      dpr: last.devicePixelRatio,
      hardwareScaling: last.hardwareScaling,
      pixelFillPerFrame: last.canvasBufW * last.canvasBufH,
    },
  };
}

async function dismissOnboarding(page) {
  await page.waitForSelector("#onboardGo", { timeout: 15000 });
  await page.click("#onboardGo");
  await page.waitForFunction(() => !document.getElementById("onboardingHost"), {
    timeout: 5000,
  });
}

async function forceMidGame(page) {
  // Build full player + AI bases via internal slot iteration if exposed;
  // otherwise click platforms and wait for natural spawn.
  return page.evaluate(async () => {
    const p = window.__AB3D_PROFILE__;
    const scene = p.game.scene;
    // Nudge time by repeatedly setting paused false and waiting;
    // spawn is driven by render loop — wait in wall clock.
    return {
      note: "natural progression",
      meshes: scene.meshes.length,
    };
  });
}

async function profileDevice(browser, device) {
  const page = await browser.newPage();
  await page.setUserAgent(device.userAgent);
  await page.setViewport(device.viewport);
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await waitForProfile(page);

  const results = { device: device.name, viewport: device.viewport, scenarios: {} };

  // Scenario A: onboarding / paused — still rendering
  results.scenarios.paused_onboarding = summarize(
    (await sampleMetrics(page, 4000, 200)).samples,
  );
  results.scenarios.paused_onboarding_static = (
    await page.evaluate(() => {
      const p = window.__AB3D_PROFILE__;
      const scene = p.game.scene;
      let verts = 0;
      let indices = 0;
      for (const m of scene.meshes) {
        verts += m.getTotalVertices?.() || 0;
        indices += m.getTotalIndices?.() || 0;
      }
      return {
        meshes: scene.meshes.length,
        vertices: verts,
        indices,
        materials: scene.materials.length,
        snapshot: p.game.getProfileSnapshot(),
        canvas: {
          css: [p.canvas.clientWidth, p.canvas.clientHeight],
          buffer: [p.canvas.width, p.canvas.height],
          dpr: window.devicePixelRatio,
        },
        engineOpts: {
          antialias: true,
          adaptToDeviceRatio: true,
          preserveDrawingBuffer: true,
          stencil: true,
        },
      };
    })
  );

  await dismissOnboarding(page);
  await new Promise((r) => setTimeout(r, 1500));

  // Scenario B: early play (empty-ish bases)
  const early = await sampleMetrics(page, 5000, 200);
  results.scenarios.early_play = summarize(early.samples);
  results.scenarios.early_play_static = early.sceneStatic;

  // Scenario C: seed mid-combat density, then sample
  const boot = await page.evaluate(() => {
    window.__AB3D_PROFILE__.game.profileBootstrapMidCombat();
    return window.__AB3D_PROFILE__.game.getProfileSnapshot();
  });
  process.stdout.write(
    `  [${device.name}] bootstrapped agents=${boot.livingAgents} buildings=${boot.buildingCount}\n`,
  );
  await new Promise((r) => setTimeout(r, 2500));

  const mid = await sampleMetrics(page, 6000, 200);
  results.scenarios.mid_combat = summarize(mid.samples);
  results.scenarios.mid_combat_static = mid.sceneStatic;
  results.scenarios.mid_combat_final = mid.finalSnapshot;

  // Scenario D: hidden tab (should stop render loop)
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await new Promise((r) => setTimeout(r, 500));
  const hiddenFps = await page.evaluate(async () => {
    const eng = window.__AB3D_PROFILE__.engine;
    const a = eng.getFps();
    await new Promise((r) => setTimeout(r, 1000));
    const b = eng.getFps();
    return { fpsBeforeWait: a, fpsAfter1s: b };
  });
  results.scenarios.tab_hidden = hiddenFps;

  // Restore visibility
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
    document.dispatchEvent(new Event("visibilitychange"));
  });

  // Scenario E: DPR / fill-rate comparison note at current device
  results.fillRate = await page.evaluate(() => {
    const c = window.__AB3D_PROFILE__.canvas;
    const eng = window.__AB3D_PROFILE__.engine;
    return {
      cssPixels: c.clientWidth * c.clientHeight,
      bufferPixels: c.width * c.height,
      dpr: window.devicePixelRatio,
      hardwareScaling: eng.getHardwareScalingLevel(),
      megapixelsPerFrame: (c.width * c.height) / 1e6,
      megapixelsPerSecondAt60: ((c.width * c.height) / 1e6) * 60,
    };
  });

  await forceMidGame(page);
  await page.close();
  return results;
}

async function runTraceSample(browser, device) {
  const page = await browser.newPage();
  await page.setUserAgent(device.userAgent);
  await page.setViewport(device.viewport);
  const client = await page.createCDPSession();
  await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
  await waitForProfile(page);
  await dismissOnboarding(page);
  await new Promise((r) => setTimeout(r, 2000));

  await client.send("Tracing.start", {
    categories: [
      "devtools.timeline",
      "disabled-by-default-devtools.timeline",
      "disabled-by-default-devtools.timeline.frame",
      "disabled-by-default-v8.cpu_profiler",
      "v8.execute",
      "blink.user_timing",
      "disabled-by-default-gpu.device.attribute",
    ].join(","),
    options: "sampling-frequency=1000",
  });

  const events = [];
  client.on("Tracing.dataCollected", (params) => {
    events.push(...params.value);
  });

  await new Promise((r) => setTimeout(r, 5000));
  const tracingComplete = new Promise((resolve) => {
    client.on("Tracing.tracingComplete", resolve);
  });
  await client.send("Tracing.end");
  await tracingComplete;

  // Aggregate GPU / raster / script durations
  let scriptUs = 0;
  let gpuUs = 0;
  let paintUs = 0;
  let compositeUs = 0;
  let rafCount = 0;
  const byName = {};

  for (const e of events) {
    const name = e.name || "";
    byName[name] = (byName[name] || 0) + 1;
    const dur = e.dur || 0;
    if (name === "EvaluateScript" || name === "FunctionCall" || name === "V8.Execute") {
      scriptUs += dur;
    }
    if (name.includes("GPU") || name === "GPUTask") gpuUs += dur;
    if (name === "Paint" || name === "PaintImage") paintUs += dur;
    if (name === "CompositeLayers") compositeUs += dur;
    if (name === "RequestAnimationFrame" || name === "FireAnimationFrame") rafCount++;
  }

  await page.close();
  return {
    device: device.name,
    eventCount: events.length,
    topEvents: Object.entries(byName)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 25),
    totalsUs: { scriptUs, gpuUs, paintUs, compositeUs },
    rafRelatedEvents: rafCount,
  };
}

async function main() {
  console.log("Launching Chrome for battery profiling…");
  console.log("URL:", URL);

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      "--use-gl=angle",
      "--enable-webgl",
      "--ignore-gpu-blocklist",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--js-flags=--expose-gc",
    ],
  });

  const report = {
    collectedAt: new Date().toISOString(),
    url: URL,
    devices: [],
    traces: [],
    notes: [
      "Headless Chrome on desktop approximates mobile DPR/viewport fill-rate; absolute GPU µs differs from real phones.",
      "Relative comparisons (paused vs combat, 1x vs 3x DPR) are the primary signal.",
    ],
  };

  for (const device of DEVICES) {
    console.log(`\n=== Device: ${device.name} ===`);
    try {
      const r = await profileDevice(browser, device);
      report.devices.push(r);
      console.log(JSON.stringify(r.scenarios.mid_combat?.resolution ?? {}, null, 2));
      console.log("FPS mid:", r.scenarios.mid_combat?.fps);
    } catch (err) {
      console.error(`Failed ${device.name}:`, err);
      report.devices.push({ device: device.name, error: String(err) });
    }
  }

  // One CDP trace on the high-DPR phone profile
  console.log("\n=== CDP Trace (iPhone14Pro_like) ===");
  try {
    report.traces.push(await runTraceSample(browser, DEVICES[0]));
  } catch (err) {
    console.error("Trace failed:", err);
    report.traces.push({ error: String(err) });
  }

  await browser.close();
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log("\nWrote", OUT);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
