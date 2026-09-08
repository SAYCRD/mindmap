'use strict';

/*
 * Stage 2: the signed-out homepage is in the HTML.
 *
 * The measurement that produced this work, on production ccbb22f: the served
 * HTML was 47KB but only 820 characters of it were text — and that text was the
 * HIDDEN auth overlay, not the homepage. The <h1> was not in the document at
 * all. With a WARM cache and zero network cost the h1 still took 1039-1337ms to
 * appear at 390px, and one cold load had every critical byte in hand at 267ms
 * but painted at 1092ms. Two earlier stages cut bytes (253KB -> 65KB before
 * paint, 7 round trips -> 2) and neither moved that number, because the homepage
 * did not exist until JavaScript built it.
 *
 * So this file defends four claims, and each one is a thing that was measured
 * rather than assumed:
 *
 *   1. PRESENCE. The homepage copy is in index.html as markup. Not a shell, not
 *      a placeholder, not a spinner — the same copy the React render produces.
 *
 *   2. VISIBILITY. Present is not the same as visible. The landing is fully
 *      opaque on first paint at every width, so a snapshot with opacity:0 on
 *      any element is a regression — it would put an INVISIBLE homepage in the
 *      HTML and look exactly like success to a test that only grepped for the
 *      text.
 *
 *   3. NO JAVASCRIPT BEFORE IT. React, ReactDOM, Supabase and the application
 *      must not be parser-blocking ahead of the snapshot, or the paint waits for
 *      them anyway and the whole exercise is decorative.
 *
 *   4. GENERATED, NEVER COPIED. A hand-written homepage would be a second
 *      definition of the design, free to drift from landing.jsx in silence. This
 *      split has already made that exact mistake once: an inlined copy of the
 *      shell lost the global @keyframes and every animation resolved to nothing.
 *
 * index.html has TWO valid states — the committed source (empty markers, empty
 * asset map, vendor/ paths) and the post-build output (a filled snapshot,
 * static/<hash> paths). Tests pinned to either one silently no-op in the other,
 * which has happened in this repo before, so everything here either works on
 * both or says which state it needs and skips otherwise.
 *
 * Structural claims are validator functions that THROW, so the negative controls
 * at the bottom can prove each one actually fails when the thing it protects is
 * removed. Every control asserts its own mutation landed first: a control that
 * silently no-ops is indistinguishable from a test that cannot fail.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const React = require('react');
const ReactDOMServer = require('react-dom/server');
const vm = require('node:vm');

const REPO = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(REPO, 'public');
const P = {
  index: path.join(PUBLIC_DIR, 'index.html'),
  landing: path.join(PUBLIC_DIR, 'landing.jsx'),
  shell: path.join(PUBLIC_DIR, 'landing-shell.jsx'),
  landingBundle: path.join(PUBLIC_DIR, 'landing.compiled.js'),
  appBundle: path.join(PUBLIC_DIR, 'app.compiled.js'),
};

const prerender = require(path.join(REPO, 'build', 'prerender.js'));

const read = (p) => fs.readFileSync(p, 'utf8');

const src = {
  index: read(P.index),
  landing: read(P.landing),
  shell: read(P.shell),
  landingBundle: read(P.landingBundle),
  appBundle: read(P.appBundle),
};

// Copied from landing-split.test.js for the same reason it exists there: a
// source-grep assertion can otherwise be satisfied by a COMMENT that merely
// mentions the thing, which has already produced a test that passed for the
// wrong reason in this repo.
function stripComments(code) {
  let out = '';
  let i = 0;
  const n = code.length;
  let quote = null;
  while (i < n) {
    const c = code[i];
    const c2 = code[i + 1];
    if (quote) {
      if (c === '\\') { out += c + (c2 || ''); i += 2; continue; }
      if (c === quote) quote = null;
      out += c; i++; continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && c2 === '/') { while (i < n && code[i] !== '\n') i++; continue; }
    if (c === '/' && c2 === '*') {
      i += 2;
      while (i < n && !(code[i] === '*' && code[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    out += c; i++;
  }
  return out;
}

function mutate(source, pattern, replacement, label) {
  const out = source.replace(pattern, replacement);
  assert.notStrictEqual(out, source, `negative control "${label}" did not modify its input — the control is broken`);
  return out;
}

// Renders the real landing sources at an arbitrary viewport width. The landing
// is opaque at every width now, so this is how the visibility check is proven
// in both directions: phone and desktop must both come back with zero hidden
// elements.
function renderAtWidth(width) {
  const code = prerender.compile(src.landing + '\n' + src.shell);
  const sandbox = prerender.makeSandbox();
  sandbox.innerWidth = width;
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { timeout: 30000 });
  const html = ReactDOMServer.renderToStaticMarkup(React.createElement(sandbox.LandingShell));
  return prerender.unescapeStyleBlocks(html.replace(prerender.FONT_LINK_RE, ''));
}

// opacity:0 on ELEMENTS only. The <style> block legitimately holds ten
// `from{opacity:0}` keyframe declarations — those are animation definitions, not
// hidden content, and counting them made the build's own guard fire on a
// perfectly good snapshot.
function hiddenElementCount(html) {
  const withoutStyle = html.replace(/<style[^>]*>[\s\S]*?<\/style>/g, '');
  return (withoutStyle.match(/opacity:0(?![.\d])/g) || []).length;
}

// The snapshot as it sits in index.html, or null in the committed source state.
function snapshotFromIndex(html) {
  const i = html.indexOf(prerender.PRERENDER_BEGIN);
  const j = html.indexOf(prerender.PRERENDER_END);
  if (i === -1 || j === -1) return null;
  const body = html.slice(i + prerender.PRERENDER_BEGIN.length, j);
  return body.trim() ? body : null;
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. Presence — the homepage is markup, not a promise of markup
   ═══════════════════════════════════════════════════════════════════════ */

