// dev-server.mjs
//
// Minimal zero-dependency dev server for the v0 sandbox preview.
//
// On Vercel, this project's "Root Directory" is set to `saycrd-repo/`, so
// Vercel builds/serves `saycrd-repo/public` as the static site and
// `saycrd-repo/api/*.js` as serverless functions automatically. The v0
// sandbox preview doesn't know about that project setting — it just runs
// `pnpm install`/dev from the actual repo root, where there is no
// package.json. This server recreates that same behavior locally so the
// preview works: it serves `saycrd-repo/public` as static files and proxies
// `/api/<name>` requests to `saycrd-repo/api/<name>.js`, using the same
// (req, res) handler signature Vercel serverless functions use.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "saycrd-repo", "public");
const apiDir = path.join(__dirname, "saycrd-repo", "api");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".jsx": "text/babel",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".map": "application/json",
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// Buffers the raw body once, stashes it on req.rawBody for handlers that
// need the untouched bytes (e.g. webhook signature verification), and also
// returns it parsed as JSON for handlers that just want req.body — mirroring
// how Vercel's Node runtime exposes both without double-reading the stream.
async function readJsonBody(req) {
  const raw = await readRawBody(req);
  req.rawBody = raw;
  if (!raw) return {};
  return JSON.parse(raw);
}

function withVercelResShim(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (obj) => {
    if (!res.getHeader("Content-Type")) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
    }
    res.end(JSON.stringify(obj));
    return res;
  };
  return res;
}

async function handleApi(req, res, pathname) {
  const name = pathname.replace(/^\/api\//, "").split("/")[0];
  const modPath = path.join(apiDir, `${name}.js`);

  if (!fs.existsSync(modPath)) {
    res.statusCode = 404;
    res.end("Not found");
    return;
  }

  withVercelResShim(res);

  try {
    req.body =
      req.method === "POST" || req.method === "PUT"
        ? await readJsonBody(req)
        : undefined;
  } catch {
    res.status(400).json({ error: "Invalid JSON body" });
    return;
  }

  try {
    // Cache-bust so edits to the handler are picked up without restarting.
    const mod = await import(`${modPath}?t=${Date.now()}`);
    const handler = mod.default;
    await handler(req, res);
  } catch (err) {
    console.error("[dev-server] API handler error:", err);
    if (!res.writableEnded) {
      res.status(500).json({ error: "Internal error: " + err.message });
    }
  }
}

function handleStatic(req, res, pathname) {
  let filePath = path.join(publicDir, decodeURIComponent(pathname));

  const isMissingOrDir =
    pathname === "/" ||
    !fs.existsSync(filePath) ||
    fs.statSync(filePath).isDirectory();

  if (isMissingOrDir) {
    filePath = path.join(publicDir, "index.html");
  }

  const ext = path.extname(filePath);
  const contentType = MIME[ext] || "application/octet-stream";

  try {
    const content = fs.readFileSync(filePath);
    res.setHeader("Content-Type", contentType);
    res.statusCode = 200;
    res.end(content);
  } catch (err) {
    res.statusCode = 404;
    res.end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");

    if (req.method === "OPTIONS") {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
      );
      res.statusCode = 200;
      res.end();
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url.pathname);
      return;
    }

    handleStatic(req, res, url.pathname);
  } catch (err) {
    console.error("[dev-server]", err);
    res.statusCode = 500;
    res.end("Internal Server Error: " + err.message);
  }
});

const port = process.env.PORT || 3000;
server.listen(port, () => {
  console.log(`[v0] Dev server (mirrors Vercel "saycrd-repo" root) running on port ${port}`);
});
