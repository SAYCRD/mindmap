'use strict';

// Stage 2: the signed-out homepage is in the HTML.
//
// Stage 0 (immutable caching) and Stage 1 (the landing/app bundle split) both cut
// BYTES, and both worked -- 253KB -> ~65KB before paint, 7 round trips -> 2. The
// phone was still slow, because neither touched the actual shape of the problem:
//
//   the homepage did not exist until JavaScript built it.
//
// Measured on production (ccbb22f), served HTML was 47KB but only 820 characters
// of it were text -- and that text was the HIDDEN auth overlay, not the homepage.
// The <h1> ("The space between your inner world...") was not in the document at
// all. So first paint had to wait for react + react-dom + landing.compiled.js to
// download, parse, execute, and then for React to commit a tree. With a WARM
// cache and zero network cost, the h1 still did not appear for 1039-1337ms, and
// one cold load had every critical byte in hand at 267ms but painted at 1092ms.
// react-dom alone (129KB raw) is 2.9x the landing bundle it exists to run.
//
// This step renders the real LandingShell to static HTML at build time and puts
// it inside <div id="root">, so the homepage paints from markup with NO
// JavaScript at all. React still takes over afterwards for interactivity;
// createRoot() clears the container on its first render, which is what removes
// this snapshot -- in the same commit as its own first paint, so nothing is ever
// shown and then taken away.
//
// ── Why it is generated, not written by hand ───────────────────────────────────
// A hand-written copy of the homepage would be a SECOND definition of the design,
// free to drift from landing.jsx silently. The landing/app split already made
// exactly that mistake once (an inlined copy of the shell lost the global
// @keyframes, and every animation on the page resolved to nothing). So this
// executes the same landing.jsx + landing-shell.jsx that compile.js bundles, in
// the same order, through the same Babel preset, and renders the same component.
// There is one source of truth; this is a build artifact of it.
//
// ── The snapshot is deliberately narrow ───────────────────────────────────────
// One file of HTML cannot be correct for every visitor, and a snapshot that is
// wrong for someone is worse than no snapshot: it paints, then changes under
// them. LandingPhase's copy depends on THREE runtime facts --
//
//   window.innerWidth < 480   (nav gutter and the desktop-only "begin" button)
//   a persisted Supabase token ("Log in / Sign up" vs. the signed-in nav)
//   localStorage saycrd-local-sessions ("start a session" vs. "continue")
//
// -- so this renders exactly one combination: a PHONE-WIDTH, FRESH GUEST. That is
// the case that was measured as broken. index.html still hides the snapshot from
// a token holder (they are going to the Dashboard). It is shown at every other
// width: the landing is fully opaque on first paint, so a phone-width snapshot
// is readable on a desktop instead of waiting for React. Rendering at phone
// width also keeps the desktop-only "begin" nav button out of the markup, which
// is what used to overlap "Log in / Sign up" at 320px.
//
// ── The <style> block stays; the font <link> is dropped ───────────────────────
// SaycrdShell renders two things besides the page: a Google Fonts <link>, and a
// <style> block holding every global @keyframes plus the body/box-sizing base
// rules. The <style> is KEPT inline in the snapshot -- it is what makes the
// markup look right with no JavaScript, so dropping it would ship an unstyled
// homepage.
//
// The <link> is dropped, and nothing replaces it. A render-blocking stylesheet
// sitting in the body would block the very paint this step exists to deliver,
// since the snapshot's own content comes after it in document order. Nothing is
// lost: index.html's <head> already loads DM Serif Display, DM Sans and Space
// Grotesk, which are the only families this markup asks for (FD, FB and SG in
// landing.jsx). The shell's link differs only by adding Lora, which the homepage
// never uses -- so the snapshot renders in its intended faces from the head
// stylesheet alone, and React re-adds the shell's link when it mounts.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const babel = require('@babel/core');
const presetReact = require('@babel/preset-react');
const React = require('react');
const ReactDOMServer = require('react-dom/server');

