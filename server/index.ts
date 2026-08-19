import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { attachMatchServer } from "../src/net/attachMatchServer.ts";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
const PORT = Number(process.env.PORT ?? 4173);

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const server = createServer((req, res) => {
  if (!existsSync(dist)) {
    res.statusCode = 503;
    res.end("Run npm run build first.");
    return;
  }
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  let filePath = join(dist, url.pathname === "/" ? "index.html" : url.pathname);
  if (!filePath.startsWith(dist)) {
    res.statusCode = 403;
    res.end();
    return;
  }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, "index.html");
  }
  if (!existsSync(filePath)) {
    filePath = join(dist, "index.html");
  }
  const body = readFileSync(filePath);
  res.setHeader("Content-Type", MIME[extname(filePath)] ?? "application/octet-stream");
  res.end(body);
});

attachMatchServer(server);
server.listen(PORT, () => {
  console.info(`Match server on http://localhost:${PORT}`);
});