test('the render produces the complete homepage copy', () => {
  const text = prerender.visibleText(renderAtWidth(prerender.SNAPSHOT_WIDTH));
  for (const needle of prerender.REQUIRED_TEXT) {
    assert.ok(text.includes(needle), `the rendered homepage is missing: ${needle}`);
  }
  // Not just the hero: the numbered steps, both explainer sections and the
  // closing CTA, i.e. everything a visitor scrolls through.
  for (const needle of ['The Pour', 'The Synthesis', 'The Field', 'Why it exists',
    'What the system does', 'Ready to listen to yourself?', 'Privacy', 'Terms']) {
    assert.ok(text.includes(needle), `the rendered homepage is missing a whole section: ${needle}`);
  }
  assert.ok(text.length >= prerender.MIN_TEXT_CHARS,
    `only ${text.length} characters of copy; expected at least ${prerender.MIN_TEXT_CHARS}`);
});

test('prerender still works when cwd is not this package', () => {
  // The v0 preview server starts at the sandbox root, not saycrd-repo.
  // Babel's preset *name* lookup walks from process.cwd(), so a string
  // '@babel/preset-react' failed there and the preview served empty HTML.
  const prev = process.cwd();
  process.chdir(require('os').tmpdir());
  try {
    const html = prerender.render(PUBLIC_DIR);
    assert.ok(html.includes('The space between your inner world'),
      'prerender threw or produced no homepage when cwd was outside the package');
  } finally {
    process.chdir(prev);
  }
});

test('index.html carries the snapshot markers in both build states', () => {
  assert.ok(src.index.includes(prerender.PRERENDER_BEGIN), 'the opening marker is gone');
  assert.ok(src.index.includes(prerender.PRERENDER_END), 'the closing marker is gone');
  assert.ok(src.index.indexOf(prerender.PRERENDER_BEGIN) < src.index.indexOf(prerender.PRERENDER_END),
    'the markers are out of order, so the build would inject nothing');
});

