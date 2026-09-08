// Pre-compiles the app's raw JSX into plain JS at deploy time, as TWO bundles.
//
// Previously the browser did this transpile itself on every single page load via
// Babel Standalone (a ~500KB library also downloaded fresh each visit) — on a phone's
// CPU that blocked the page for ~30 seconds with nothing but the background painted,
// since React can't render anything until the JSX has been turned into JS calls.
//
// This script runs once at build/deploy time instead, so visitors download and run
// plain, already-compiled JS with no in-browser compile step and no Babel download.
//
// Only @babel/preset-react is used (not preset-env) so the OUTPUT stays as close to
// the hand-written source as possible — same var/function style, same ES2017+ syntax
// the app already relied on — minimizing the chance of behavior changes. This only
// turns JSX (`<Foo />`) into `React.createElement(...)` calls, nothing else.
//
// The Babel output alone was still shipped completely unminified (~900KB, all comments
// and whitespace intact — app.jsx's own giant literal prompt strings and doc-comments
// make up a lot of that) inside one render-blocking <script> tag that has to finish
// downloading AND executing before React can draw anything. That is the dominant cost
// on a slow mobile connection/CPU, well above what the vendored-locally React/Supabase
// scripts add. Terser minifies the compiled output afterward (safe: it only renames
// locals, drops dead code/comments/whitespace, and does not change runtime semantics)
// to cut the bytes actually sent over the wire and parsed on the device.
//
// ── Why two bundles ────────────────────────────────────────────────────────────
// Minifying app.compiled.js cut the bytes but not the SHAPE of the problem: a
// visitor who had not signed in still had to download and execute the entire
// application — every dashboard, report, admin and checkout screen — before the
// public homepage could paint. Measured, the homepage's own transitive closure is
// 17 of app.jsx's 184 top-level statements, under 6% of the source.
//
//   landing.compiled.js = landing.jsx + landing-shell.jsx   (signed-out first paint)
//   app.compiled.js     = landing.jsx + app.jsx             (the whole application)
//
// app.compiled.js deliberately still CONTAINS the landing surface. It costs a
// signed-in visitor a few KB and buys two things worth much more: the application
// is exactly the program it was before the split (same statements, so its own
// landing route and legal pages still work), and SAYCRD_SINGLE_BUNDLE=1 can fall
// back to a single eager bundle without reverting any code.
//
// Each bundle is wrapped in its own IIFE. landing.jsx's declarations appear in
// both, so at top level the second script to execute would throw
// "Identifier 'X' has already been declared" and take the page down with it.
const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");
const { minify } = require("terser");

const PUBLIC = path.join(__dirname, "..", "public");
const LANDING = path.join(PUBLIC, "landing.jsx");
const LANDING_SHELL = path.join(PUBLIC, "landing-shell.jsx");
const APP = path.join(PUBLIC, "app.jsx");

// Sources always come from public/; only the DESTINATION is overridable. The
// rollback path below deletes a bundle, so the test that proves it works has to
// be able to run it somewhere other than public/ — otherwise verifying rollback
// would mean destroying the real build.
const OUT_DIR = process.env.SAYCRD_OUT_DIR
  ? path.resolve(process.env.SAYCRD_OUT_DIR)
  : PUBLIC;

// One eager bundle containing everything, for rollback: emits no landing bundle,
// so index.html's loader finds nothing to split to and boots the app directly.
const SINGLE_BUNDLE = process.env.SAYCRD_SINGLE_BUNDLE === "1";

const BUNDLES = SINGLE_BUNDLE
  ? [{ out: "app.compiled.js", sources: [LANDING, APP] }]
  : [
      { out: "landing.compiled.js", sources: [LANDING, LANDING_SHELL] },
      { out: "app.compiled.js", sources: [LANDING, APP] },
    ];

async function buildBundle(bundle) {
  const parts = bundle.sources.map(function (src) {
    if (!fs.existsSync(src)) {
      throw new Error("source is missing, refusing to emit a partial bundle: " + path.relative(PUBLIC, src));
    }
    const text = fs.readFileSync(src, "utf8");
    if (!text.trim()) {
      throw new Error("source is empty, refusing to emit a partial bundle: " + path.relative(PUBLIC, src));
    }
    return text;
  });

  const source = parts.join("\n");
  const result = babel.transform(source, {
    filename: path.basename(bundle.out, ".js") + ".jsx",
    presets: [["@babel/preset-react", { development: false }]],
    compact: false,
    babelrc: false,
    configFile: false,
  });

  if (!result || !result.code) {
    throw new Error("Babel produced no output for " + bundle.out);
  }

  let finalCode = result.code;
  try {
    const minified = await minify(result.code, {
      compress: { passes: 1 },
      mangle: true,
      format: { comments: false },
    });
    if (!minified || !minified.code) throw new Error("terser returned no code");
    finalCode = minified.code;
  } catch (e) {
    // If minification ever fails on some future syntax, fail safe by shipping the
    // unminified-but-correct Babel output rather than blocking the whole deploy.
    console.warn("[build] Terser minification failed for " + bundle.out + ", shipping unminified output:", e.message);
  }

  const names = bundle.sources.map(function (s) { return path.basename(s); }).join(" + ");
  const banner = "/* Auto-generated from " + names + " by build/compile.js — do not edit directly. */\n";
  // The IIFE is what lets both bundles share landing.jsx's declarations without
  // colliding at global scope. "use strict" is deliberately NOT added: the source
  // was written and shipped as sloppy-mode script code.
  const wrapped = banner + "(function(){\n" + finalCode + "\n})();\n";
    fs.mkdirSync(OUT_DIR, { recursive: true });
    fs.writeFileSync(path.join(OUT_DIR, bundle.out), wrapped);

  return { out: bundle.out, names: names, raw: result.code.length, min: finalCode.length, total: wrapped.length };
}

async function main() {
  const results = [];
  for (const bundle of BUNDLES) results.push(await buildBundle(bundle));

  if (SINGLE_BUNDLE) {
    // Leaving a stale landing bundle behind would let index.html's loader keep
    // serving the split path from a rollback build.
      const stale = path.join(OUT_DIR, "landing.compiled.js");
      if (fs.existsSync(stale)) {
        fs.unlinkSync(stale);
        console.log("[build] SAYCRD_SINGLE_BUNDLE=1 — removed " + stale);
      }
  }

  for (const r of results) {
    console.log(
      "[build] Compiled " + r.names + " -> public/" + r.out +
      " (" + r.raw + " bytes raw -> " + r.min + " bytes minified)"
    );
  }
}

main().catch(function (e) {
  console.error("[build] " + e.message + " — aborting rather than shipping a broken bundle");
  process.exit(1);
});
