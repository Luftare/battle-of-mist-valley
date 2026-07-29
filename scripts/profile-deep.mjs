/**
 * Deep CPU/GPU frame breakdown + static scene inventory.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, "..", "specs", "_profile-deep.json");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const URL = process.env.GAME_URL || "http://127.0.0.1:5174/";

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ["--use-gl=angle", "--enable-webgl", "--ignore-gpu-blocklist", "--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({
    width: 393,
    height: 852,
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await page.goto(URL, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => window.__AB3D_PROFILE__);

  const pausedInventory = await page.evaluate(() => {
    const { engine, game, canvas } = window.__AB3D_PROFILE__;
    const scene = game.scene;
    const byPrefix = {};
    let verts = 0;
    let indices = 0;
    let alphaMeshes = 0;
    let disabledLighting = 0;
    for (const m of scene.meshes) {
      const n = m.name || "unnamed";
      const prefix = n.split("_")[0];
      byPrefix[prefix] = (byPrefix[prefix] || 0) + 1;
      verts += m.getTotalVertices?.() || 0;
      indices += m.getTotalIndices?.() || 0;
      const mat = m.material;
      if (mat) {
        if (mat.needAlphaBlending?.() || mat.alpha < 1 || mat.transparencyMode === 2) {
          alphaMeshes++;
        }
        if (mat.disableLighting) disabledLighting++;
      }
    }
    return {
      meshCount: scene.meshes.length,
      transformNodes: scene.transformNodes.length,
      materials: scene.materials.length,
      textures: scene.textures.length,
      lights: scene.lights.length,
      particles: scene.particleSystems.length,
      verts,
      indices,
      trianglesApprox: indices / 3,
      alphaMeshes,
      disabledLighting,
      byPrefix,
      canvas: {
        css: [canvas.clientWidth, canvas.clientHeight],
        buffer: [canvas.width, canvas.height],
        dpr: window.devicePixelRatio,
        hwScale: engine.getHardwareScalingLevel(),
      },
      snapshot: game.getProfileSnapshot(),
    };
  });

  // Timed frame instrumentation with Performance marks around render
  const pausedFrameCost = await page.evaluate(async () => {
    const { engine, game, sceneInstr, engineInstr } = window.__AB3D_PROFILE__;
    const samples = [];
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      samples.push({
        fps: engine.getFps(),
        frameMs: sceneInstr.frameTimeCounter?.lastSecAverage ?? 0,
        renderMs: sceneInstr.renderTimeCounter?.lastSecAverage ?? 0,
        activeMeshes: sceneInstr.activeMeshesCounter?.current ?? 0,
        drawCalls: sceneInstr.drawCallsCounter?.current ?? 0,
        gpuUs: engineInstr.gpuFrameTimeCounter?.lastSecAverage ?? 0,
        particles: game.getProfileSnapshot().particleSystems,
      });
    }
    const avg = (k) => samples.reduce((s, x) => s + x[k], 0) / samples.length;
    return {
      n: samples.length,
      fps: avg("fps"),
      frameMs: avg("frameMs"),
      renderMs: avg("renderMs"),
      activeMeshes: avg("activeMeshes"),
      drawCalls: avg("drawCalls"),
      gpuUs: avg("gpuUs"),
    };
  });

  await page.click("#onboardGo");
  await page.waitForFunction(() => !document.getElementById("onboardingHost"));
  await page.evaluate(() => window.__AB3D_PROFILE__.game.profileBootstrapMidCombat());
  await new Promise((r) => setTimeout(r, 3000));

  const combatInventory = await page.evaluate(() => {
    const { game } = window.__AB3D_PROFILE__;
    const scene = game.scene;
    const byPrefix = {};
    let verts = 0;
    let indices = 0;
    let alphaMeshes = 0;
    for (const m of scene.meshes) {
      const n = m.name || "unnamed";
      const prefix = n.split("_")[0];
      byPrefix[prefix] = (byPrefix[prefix] || 0) + 1;
      verts += m.getTotalVertices?.() || 0;
      indices += m.getTotalIndices?.() || 0;
      const mat = m.material;
      if (mat && (mat.needAlphaBlending?.() || mat.alpha < 1 || mat.transparencyMode === 2)) {
        alphaMeshes++;
      }
    }
    return {
      meshCount: scene.meshes.length,
      transformNodes: scene.transformNodes.length,
      materials: scene.materials.length,
      textures: scene.textures.length,
      particles: scene.particleSystems.length,
      verts,
      indices,
      trianglesApprox: indices / 3,
      alphaMeshes,
      byPrefix,
      snapshot: game.getProfileSnapshot(),
    };
  });

  const combatFrameCost = await page.evaluate(async () => {
    const { engine, game, sceneInstr, engineInstr } = window.__AB3D_PROFILE__;
    const samples = [];
    for (let i = 0; i < 180; i++) {
      await new Promise((r) => requestAnimationFrame(r));
      samples.push({
        fps: engine.getFps(),
        frameMs: sceneInstr.frameTimeCounter?.lastSecAverage ?? 0,
        renderMs: sceneInstr.renderTimeCounter?.lastSecAverage ?? 0,
        activeMeshes: sceneInstr.activeMeshesCounter?.current ?? 0,
        drawCalls: sceneInstr.drawCallsCounter?.current ?? 0,
        gpuUs: engineInstr.gpuFrameTimeCounter?.lastSecAverage ?? 0,
        particles: game.getProfileSnapshot().particleSystems,
        agents: game.getProfileSnapshot().livingAgents,
      });
    }
    const avg = (k) => samples.reduce((s, x) => s + x[k], 0) / samples.length;
    const max = (k) => Math.max(...samples.map((x) => x[k]));
    return {
      n: samples.length,
      fps: avg("fps"),
      frameMs: avg("frameMs"),
      renderMs: avg("renderMs"),
      activeMeshes: avg("activeMeshes"),
      drawCalls: avg("drawCalls"),
      gpuUs: avg("gpuUs"),
      agents: avg("agents"),
      particlesMax: max("particles"),
    };
  });

  // Hardware scaling experiment: what if we rendered at 1x / 0.5x effective?
  const scalingExperiment = await page.evaluate(async () => {
    const { engine, sceneInstr, engineInstr, game } = window.__AB3D_PROFILE__;
    const canvas = window.__AB3D_PROFILE__.canvas;
    const results = [];
    for (const scale of [1, 0.5, 0.333333, 0.25]) {
      engine.setHardwareScalingLevel(scale);
      engine.resize();
      await new Promise((r) => setTimeout(r, 800));
      const samples = [];
      for (let i = 0; i < 90; i++) {
        await new Promise((r) => requestAnimationFrame(r));
        samples.push({
          fps: engine.getFps(),
          frameMs: sceneInstr.frameTimeCounter?.lastSecAverage ?? 0,
          renderMs: sceneInstr.renderTimeCounter?.lastSecAverage ?? 0,
          drawCalls: sceneInstr.drawCallsCounter?.current ?? 0,
          gpuUs: engineInstr.gpuFrameTimeCounter?.lastSecAverage ?? 0,
        });
      }
      const avg = (k) => samples.reduce((s, x) => s + x[k], 0) / samples.length;
      results.push({
        hardwareScaling: scale,
        buffer: [canvas.width, canvas.height],
        megapixels: (canvas.width * canvas.height) / 1e6,
        fps: avg("fps"),
        frameMs: avg("frameMs"),
        renderMs: avg("renderMs"),
        drawCalls: avg("drawCalls"),
        gpuUs: avg("gpuUs"),
        agents: game.getProfileSnapshot().livingAgents,
      });
    }
    // restore adapt-to-device default
    engine.setHardwareScalingLevel(1 / window.devicePixelRatio);
    engine.resize();
    return results;
  });

  // Count per-frame JS work proxies: getAbsolutePosition / material churn via Performance
  const jsHotPath = await page.evaluate(async () => {
    const { game } = window.__AB3D_PROFILE__;
    const scene = game.scene;
    // Monkey-patch getAbsolutePosition temporarily
    let absPosCalls = 0;
    const proto = scene.getEngine().getRenderingCanvas().ownerDocument.defaultView;
    // Patch TransformNode via first mesh parent chain
    const sampleNode = scene.meshes[0];
    const TN = Object.getPrototypeOf(sampleNode);
    const orig = TN.getAbsolutePosition;
    TN.getAbsolutePosition = function (...args) {
      absPosCalls++;
      return orig.apply(this, args);
    };
    await new Promise((r) => requestAnimationFrame(r));
    await new Promise((r) => requestAnimationFrame(r));
    const callsPerFrame = absPosCalls / 2;
    TN.getAbsolutePosition = orig;
    return { getAbsolutePositionCallsApproxPerFrame: callsPerFrame };
  });

  // Check continuous animations while paused
  const pausedStillAnimating = await page.evaluate(async () => {
    const { game } = window.__AB3D_PROFILE__;
    game.setPaused(true);
    const scene = game.scene;
    const grass = scene.transformNodes.filter((n) => n.name?.startsWith("grass_"));
    const a = grass[0] ? { x: grass[0].rotation.x, z: grass[0].rotation.z } : null;
    await new Promise((r) => setTimeout(r, 500));
    const b = grass[0] ? { x: grass[0].rotation.x, z: grass[0].rotation.z } : null;
    game.setPaused(false);
    return {
      grassCount: grass.length,
      rotationChangedWhilePaused: a && b ? a.x !== b.x || a.z !== b.z : null,
      before: a,
      after: b,
    };
  });

  const report = {
    collectedAt: new Date().toISOString(),
    pausedInventory,
    pausedFrameCost,
    combatInventory,
    combatFrameCost,
    scalingExperiment,
    jsHotPath,
    pausedStillAnimating,
  };

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
