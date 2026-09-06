// TEMPORARY, DISPOSABLE test-only harness for Stage 3 live verification
// (session-persistence-audit). Not part of the shipped app. Deleted at the
// end of the test session. Never committed.
//
// Isolation contract enforced below, in order, BEFORE any route handler is
// imported (so a misconfigured env can never let a real handler touch
// production, even transiently):
//   1. Hard-code the staging URL/ref here (never derived from any
//      ambient env var that could be production-pointed).
//   2. Override process.env.SUPABASE_URL / NEXT_PUBLIC_SUPABASE_URL to that
//      staging URL, and process.env.SUPABASE_SERVICE_ROLE_KEY to
//      STAGING_SUPABASE_SERVICE_ROLE_KEY (the only staging secret this
//      process ever reads). The real SUPABASE_SERVICE_ROLE_KEY
//      (production secret) is never read or forwarded.
//   3. Assert the resulting URL string neither contains the production
//      ref nor omits the staging ref. Abort (process.exit(1)) otherwise.
//   4. Only after that assertion passes do we dynamically import the real,
//      unmodified route handlers from ../api/*.js.
const PROD_REF = "lydamoxkymwuccepeeyz";
const STAGING_REF = "lbydmtgeojnozzhwsava";
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

if (!process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[isolation-guard] STAGING_SUPABASE_SERVICE_ROLE_KEY is not set. Aborting.");
  process.exit(1);
}

process.env.SUPABASE_URL = STAGING_URL;
process.env.NEXT_PUBLIC_SUPABASE_URL = STAGING_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;

function assertStagingOnly(label, url) {
  if (typeof url !== "string" || url.includes(PROD_REF) || !url.includes(STAGING_REF)) {
    console.error(`[isolation-guard] ABORT: ${label} does not resolve to staging (got: ${JSON.stringify(url)}).`);
    process.exit(1);
  }
}
assertStagingOnly("SUPABASE_URL", process.env.SUPABASE_URL);
assertStagingOnly("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
console.log("[isolation-guard] OK — this process is pinned to staging:", STAGING_URL);

// Only now import real handlers (they call getServiceClient() lazily, which
// reads the now-overridden env at first use — verified again below).
const { getServiceClient } = await import("./_lib.js");
const sb = getServiceClient();
assertStagingOnly("getServiceClient().supabaseUrl", sb.supabaseUrl);
console.log("[isolation-guard] OK — live Supabase client confirmed pointed at staging:", sb.supabaseUrl);

const sessionsHandler = (await import("./sessions.js")).default;
const sessionCompleteHandler = (await import("./session-complete.js")).default;
const reportsHandler = (await import("./reports.js")).default;
const capturesHandler = (await import("./captures.js")).default;
const bookmarksHandler = (await import("./bookmarks.js")).default;
// claude.js never touches Supabase (only ANTHROPIC_API_KEY) -- included
// purely so the real guided-session flow can progress through the app's
// AI synthesis step during this test, same as production.
const claudeHandler = (await import("./claude.js")).default;

const ROUTES = {
  "/api/sessions": sessionsHandler,
  "/api/session-complete": sessionCompleteHandler,
  "/api/reports": reportsHandler,
  "/api/captures": capturesHandler,
  "/api/bookmarks": bookmarksHandler,
  "/api/claude": claudeHandler,
};

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");
const PORT = Number(process.env.TEST_PORT || 4180);

const CONTENT_TYPES = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml" };

function serveStatic(req, res, pathname) {
  // The staging-test index.html (with staging config + inline abort guard)
  // is served from this SAME temp/isolated location, not from the real
  // tracked public/index.html (which still hardcodes production creds).
  let filePath;
  if (pathname === "/" || pathname === "/index.html") {
    filePath = path.join(__dirname, ".tmp-live-test-index.html");
  } else {
    filePath = path.join(PUBLIC_DIR, pathname);
  }
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end("not found"); return; }
    const ext = path.extname(filePath);
    res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] || "application/octet-stream" });
    res.end(data);
  });
}

function shim(req, res) {
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  req.query = Object.fromEntries(parsed.searchParams.entries());
  res.status = function (code) { res.statusCode = code; return res; };
  res.json = function (obj) {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(obj));
    return res;
  };
  return parsed.pathname;
}

const server = http.createServer((req, res) => {
  const pathname = shim(req, res);
  const routeHandler = ROUTES[pathname];
  if (!routeHandler) return serveStatic(req, res, pathname);

  if (req.method === "GET" || req.method === "DELETE" || req.method === "OPTIONS") {
    req.body = {};
    return routeHandler(req, res);
  }
  let raw = "";
  req.on("data", (chunk) => { raw += chunk; });
  req.on("end", () => {
    try { req.body = raw ? JSON.parse(raw) : {}; } catch (e) { req.body = {}; }
    routeHandler(req, res);
  });
});

server.listen(PORT, () => {
  console.log(`[isolation-guard] Test server listening on http://localhost:${PORT} (staging-only, ${STAGING_REF})`);
});