const PRERENDER_BEGIN = '<!-- SAYCRD_PRERENDER_BEGIN -->';
const PRERENDER_END = '<!-- SAYCRD_PRERENDER_END -->';

// The exact stylesheet SaycrdShell renders. Hoisted into <head> by index.html, so
// it must be stripped from the snapshot -- see the header note.
const FONT_LINK_RE = /<link[^>]*fonts\.googleapis\.com[^>]*>/g;

// The mount at the end of landing-shell.jsx. Rendering needs the component, not a
// call to ReactDOM.createRoot(document.getElementById("root")) -- there is no DOM
// here. Everything above it, including window.__saycrdUnmountLanding, is kept.
const MOUNT_RE = /_landingRoot\s*=\s*ReactDOM\.createRoot[\s\S]*$/;

// Phone width. Must stay below LandingPhase's own 480px breakpoint, which is what
// makes `initialMobile` -- and therefore the fully-opaque first render -- true.
const SNAPSHOT_WIDTH = 390;

// Text that must survive into the markup. This is the whole point of the step, so
// a render that silently produces an empty or partial page has to fail the build
// rather than ship an HTML file that looks fine and helps nobody.
const REQUIRED_TEXT = [
  'The space between your inner world',
  'A place to go in the moment',
  'start a session',
  'BLINDSPOT',
];

// The complete homepage renders 1671 characters of copy (hero, the three numbered
// steps, the field, both explainer sections, the closing CTA and the legal links).
// The floor sits below that with room for real edits, but far above a shell that
// rendered only its chrome. Note this counts COPY: visibleText() drops the <style>
// block, which is most of the markup's bytes.
const MIN_TEXT_CHARS = 1400;

function loadSources(publicDir) {
  const names = ['landing.jsx', 'landing-shell.jsx'];
  return names
    .map(function (name) {
      const abs = path.join(publicDir, name);
      if (!fs.existsSync(abs)) {
        throw new Error('[prerender] source is missing, refusing to emit a partial snapshot: ' + name);
      }
      const text = fs.readFileSync(abs, 'utf8');
      if (!text.trim()) {
        throw new Error('[prerender] source is empty, refusing to emit a partial snapshot: ' + name);
      }
      return text;
    })
    .join('\n');
}

// Compiles with the SAME preset compile.js uses, so the code that renders here is
// the code that ships. Not minified: nothing downloads this.
function compile(source) {
  const stripped = source.replace(MOUNT_RE, '');
  if (stripped === source) {
    throw new Error(
      '[prerender] the ReactDOM.createRoot mount was not found at the end of landing-shell.jsx; ' +
      'refusing to run browser mount code in Node'
    );
  }
  const result = babel.transform(stripped, {
    filename: path.join(__dirname, 'prerender-landing.jsx'),
    // Pass the module, not the name: Babel's name lookup walks from
    // process.cwd(), so a preview server started outside saycrd-repo would
    // fail to find the preset and serve the empty source HTML instead.
    presets: [[presetReact, { development: false }]],
    compact: false,
    babelrc: false,
    configFile: false,
  });
  if (!result || !result.code) throw new Error('[prerender] Babel produced no output');
  return result.code;
}

