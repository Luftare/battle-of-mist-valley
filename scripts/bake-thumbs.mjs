/**
 * Offline thumbnail pipeline: opens bake-thumbs.html in Chrome, captures
 * PNG data-URLs, writes them to public/thumbs/*.png
 *
 * Usage:
 *   npm run bake-thumbs              # all models in the registry
 *   npm run bake-thumbs -- tank heli # subset (registry ids)
 *
 * Add a new model: register it in src/thumbs/registry.ts, then re-run this.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT_DIR = path.join(ROOT, "public", "thumbs");
const CHROME =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = Number(process.env.BAKE_PORT || 5199);
const BASE = `http://127.0.0.1:${PORT}`;

/** CLI args after `--` are optional registry ids to bake. */
const ONLY_IDS = process.argv.slice(2).filter((a) => !a.startsWith("-"));

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForServer(url, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 404) return;
    } catch {
      // retry
    }
    await sleep(250);
  }
  throw new Error(`Dev server not ready at ${url}`);
}

function startVite() {
  const child = spawn(
    "npx",
    ["vite", "--host", "127.0.0.1", "--port", String(PORT), "--strictPort"],
    {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    },
  );
  child.stdout.on("data", (d) => process.stdout.write(`[vite] ${d}`));
  child.stderr.on("data", (d) => process.stderr.write(`[vite] ${d}`));
  return child;
}

function dataUrlToBuffer(dataUrl) {
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error("Expected png data-URL");
  return Buffer.from(m[1], "base64");
}

function bakeUrl() {
  if (!ONLY_IDS.length) return `${BASE}/bake-thumbs.html`;
  const q = new URLSearchParams({ ids: ONLY_IDS.join(",") });
  return `${BASE}/bake-thumbs.html?${q}`;
}

async function main() {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  const vite = startVite();
  let browser;
  try {
    await waitForServer(`${BASE}/bake-thumbs.html`);

    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: "new",
      args: [
        "--use-gl=angle",
        "--enable-webgl",
        "--ignore-gpu-blocklist",
        "--no-sandbox",
      ],
    });

    const page = await browser.newPage();
    page.setViewport({ width: 512, height: 512 });
    page.on("console", (m) => console.log(`[page:${m.type()}]`, m.text()));
    page.on("pageerror", (e) => console.error("[pageerror]", e.message));

    const url = bakeUrl();
    console.log(`Baking via ${url}`);
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    await page.waitForFunction(
      () => window.__THUMBS__ || window.__THUMBS_ERROR__,
      { timeout: 120000 },
    );

    const payload = await page.evaluate(() => ({
      thumbs: window.__THUMBS__ || null,
      error: window.__THUMBS_ERROR__ || null,
    }));

    if (payload.error || !payload.thumbs) {
      throw new Error(payload.error || "No thumbs produced");
    }

    const ids = Object.keys(payload.thumbs);
    for (const id of ids) {
      const buf = dataUrlToBuffer(payload.thumbs[id]);
      const out = path.join(OUT_DIR, `${id}.png`);
      fs.writeFileSync(out, buf);
      console.log(`wrote ${path.relative(ROOT, out)} (${buf.length} bytes)`);
    }
    console.log(`Baked ${ids.length} thumbnail(s) → public/thumbs/`);
  } finally {
    if (browser) await browser.close();
    vite.kill("SIGTERM");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