test('the markers sit inside #root so React clears the snapshot itself', () => {
  // Asserted as one contiguous string rather than by locating #root and scanning
  // to its closing tag. The first attempt did the latter and failed against
  // CORRECT source, because index.html's own explanatory comment contains the
  // literal text `<div id="root">` and indexOf matched inside the prose. The
  // markers are themselves HTML comments, so stripping comments first is not an
  // option either — and a nesting check that walks tags would be a parser.
  assert.match(
    src.index,
    new RegExp('<div id="root"><div id="saycrd-prerender">\\s*' + prerender.PRERENDER_BEGIN.replace(/[-[\]{}()*+?.,\\^$|#]/g, '\\$&')),
    'the snapshot must be the first child of #root: createRoot() clearing its container is what removes ' +
    'it, in the same commit as React\'s first paint. Outside #root it would need teardown code and ' +
    'could be shown alongside the React tree.'
  );
});

test('the built HTML contains the homepage as text', (t) => {
  const snap = snapshotFromIndex(src.index);
  if (!snap) return t.skip('index.html is in its committed source state (no snapshot injected yet)');
  const text = prerender.visibleText(snap);
  assert.ok(text.includes('The space between your inner world and the next true move.'),
    'the h1 copy is not in the served HTML — view-source would show no homepage');
  assert.ok(text.length >= prerender.MIN_TEXT_CHARS,
    `the injected snapshot has only ${text.length} characters of copy`);
});

/* ═══════════════════════════════════════════════════════════════════════════
   2. Visibility — calibrated against the render that must NOT be shipped
   ═══════════════════════════════════════════════════════════════════════ */

test('the snapshot width renders an opaque homepage', () => {
  assert.strictEqual(hiddenElementCount(renderAtWidth(prerender.SNAPSHOT_WIDTH)), 0,
    'the snapshot has hidden elements, so the homepage would be in the HTML but invisible');
});

test('the same component at desktop width is also opaque', () => {
  // The snapshot is shown above 480px too. A desktop fade that starts at
  // opacity:0 would put an invisible homepage in the HTML for every tablet
  // and desktop visitor — which is the "blank, then everything at once" stall.
  assert.strictEqual(hiddenElementCount(renderAtWidth(1280)), 0,
    'the desktop render has hidden elements, so showing the snapshot above 480px would paint an invisible page');
});

test('the snapshot width is below LandingPhase own mobile breakpoint', () => {
  const landing = stripComments(src.landing);
  const m = landing.match(/window\.innerWidth\s*<\s*(\d+)/);
  assert.ok(m, 'LandingPhase no longer derives mobile from innerWidth');
  assert.ok(prerender.SNAPSHOT_WIDTH < Number(m[1]),
    `the snapshot renders at ${prerender.SNAPSHOT_WIDTH}px but mobile starts below ${m[1]}px — ` +
    'the snapshot would include the desktop nav CTA that overlaps login on a phone');
});

test('the outer phaseIn fade is never applied', () => {
  const shell = stripComments(src.shell);
  assert.match(shell, /animation:\s*"none"/,
    'the wrapper must not fade the homepage in: phaseIn starts at opacity 0.6, which dims markup that is already on screen');
  assert.doesNotMatch(shell, /phaseIn 0\.25s/,
    'phaseIn is still applied on some widths, so those visitors wait for React then watch the whole page fade in');
});

test('the injected snapshot is opaque and unanimated', (t) => {
  const snap = snapshotFromIndex(src.index);
  if (!snap) return t.skip('index.html is in its committed source state');
  assert.strictEqual(hiddenElementCount(snap), 0, 'the shipped snapshot has hidden elements');
  assert.doesNotMatch(snap, /animation:phaseIn/,
    'the shipped snapshot still fades in via phaseIn, so its content starts dimmed');
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. Nothing executes before the snapshot paints
   ═══════════════════════════════════════════════════════════════════════ */

function assertNothingBlocksTheSnapshot(html) {
  const code = stripComments(html).replace(/<!--[\s\S]*?-->/g, '');
  // Every parser-blocking script tag with a src.
  const tags = code.match(/<script(?![^>]*\b(?:defer|async)\b)[^>]*\bsrc=[^>]*>/g) || [];
  if (tags.length) {
    throw new Error('a parser-blocking script would delay the snapshot paint: ' + tags.join(', '));
  }
  // This used to require React to be present and `defer`. That was the weaker
  // claim: defer does not block the parser, but it does issue the request during
  // parse, so 168KB of framework still competed with the paint of markup the
  // browser had already read. The requirement now is that React has no tag here
  // AT ALL — deferred or otherwise — and is fetched on demand instead.
  const anyReactTag = /<script[^>]*\bsrc="[^"]*react[^"]*"/i.test(code);
  if (anyReactTag) {
    throw new Error('React has a <script> tag again, so it is requested during parse rather than on demand');
  }
  if (!/window\.__saycrdEnsureReact = function/.test(code)) {
    throw new Error('React has no tag and no on-demand loader, so nothing can ever mount');
  }
  return tags.length;
}

test('no script blocks the parser ahead of the snapshot', () => {
  assertNothingBlocksTheSnapshot(src.index);
});

function assertHeadDoesNotRunLoaders(html) {
  const code = stripComments(html).replace(/<!--[\s\S]*?-->/g, '');
  const headEnd = code.indexOf('</head>');
  if (headEnd === -1) throw new Error('</head> is gone');
  const head = code.slice(0, headEnd);
  const afterRoot = code.slice(code.indexOf('id="root"'));
  if (afterRoot.length < 200) {
    throw new Error('failed to isolate the body after #root — this check would prove nothing');
  }
  // The signed-in probe MUST stay in head so a token holder never paints the
  // homepage. The loaders must not: they are parser-blocking, and 10KB of them
  // in <head> is the blank-then-everything paint on a phone.
  if (!/__saycrdBootSignedIn/.test(head)) {
    throw new Error('the signed-in probe left <head>, so a returning visitor would paint the homepage first');
  }
  if (/window\.__saycrdLoadApp\s*=/.test(head)) {
    throw new Error('__saycrdLoadApp is back in <head>, so the parser cannot see the homepage until the loaders have run');
  }
  if (/function insert\s*\(\s*name\s*\)/.test(head)) {
    throw new Error('insert() is back in <head>, so bundle-loading JS is parser-blocking again');
  }
  if (!/window\.__saycrdLoadApp\s*=/.test(afterRoot)) {
    throw new Error('__saycrdLoadApp is gone from after the snapshot, so a later click cannot load the app');
  }
  return true;
}

test('bundle loaders run after the snapshot, not in <head>', () => {
  assertHeadDoesNotRunLoaders(src.index);
});

test('control: putting LoadApp back in <head> fails the head-loader test', () => {
  const poisoned = mutate(
    src.index,
    /window\.__saycrdBootSignedIn = signedIn;/,
    'window.__saycrdBootSignedIn = signedIn; window.__saycrdLoadApp = function () {};',
    'head loaders: re-added LoadApp next to the signed-in probe'
  );
  assert.throws(() => assertHeadDoesNotRunLoaders(poisoned), /__saycrdLoadApp is back in <head>/);
});

test('the snapshot markup carries no stylesheet of its own', (t) => {
  const snap = snapshotFromIndex(src.index);
  if (!snap) return t.skip('index.html is in its committed source state');
  // SaycrdShell renders a Google Fonts <link>. Left in the body it would block
  // rendering of the snapshot's own content, which comes after it in document
  // order — i.e. it would block the paint this whole step exists to deliver.
  assert.doesNotMatch(snap, /<link[^>]*stylesheet/i,
    'a stylesheet inside the snapshot blocks the paint it is supposed to enable');
  assert.doesNotMatch(snap, /fonts\.googleapis\.com/,
    'the font link must be stripped from the snapshot');
});

/* ── Nothing the first paint does not need is requested before it ──────────── */

// Every subresource the head can ask for, as an actual tag rather than a bare
// mention in prose. stripComments() first, so a comment describing what USED to
// be here can never satisfy — or break — one of these.
function headTags(html) {
  // stripComments() handles JS comments only. HTML comments have to go too, and
  // this is not hypothetical: the first version of this helper matched the string
  // "<link rel="stylesheet">" inside the <head> comment that explains why there
  // is no longer a stylesheet there, and reported the regression it was written
  // to catch. A structural claim must never be able to read prose.
  const code = stripComments(html).replace(/<!--[\s\S]*?-->/g, '');
  const head = code.slice(0, code.indexOf('</head>'));
  // <noscript> is excluded deliberately: its contents are inert for every
  // visitor who runs JavaScript, which is who these assertions are about.
  const live = head.replace(/<noscript>[\s\S]*?<\/noscript>/gi, '');
  return {
    scripts: (live.match(/<script[^>]*\ssrc="[^"]*"/gi) || []),
    links: (live.match(/<link[^>]*>/gi) || []),
  };
}

test('the head requests no script at all before the homepage paints', () => {
  // The homepage is markup plus the critical CSS in this same head, so any
  // external script here is delaying a paint that is already possible. React was
  // the last holdout: 168KB, blocking, for content the browser had already
  // parsed. `defer` was not good enough — it still issues the request.
  const { scripts } = headTags(src.index);
  assert.deepEqual(scripts, [],
    'the head loads external scripts again: ' + scripts.join(', '));
});

test('the head has no font stylesheet and no preload of any kind', () => {
  const { links } = headTags(src.index);
  for (const tag of links) {
    assert.doesNotMatch(tag, /rel="?stylesheet/i,
      'a render-blocking stylesheet is back in the head: ' + tag);
    // rel=preload and rel=preconnect both start network work during head parse,
    // which is exactly what must not happen before the homepage is on screen.
    assert.doesNotMatch(tag, /rel="?(preload|preconnect|prefetch)/i,
      'a resource hint is back in the head, so the request starts before the paint: ' + tag);
    assert.doesNotMatch(tag, /fonts\.(googleapis|gstatic)\.com/,
      'Google Fonts is reachable from a live head tag again: ' + tag);
  }
});

test('the preferred fonts are requested immediately but never block the paint', () => {
  const code = stripComments(src.index);
  // This used to assert the fonts were appended ON THE LOAD EVENT. That was the
  // bug, not the design: the load event waits for every image on the page, so
  // gating here meant the faces were not even requested until 8.1s on a phone
  // viewport. The requirement was only ever "must not block the first paint",
  // and media="print" satisfies that without deferring the request at all.
  assert.match(code, /l\.rel = "stylesheet";/,
    'nothing appends the font stylesheet any more, so the design never gets its faces');
  const injected = code.slice(code.indexOf('function loadFonts()'));
  for (const family of ['DM+Serif+Display', 'DM+Sans', 'Space+Grotesk', 'Lora']) {
    assert.ok(injected.includes(family),
      `${family} is used by the homepage but is not in the font request`);
  }
  // Non-blocking is the whole point, and it takes both halves: media="print"
  // keeps it out of the render path, and the onload switch is what actually
  // applies the faces. Without the second line the fonts would download and
  // then never be used.
  assert.match(injected, /l\.media = "print";/,
    'the font stylesheet is render-blocking again, so it delays the first paint');
  assert.match(injected, /l\.onload = function \(\) \{ l\.media = "all"; \};/,
    'nothing promotes the stylesheet to media="all", so the faces never apply');
  // And it must NOT be pushed behind the load event again.
  assert.doesNotMatch(code, /addEventListener\("load", loadFonts/,
    'the fonts are gated on the load event again, which waits for every image on the page');
  const noscript = (src.index.match(/<noscript>[\s\S]*?<\/noscript>/i) || [''])[0];
  assert.match(noscript, /fonts\.googleapis\.com/,
    'a visitor with JavaScript disabled never reaches loadFonts and would get no fonts at all');
});

test('the homepage asks fonts.googleapis.com for its faces exactly once', () => {
  // SaycrdShell rendered a second <link> with an overlapping family list, so a
  // signed-out visit made two requests to fonts.googleapis.com -- the second
  // only after the bundle had mounted. Every face now comes from the single
  // request in loadFonts, and this is what stops the duplicate coming back.
  const code = stripComments(src.index);
  const injected = code.slice(code.indexOf('function loadFonts()'));
  const inLoader = (injected.match(/fonts\.googleapis\.com/g) || []).length;
  assert.strictEqual(inLoader, 1,
    `loadFonts should build one stylesheet URL, found ${inLoader}`);
  // Asserted against the minified bundles, not the JSX sources. Only a bundle
  // can actually issue the request, and terser has already stripped every
  // comment from it. Grepping the sources instead relied on stripComments(),
  // which is defeated by an apostrophe in JSX text -- "don't" opens a quote
  // that never closes, so every real comment downstream of one is kept
  // verbatim. That is why this failed while describing correct code: the only
  // remaining mention of the host in landing.jsx is the comment recording that
  // the <link> was REMOVED.
  for (const [name, bundle] of [['landing.compiled.js', src.landingBundle], ['app.compiled.js', src.appBundle]]) {
    assert.doesNotMatch(bundle, /fonts\.googleapis\.com/,
      `${name} builds its own webfont URL: that is a second round trip to ` +
      'fonts.googleapis.com once the bundle mounts, for faces index.html already requested');
  }
});

test('React is fetched on demand, and react-dom cannot execute before react', () => {
  const code = stripComments(src.index);
  assert.doesNotMatch(code, /<script[^>]*src="[^"]*react/i,
    'React has a <script> tag again, so it is requested during parse');
  assert.match(code, /window\.__saycrdEnsureReact = function \(\)/,
    'the on-demand React loader is gone');
  // Order is a correctness requirement, not a preference: react-dom reads the
  // React global as it executes. insert() sets async=false, which is what makes
  // a parallel download still execute in insertion order.
  assert.match(code, /loadAll\(\["react\.production\.min\.js", "react-dom\.production\.min\.js"\]\)/,
    'react and react-dom must be inserted together, in that order');
  assert.match(code, /s\.async = false;/,
    'without async=false the two React scripts could execute out of order');
  // Each bundle loader must guarantee React is there before its bundle runs,
  // because nothing loads React up front any more. There are two legitimate
  // ways to do that and the difference is a measured latency, not a style:
  //
  //   app     - chains off __saycrdEnsureReact(). Costs an extra round trip,
  //             which is acceptable behind a click.
  //   landing - names React in its OWN loadAll, so all three download in
  //             parallel. Chaining it instead meant landing.compiled.js was not
  //             requested until react-dom had finished downloading AND
  //             executing: three sequential round trips on the signed-out path,
  //             which is the one that has to be fast.
  //
  // insert() dedupes by name and sets async=false, so the parallel form still
  // shares the same two React fetches and still executes them in order.
  const appAt = code.indexOf('window.__saycrdLoadApp = function');
  assert.ok(appAt !== -1, '__saycrdLoadApp is gone');
  assert.match(code.slice(appAt, appAt + 400), /__saycrdEnsureReact\(\)/,
    '__saycrdLoadApp must ensure React itself, or a click would run the app against an undefined React');

  const landingAt = code.indexOf('window.__saycrdLoadLanding = function');
  assert.ok(landingAt !== -1, '__saycrdLoadLanding is gone');
  const landingBody = code.slice(landingAt, landingAt + 500);
  assert.match(landingBody,
    /loadAll\(\[\s*"react\.production\.min\.js",\s*"react-dom\.production\.min\.js",\s*"landing\.compiled\.js"\s*\]\)/,
    'the landing bundle must be requested in the SAME loadAll as React, in that order: ' +
    'chaining it behind __saycrdEnsureReact() serialises three round trips on the signed-out path');
  assert.doesNotMatch(landingBody, /__saycrdEnsureReact\(\)\.then/,
    'the landing bundle is chained behind React again, so it is not even requested until react-dom has executed');
});

function assertReactStaysOffTheSnapshot(html) {
  const code = stripComments(html);
  // Unbuilt source still needs the bundle (empty markers). A painted snapshot
  // at ANY width must not fetch it: createRoot() would wipe the markup and the
  // visitor would wait ~1s for React to put the same page back.
  if (!/snapshotPainted = !!\(snap && snap\.querySelector\("\.saycrd-app-shell"\)\)/.test(code)) {
    throw new Error('the painted-snapshot probe is gone, so a visitor cannot keep the HTML');
  }
  if (/matchMedia\("\(min-width: 480px\)"\)/.test(code)) {
    throw new Error('React still auto-loads above 480px, so desktop waits for the bundle then paints the whole page at once');
  }
  if (!/if \(!snapshotPainted\) \{/.test(code)) {
    throw new Error('the landing bundle is no longer gated on the snapshot being unpainted');
  }
  if (/snapshotHidden/.test(code)) {
    throw new Error('snapshotHidden is back, so some widths still fetch React over a painted homepage');
  }
  if (!/document\.addEventListener\("DOMContentLoaded", loadInteractive, \{ once: true \}\)/.test(code)) {
    throw new Error('desktop / empty-snapshot still needs DOMContentLoaded to become interactive');
  }
  if (!/if \(document\.readyState === "loading"\) \{/.test(code)) {
    throw new Error('a document that is already parsed must still be handled, or the page never becomes interactive');
  }
  if (/addEventListener\("load", loadInteractive/.test(code)) {
    throw new Error('the interactive layer is gated on the load event again, which waits for every image on the page');
  }
  if (!/function loadInteractive\(\) \{\s*window\.__saycrdLoadLanding\(\)/.test(code)) {
    throw new Error('loadInteractive must fetch the landing bundle, not the application');
  }
  const handler = code.slice(code.indexOf('function loadInteractive()'));
  if (/__saycrdLoadApp\(\)/.test(handler.slice(0, 600))) {
    throw new Error('the application must not be pulled in by loadInteractive');
  }
  return true;
}

test('the signed-out path does not fetch React over a painted snapshot', () => {
  assertReactStaysOffTheSnapshot(src.index);
});

test('the bridge loads the landing bundle for a legal click', () => {
  const bridge = stripComments(src.index);
  const shell = stripComments(src.shell);
  const landing = stripComments(src.landing);
  assert.match(landing, /data-saycrd-boot="legal"/,
    'legal footer buttons must be marked for the pre-React bridge');
  assert.match(bridge, /action === "legal"/,
    'the bridge must handle a legal click, or Privacy/Terms do nothing until React mounts');
  assert.match(bridge, /window\.__SAYCRD_LEGAL_PAGE = page/,
    'the bridge must record which legal page so the shell can open it on first paint');
  assert.match(bridge, /window\.__saycrdLoadLanding\(\)/,
    'a legal click is the signal that actually fetches the landing bundle on a phone');
  assert.match(shell, /window\.__SAYCRD_LEGAL_PAGE/,
    'LandingShell must read the boot flag, or the first React paint is the homepage again');
});

test('a returning visitor still starts auth and React immediately', () => {
  const code = stripComments(src.index);
  // Deferring React must not slow the one path that genuinely needs it at boot.
  // Both chains start synchronously and in parallel; only the app's EXECUTION is
  // ordered behind them.
  const at = code.indexOf('if (window.__saycrdBootSignedIn)');
  assert.ok(at !== -1, 'the returning-visitor branch is gone');
  const branch = code.slice(at, code.indexOf('return;', at));
  assert.match(branch, /var auth = window\.__saycrdEnsureAuth\(\);/,
    'the auth chain must start immediately for a returning visitor');
  assert.match(branch, /var react = window\.__saycrdEnsureReact\(\);/,
    'React must start immediately for a returning visitor, not on the load event');
  assert.match(branch, /Promise\.all\(/,
    'the app must execute once both auth and React have settled');
  assert.doesNotMatch(branch, /addEventListener\("load"/,
    'a returning visitor must not wait for the load event to reach their Dashboard');
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. The snapshot is only shown to the visitor it was rendered for
   ═══════════════════════════════════════════════════════════════════════ */

function assertSnapshotIsGated(html) {
  const code = stripComments(html);
  if (/@media \(min-width:480px\)\{#saycrd-prerender\{display:none\}\}/.test(code)) {
    throw new Error('the snapshot is hidden above 480px, so desktop waits for React then paints the whole page at once');
  }
  if (!/#saycrd-prerender\{display:block\}/.test(code)) {
    throw new Error('the snapshot is not displayed, so signed-out visitors have nothing to paint');
  }
  if (!/html\.saycrd-no-prerender #saycrd-prerender\{display:none\}/.test(code)) {
    throw new Error('there is no opt-out class for visitors the snapshot misrepresents');
  }
  if (!/saycrd-no-prerender/.test(code.slice(0, code.indexOf('</head>')))) {
    throw new Error('the opt-out is not applied in <head>, so the snapshot would paint before being hidden');
  }
  // The opt-out must be reachable for a token holder and for NOBODY else. An
  // earlier version also hid it from a returning guest, to keep their "continue"
  // label from updating — but that withheld the homepage from a signed-out
  // visitor while a bundle downloaded, which is the whole problem. Asserted as
  // the shape of the condition, not as "the identifier appears somewhere": a
  // mention in a comment or an unrelated read must not satisfy this.
  if (!/if \(signedIn\) \{\s*document\.documentElement\.className \+= " saycrd-no-prerender";/.test(code)) {
    throw new Error('the snapshot opt-out is not gated on signedIn alone');
  }
  if (/saycrd-local-sessions/.test(code)) {
    throw new Error('the guest-session probe is back, so a signed-out visitor is being shown a blank page while a bundle loads');
  }
  return true;
}

test('the snapshot is shown at every width and hidden only for a token holder', () => {
  assertSnapshotIsGated(src.index);
});

test('the guest probe reads the same key LandingPhase reads', () => {
  // LandingPhase derives `returning` from _sessionKey(), which resolves to
  // "saycrd-local-sessions" before any user is known. If the gate probed a
  // different key the two could disagree, and the snapshot would paint
  // "start a session" to someone the React render greets with "continue".
  const landing = stripComments(src.landing);
  assert.match(landing, /function _sessionKey\(\)\s*\{\s*return "saycrd-" \+ getCurrentUid\(\) \+ "-sessions";/,
    'the session key changed shape; the boot probe in index.html must be re-derived');
  assert.match(landing, /getCurrentUid\(\)[\s\S]{0,200}: "local";/,
    'getCurrentUid no longer falls back to "local", so "saycrd-local-sessions" may be the wrong key');
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. The pre-React window is wired, not dead
   ═══════════════════════════════════════════════════════════════════════ */

test('every bridged action exists in the landing source', () => {
  const landing = stripComments(src.landing);
  const actions = [...landing.matchAll(/data-saycrd-boot="([a-z]+)"/g)].map((m) => m[1]);
  assert.ok(actions.length >= 4,
    `expected the primary actions to be marked for the pre-React bridge, found ${actions.length}`);
  for (const needed of ['start', 'login', 'concept']) {
    assert.ok(actions.includes(needed), `no element is marked data-saycrd-boot="${needed}"`);
  }
  // The bridge must handle exactly the actions the markup declares: an unhandled
  // marker is a button that looks wired and silently does nothing.
  const bridge = stripComments(src.index);
  for (const action of new Set(actions)) {
    assert.ok(bridge.includes(`"${action}"`),
      `landing.jsx marks data-saycrd-boot="${action}" but index.html's bridge never handles it`);
  }
});

test('the bridge starts a session exactly the way the shell does', () => {
  const bridge = stripComments(src.index);
  const shell = stripComments(src.shell);
  // Both must set the same flag and call the same loader, so continuing from
  // the signup card does the same thing as a late tap. app.jsx reads
  // __SAYCRD_START_REQUESTED on mount to avoid re-presenting the homepage it
  // was handed over from.
  assert.match(shell, /__SAYCRD_START_REQUESTED = true/, 'the shell no longer records the start intent');
  assert.match(bridge, /window\.__SAYCRD_START_REQUESTED = true;\s*if \(window\.__saycrdLoadApp\) window\.__saycrdLoadApp\(\);/,
    'the continuation must record the same intent and load the app, or Continue without an account is swallowed');
  // The guest/credit check is deliberately NOT duplicated here.
  assert.doesNotMatch(bridge.slice(bridge.indexOf('function startSession')), /_canStartNewSession|_consumeSessionCredit/,
    'the bridge must not re-implement the entitlement check: it belongs in app.jsx beginSessionOrGate() only');
});

test('the bridge opens the real login overlay', () => {
  const bridge = stripComments(src.index);
  assert.match(bridge, /if \(window\._showAuthOverlay\) window\._showAuthOverlay\(startSession\)/,
    'the bridge must open the overlay with the same "sign in, then begin" continuation LandingPhase uses');
});

test('a homepage start tap opens signup and does not fetch the application', () => {
  const bridge = stripComments(src.index);
  const startAt = bridge.indexOf('if (action === "start"');
  assert.ok(startAt > 0, 'the start action is gone from the bridge');
  const legalAt = bridge.indexOf('else if (action === "legal")', startAt);
  assert.ok(legalAt > startAt, 'the legal branch is gone, so the start-handler slice would be unbounded');
  const untilLegal = bridge.slice(startAt, legalAt);
  assert.match(untilLegal, /openAuthThenStart\(\)/,
    'start must open the static signup card, not load 598KB of application');
  assert.doesNotMatch(untilLegal, /__saycrdLoadApp/,
    'start is fetching the application again before the visitor has chosen to continue');
  assert.match(bridge, /action === "start" \|\| action === "login"/,
    'start and login share the signup card; splitting them reintroduces a path that skips it');
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. Build-step behaviour
   ═══════════════════════════════════════════════════════════════════════ */

test('injecting the snapshot twice converges', () => {
  const host = `<div id="root"><div id="saycrd-prerender">${prerender.PRERENDER_BEGIN}${prerender.PRERENDER_END}</div></div>`;
  const once = prerender.injectSnapshot(host, '<p>one</p>');
  const twice = prerender.injectSnapshot(once, '<p>one</p>');
  assert.strictEqual(once, twice, 'a second build must replace the snapshot, not append another');
  assert.strictEqual((twice.match(/<p>one<\/p>/g) || []).length, 1, 'the snapshot was duplicated');
});

test('a later build replaces an earlier snapshot', () => {
  const host = `${prerender.PRERENDER_BEGIN}${prerender.PRERENDER_END}`;
  const out = prerender.injectSnapshot(prerender.injectSnapshot(host, '<p>old</p>'), '<p>new</p>');
  assert.ok(out.includes('<p>new</p>'), 'the new snapshot is missing');
  assert.ok(!out.includes('<p>old</p>'), 'the previous snapshot survived');
});

test('the CSS the snapshot depends on is not HTML-escaped', () => {
  const html = renderAtWidth(prerender.SNAPSHOT_WIDTH);
  const style = html.match(/<style[^>]*>[\s\S]*?<\/style>/);
  assert.ok(style, 'the global style block is missing from the snapshot');
  // React's server renderer escapes text nodes, so font-family:"DM Sans" would
  // serialise as font-family:&quot;DM Sans&quot; — not CSS. The browser has no
  // such problem because React sets textContent there, which is why this is easy
  // to miss and why the build refuses to ship it.
  assert.doesNotMatch(style[0], /&(?:amp|lt|gt|quot|#x27|#39);/,
    'the style block contains HTML entities, so whichever rule holds them is broken CSS');
  assert.ok(style[0].includes('@keyframes phaseIn'),
    'the global keyframes are missing — an inlined copy of the shell lost these once already');
});

test('the build refuses to render browser mount code', () => {
  // landing-shell.jsx ends by calling ReactDOM.createRoot(document.getElementById("root")).
  // There is no DOM at build time, so the mount is stripped; if it ever stops
  // being found, failing is right and rendering anyway is not.
  assert.throws(
    () => prerender.compile('var x = 1;'),
    /ReactDOM\.createRoot mount was not found/,
    'compile must refuse a source whose mount it cannot find'
  );
});

test('the build fails rather than ship an empty homepage', () => {
  assert.throws(() => prerender.verify('<div><style>a{}</style></div>'), /empty or partial/);
  assert.throws(() => prerender.verify('<div></div>'), /no <style> block/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. Negative controls — each claim above must be falsifiable
   ═══════════════════════════════════════════════════════════════════════ */

test('control: putting React back in a script tag fails the blocking-script test', () => {
  // Re-adds React the way it used to load — as a deferred tag, i.e. the version
  // that PASSED the old assertion — so this proves the check now rejects the
  // request being issued during parse, not merely the parser being blocked.
  const poisoned = mutate(
    src.index,
    /<div id="saycrd-prerender">/,
    '<script defer src="vendor/react.production.min.js"></script><div id="saycrd-prerender">',
    'blocking: put React back in the markup'
  );
  // Confirmed against the COMMENT-STRIPPED text, not the raw file. The first
  // version of this control anchored on `<div id="root">` and landed inside the
  // boot-decision comment that quotes that very string; the tag was present in
  // the raw HTML, so a raw assert.match passed, but the assertion under test
  // strips comments and correctly saw nothing. A mutation must be proven to have
  // landed in LIVE code, which is the only thing the check can read.
  const live = stripComments(poisoned).replace(/<!--[\s\S]*?-->/g, '');
  assert.match(live, /<script defer src="vendor\/react\.production/,
    'the mutation did not land in live code, so this control proves nothing');
  assert.throws(() => assertNothingBlocksTheSnapshot(poisoned), /requested during parse/);
});

test('control: hiding the snapshot above 480px fails the gating test', () => {
  const poisoned = mutate(
    src.index,
    /#saycrd-prerender\{display:block\}/,
    '#saycrd-prerender{display:block}@media (min-width:480px){#saycrd-prerender{display:none}}',
    'gating: hid the snapshot above 480px'
  );
  assert.throws(() => assertSnapshotIsGated(poisoned), /hidden above 480px/);
});

test('control: re-adding a guest-session gate fails the gating test', () => {
  // The inverse of the control this replaces. Hiding the snapshot from a
  // returning guest used to be required; it is now forbidden, because it
  // withholds the homepage from a signed-out visitor while a bundle downloads.
  const poisoned = mutate(
    src.index,
    /if \(signedIn\) \{\s*document\.documentElement\.className \+= " saycrd-no-prerender";/,
    'if (signedIn || localStorage.getItem("saycrd-local-sessions")) {' +
      ' document.documentElement.className += " saycrd-no-prerender";',
    'gating: re-added the guest-session gate'
  );
  const live = stripComments(poisoned);
  assert.match(live, /signedIn \|\| localStorage\.getItem\("saycrd-local-sessions"\)/,
    'the mutation did not land in live code, so this control proves nothing');
  // Trips the condition-shape tripwire first, which is the stricter of the two:
  // it rejects ANY widening of the gate, not just this particular one.
  assert.throws(() => assertSnapshotIsGated(poisoned), /not gated on signedIn alone/);
});

test('control: fetching React over a painted snapshot fails the stay-off test', () => {
  const poisoned = mutate(
    src.index,
    /if \(!snapshotPainted\) \{/,
    'if (true) {',
    'react: auto-load landing bundle even when the snapshot is already on screen'
  );
  const live = stripComments(poisoned);
  assert.match(live, /if \(true\) \{/,
    'the mutation did not land in live code, so this control proves nothing');
  assert.throws(() => assertReactStaysOffTheSnapshot(poisoned), /no longer gated on the snapshot/);
});

test('control: a snapshot with a hidden element fails the visibility test', () => {
  // Proves the visibility check distinguishes a visible homepage from an
  // invisible one, rather than passing on any render that contains the right words.
  const html = renderAtWidth(prerender.SNAPSHOT_WIDTH);
  const poisoned = mutate(
    html,
    /<h1 /,
    '<h1 style="opacity:0" ',
    'visibility: hide the h1'
  );
  assert.ok(prerender.visibleText(poisoned).includes('The space between your inner world'),
    'the poisoned render still contains the copy — which is exactly why presence alone is not enough');
  assert.ok(hiddenElementCount(poisoned) > 0, 'the mutation must actually produce hidden elements');
  assert.throws(() => prerender.verify(poisoned), /opacity:0/);
});

test('control: an escaped style block fails the CSS test', () => {
  const html = renderAtWidth(prerender.SNAPSHOT_WIDTH);
  // Re-introduce exactly what React's server renderer does.
  const poisoned = mutate(
    html,
    /(<style[^>]*>)([\s\S]*?)(<\/style>)/,
    (_m, open, css, close) => open + css.replace(/"/g, '&quot;') + close,
    'css: re-escaped the style block'
  );
  assert.match(poisoned, /&quot;/, 'the mutation must actually have landed');
  assert.throws(() => prerender.verify(poisoned), /not valid CSS/);
});

test('control: a snapshot keeping its font link fails the stylesheet test', () => {
  const withLink = '<div><link href="https://fonts.googleapis.com/css2?family=DM+Sans" rel="stylesheet"/>' +
    '<style>body{margin:0}</style></div>';
  assert.throws(() => prerender.verify(withLink), /would block the snapshot paint/);
});

test('control: missing markers fail the injection step', () => {
  assert.throws(() => prerender.injectSnapshot('<div id="root"></div>', '<p>x</p>'),
    /markers are missing/);
});

test('control: an unhandled bridge action fails the wiring test', () => {
  // Proves the "every marker is handled" claim is not vacuous.
  const actions = ['start', 'login', 'concept', 'somethingNobodyHandles'];
  const bridge = stripComments(src.index);
  const unhandled = actions.filter((a) => !bridge.includes(`"${a}"`));
  assert.deepStrictEqual(unhandled, ['somethingNobodyHandles'],
    'the wiring check cannot tell a handled action from an unhandled one');
});