// A window shaped like a fresh guest on a phone. Everything the landing sources
// touch at module scope or during render has to exist; anything that only runs in
// an effect never fires, because renderToStaticMarkup does not run effects.
function makeSandbox() {
  const noop = function () {};
  const style = { setProperty: noop, removeProperty: noop };
  const element = { style: style, click: noop, setAttribute: noop, appendChild: noop, focus: noop };

  const sandbox = {
    React: React,
    // Present so the sources can reference it, but never used to mount: the
    // createRoot call is stripped before this runs.
    ReactDOM: { createRoot: function () { return { render: noop, unmount: noop }; } },
    console: console,
    JSON: JSON,
    Math: Math,
    Date: Date,
    parseInt: parseInt,
    parseFloat: parseFloat,
    isNaN: isNaN,
    encodeURIComponent: encodeURIComponent,
    decodeURIComponent: decodeURIComponent,
    setTimeout: noop,
    clearTimeout: noop,
    setInterval: noop,
    clearInterval: noop,
    requestAnimationFrame: noop,
    cancelAnimationFrame: noop,
    Promise: Promise,
    Blob: function () {},
    URL: { createObjectURL: function () { return ''; }, revokeObjectURL: noop },
    // A fresh guest: no token, no sessions, nothing to personalise from.
    localStorage: { length: 0, getItem: function () { return null; }, setItem: noop, removeItem: noop, key: function () { return null; } },
    sessionStorage: { getItem: function () { return null; }, setItem: noop, removeItem: noop },
    innerWidth: SNAPSHOT_WIDTH,
    innerHeight: 844,
    devicePixelRatio: 3,
    navigator: { userAgent: 'prerender', language: 'en-US' },
    location: { href: 'https://www.blindspotup.com/', search: '', hash: '', pathname: '/', origin: 'https://www.blindspotup.com' },
    matchMedia: function () { return { matches: false, addEventListener: noop, removeEventListener: noop, addListener: noop, removeListener: noop }; },
    addEventListener: noop,
    removeEventListener: noop,
    dispatchEvent: noop,
    // Signed out. LandingPhase reads this directly for its nav copy.
    currentUser: null,
  };

  sandbox.document = {
    getElementById: function () { return null; },
    querySelector: function () { return null; },
    querySelectorAll: function () { return []; },
    createElement: function () { return element; },
    addEventListener: noop,
    removeEventListener: noop,
    body: element,
    head: element,
    documentElement: element,
  };

  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

function render(publicDir) {
  const code = compile(loadSources(publicDir));
  const sandbox = makeSandbox();
  vm.createContext(sandbox);
  try {
    vm.runInContext(code, sandbox, { timeout: 30000 });
  } catch (e) {
    throw new Error('[prerender] the landing sources threw while loading in Node: ' + e.message);
  }

  if (typeof sandbox.LandingShell !== 'function') {
    throw new Error('[prerender] LandingShell is not defined after loading the landing sources');
  }

  let html;
  try {
    html = ReactDOMServer.renderToStaticMarkup(React.createElement(sandbox.LandingShell));
  } catch (e) {
    throw new Error('[prerender] LandingShell failed to render: ' + e.message);
  }

  return html;
}

// React's SERVER renderer escapes text nodes, and SaycrdShell's <style> block is
// a text node -- so font-family:"DM Sans" serialises as font-family:&quot;DM
// Sans&quot;, which is not CSS and would silently kill whichever rule it lands in.
// The browser has no such problem: for a single string child React sets
// textContent, which stores the raw string, so this is purely an artifact of
// serialising to a string here. Undoing it restores exactly the source CSS.
//
// Scoped to <style> blocks on purpose. Escaping is CORRECT everywhere else in the
// markup -- unescaping page copy would be an HTML-injection bug, not a fix.
function unescapeStyleBlocks(html) {
  return html.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/g, function (_m, open, css, close) {
    const decoded = css
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      // Last: an escaped ampersand must not be turned back into the prefix of
      // another entity that then gets decoded a second time.
      .replace(/&amp;/g, '&');
    return open + decoded + close;
  });
}

