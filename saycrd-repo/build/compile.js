// Pre-compiles public/app.jsx (raw JSX, ~11k lines) into plain JS at deploy time.
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
const fs = require("fs");
const path = require("path");
const babel = require("@babel/core");

const SRC = path.join(__dirname, "..", "public", "app.jsx");
const OUT = path.join(__dirname, "..", "public", "app.compiled.js");

const source = fs.readFileSync(SRC, "utf8");

const result = babel.transform(source, {
filename: "app.jsx",
presets: [["@babel/preset-react", { development: false }]],
compact: false,
babelrc: false,
configFile: false,
});

if (!result || !result.code) {
console.error("[build] Babel produced no output — aborting to avoid shipping a broken app.compiled.js");
process.exit(1);
}

const banner = "/* Auto-generated from app.jsx by build/compile.js — do not edit directly. */\n";
fs.writeFileSync(OUT, banner + result.code + "\n");
console.log("[build] Compiled public/app.jsx -> public/app.compiled.js (" + result.code.length + " bytes)");