// An escaped entity inside CSS is not CSS. unescapeStyleBlocks above removes the
// ones React introduces; this proves none survived into what gets written.
function assertStyleNotEscaped(html) {
  const styles = html.match(/<style[^>]*>[\s\S]*?<\/style>/g) || [];
  for (const block of styles) {
    const bad = block.match(/&(?:amp|lt|gt|quot|#x27|#39);/);
    if (bad) {
      throw new Error(
        '[prerender] the rendered <style> block contains the HTML entity "' + bad[0] +
        '", which is not valid CSS. The snapshot would ship a broken stylesheet.'
      );
    }
  }
  return styles.length;
}

function visibleText(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Everything that makes the snapshot worth shipping, checked before it is written.
function verify(html) {
  const styleCount = assertStyleNotEscaped(html);
  if (styleCount < 1) {
    throw new Error('[prerender] no <style> block in the snapshot; the global keyframes and body base rules are missing');
  }

  if (FONT_LINK_RE.test(html)) {
    FONT_LINK_RE.lastIndex = 0;
    throw new Error('[prerender] the font <link> survived stripping; a body stylesheet would block the snapshot paint');
  }
  FONT_LINK_RE.lastIndex = 0;

  const text = visibleText(html);
  if (text.length < MIN_TEXT_CHARS) {
    throw new Error(
      '[prerender] only ' + text.length + ' characters of visible text (expected >= ' + MIN_TEXT_CHARS +
      '); the snapshot is empty or partial'
    );
  }
  for (const needle of REQUIRED_TEXT) {
    if (text.indexOf(needle) === -1) {
      throw new Error('[prerender] the rendered homepage is missing required copy: ' + JSON.stringify(needle));
    }
  }

  // Proves the markup is actually VISIBLE rather than merely present. Counted
  // on element style attributes only: the <style> block legitimately contains
  // `from{opacity:0}` keyframe declarations, and counting those made this fire
  // on a perfectly good snapshot. The landing is opaque at every width now, so
  // a hidden element here is a regression, not a desktop fade.
  const hidden = (html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '').match(/opacity:0(?![.\d])/g) || []).length;
  if (hidden > 0) {
    throw new Error(
      '[prerender] ' + hidden + ' element(s) rendered at opacity:0 -- the snapshot would be in the HTML but invisible.'
    );
  }

  return { textChars: text.length, bytes: html.length, hiddenElements: hidden };
}

// Replaces everything between the markers, so re-running converges instead of
// accumulating. Both markers must already exist: appending a second snapshot
// would leave two homepages in the document.
function injectSnapshot(indexHtml, snapshot) {
  const start = indexHtml.indexOf(PRERENDER_BEGIN);
  const end = indexHtml.indexOf(PRERENDER_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(
      '[prerender] the snapshot markers are missing from index.html; there would be nothing in <div id="root"> to paint'
    );
  }
  return indexHtml.slice(0, start + PRERENDER_BEGIN.length) + snapshot + indexHtml.slice(end);
}

function prerender(options) {
  const opts = options || {};
  const publicDir = opts.publicDir || path.join(__dirname, '..', 'public');
  const htmlPath = opts.htmlPath || path.join(publicDir, 'index.html');

  const snapshot = unescapeStyleBlocks(render(publicDir).replace(FONT_LINK_RE, ''));
  const stats = verify(snapshot);

  const out = injectSnapshot(fs.readFileSync(htmlPath, 'utf8'), snapshot);
  fs.writeFileSync(htmlPath, out);

  return { snapshot: snapshot, html: out, stats: stats };
}

module.exports = {
  PRERENDER_BEGIN,
  PRERENDER_END,
  FONT_LINK_RE,
  MOUNT_RE,
  SNAPSHOT_WIDTH,
  REQUIRED_TEXT,
  MIN_TEXT_CHARS,
  compile,
  makeSandbox,
  render,
  visibleText,
  unescapeStyleBlocks,
  assertStyleNotEscaped,
  verify,
  injectSnapshot,
  prerender,
};

if (require.main === module) {
  try {
    const result = prerender();
    console.log(
      '[build] Prerendered the signed-out homepage into index.html (' +
      result.stats.bytes + ' bytes of markup, ' +
      result.stats.textChars + ' characters of visible text)'
    );
  } catch (e) {
    console.error(e.message + ' -- aborting rather than shipping an HTML file with no homepage in it');
    process.exit(1);
  }
}
