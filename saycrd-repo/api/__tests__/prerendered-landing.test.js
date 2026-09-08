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
 *   2. VISIBILITY. Present is not the same as visible. Rendered at desktop width
 *      the identical component emits its pre-fade state — five elements at
 *      opacity:0 — which would put an INVISIBLE homepage in the HTML and look
 *      exactly like success to a test that only grepped for the text. The
 *      snapshot is rendered below the mobile breakpoint for precisely this
 *      reason, and the check here is calibrated against the desktop render so it
 *      cannot pass by accident.
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
};

const prerender = require(path.join(REPO, 'build', 'prerender.js'));

const read = (p) => fs.readFileSync(p, 'utf8');

const src = {
  index: read(P.index),
  landing: read(P.landing),
  shell: read(P.shell),
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

// Renders the real landing sources at an arbitrary viewport width. This is what
// makes the visibility claim testable in both directions rather than asserted in
// one: the SAME component at 1280px must produce the hidden pre-fade state.
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

test('the same component at desktop width renders the hidden pre-fade state', () => {
  // The calibration. If this ever reaches 0, the desktop staggered fade is gone
  // and the check above has stopped proving anything — it would pass at any
  // width, including one that ships an invisible homepage.
  const desktop = hiddenElementCount(renderAtWidth(1280));
  assert.ok(desktop > 0,
    'the desktop render has no hidden elements, so "opaque at phone width" no longer distinguishes anything');
  assert.strictEqual(desktop, 5,
    'expected exactly the five staggered reveal elements (eyebrow, h1, lede, button row, login link); ' +
    `got ${desktop}. LandingPhase's desktop fade changed — re-derive this number before editing it.`);
});

test('the snapshot width is below LandingPhase own mobile breakpoint', () => {
  const landing = stripComments(src.landing);
  const m = landing.match(/window\.innerWidth\s*<\s*(\d+)/);
  assert.ok(m, 'LandingPhase no longer derives mobile from innerWidth');
  assert.ok(prerender.SNAPSHOT_WIDTH < Number(m[1]),
    `the snapshot renders at ${prerender.SNAPSHOT_WIDTH}px but mobile starts below ${m[1]}px — ` +
    'the snapshot would be the desktop pre-fade state');
});

test('the outer phaseIn fade is disabled on mobile', () => {
  const shell = stripComments(src.shell);
  assert.match(shell, /animation:\s*isMobile\s*\?\s*"none"\s*:\s*"phaseIn/,
    'the wrapper animation must be gated on isMobile: phaseIn fades the whole page from opacity 0.6, ' +
    'which dims a homepage whose inner content is already fully opaque on mobile');
  assert.match(shell, /var isMobile\s*=\s*typeof window[\s\S]{0,80}innerWidth\s*<\s*480/,
    'isMobile must come from the same innerWidth breakpoint LandingPhase uses');
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
  const code = stripComments(html);
  // Every remaining parser-blocking script tag with a src.
  const tags = code.match(/<script(?![^>]*\b(?:defer|async)\b)[^>]*\bsrc=[^>]*>/g) || [];
  if (tags.length) {
    throw new Error('a parser-blocking script would delay the snapshot paint: ' + tags.join(', '));
  }
  if (!/<script defer src="[^"]*react\.production/.test(code)) {
    throw new Error('React is not deferred');
  }
  if (!/<script defer src="[^"]*react-dom\.production/.test(code)) {
    throw new Error('ReactDOM is not deferred');
  }
  return tags.length;
}

test('no script blocks the parser ahead of the snapshot', () => {
  assertNothingBlocksTheSnapshot(src.index);
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

test('the fonts the snapshot needs are already in the document head', () => {
  // Why stripping the shell's link is safe rather than a regression: the head
  // stylesheet already serves every family the homepage asks for. Lora is the
  // only one the shell adds, and the homepage never uses it.
  const head = src.index.slice(0, src.index.indexOf('</head>'));
  for (const family of ['DM+Serif+Display', 'DM+Sans', 'Space+Grotesk']) {
    assert.ok(head.includes(family),
      `${family} is used by the snapshot but is not loaded in <head>, so it would render in a fallback face`);
  }
});

test('the loader waits for React before inserting any bundle', () => {
  const code = stripComments(src.index);
  assert.match(code, /function whenReactReady\(fn\)/, 'the React-ready gate is gone');
  // Deferred scripts run before DOMContentLoaded, which is the only reason that
  // event means "React exists". Without this wait a dynamically inserted bundle
  // can execute first and take the page down with a ReferenceError.
  assert.match(code, /addEventListener\("DOMContentLoaded", fn, \{ once: true \}\)/,
    'the gate must wait on DOMContentLoaded, after which deferred scripts have executed');
  assert.match(code, /if \(window\.React && window\.ReactDOM\) \{ fn\(\); return; \}/,
    'the gate must short-circuit when React is already present');
  assert.match(code, /whenReactReady\(function \(\) \{\s*window\.__saycrdLoadScript\("landing\.compiled\.js"\)/,
    'the landing bundle must be inserted inside the React-ready gate');
});

test('a returning visitor still starts the auth chain immediately', () => {
  const code = stripComments(src.index);
  // The gate must order the app's EXECUTION without delaying the downloads that
  // need no React — otherwise deferring React would slow the returning-visitor
  // path this split was built to keep fast.
  assert.match(code, /var auth = window\.__saycrdEnsureAuth\(\);\s*whenReactReady/,
    'the auth chain must start before the React wait, not inside it');
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. The snapshot is only shown to the visitor it was rendered for
   ═══════════════════════════════════════════════════════════════════════ */

function assertSnapshotIsGated(html) {
  const code = stripComments(html);
  if (!/@media \(min-width:480px\)\{#saycrd-prerender\{display:none\}\}/.test(code)) {
    throw new Error('the snapshot is not hidden above the mobile breakpoint');
  }
  if (!/html\.saycrd-no-prerender #saycrd-prerender\{display:none\}/.test(code)) {
    throw new Error('there is no opt-out class for visitors the snapshot misrepresents');
  }
  if (!/saycrd-no-prerender/.test(code.slice(0, code.indexOf('</head>')))) {
    throw new Error('the opt-out is not applied in <head>, so the snapshot would paint before being hidden');
  }
  if (!/localStorage\.getItem\("saycrd-local-sessions"\)/.test(code)) {
    throw new Error('the returning-guest probe is gone, so a guest with sessions would see the wrong copy');
  }
  return true;
}

test('the snapshot is hidden for every visitor it does not describe', () => {
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
  // Both must set the same flag and call the same loader, so an early tap and a
  // late tap do the same thing. app.jsx reads __SAYCRD_START_REQUESTED on mount
  // to avoid re-presenting the homepage it was handed over from.
  assert.match(shell, /__SAYCRD_START_REQUESTED = true/, 'the shell no longer records the start intent');
  assert.match(bridge, /window\.__SAYCRD_START_REQUESTED = true;\s*if \(window\.__saycrdLoadApp\) window\.__saycrdLoadApp\(\);/,
    'the bridge must record the same intent and load the app, or an early tap is swallowed');
  // The guest/credit check is deliberately NOT duplicated here.
  assert.doesNotMatch(bridge.slice(bridge.indexOf('function startSession')), /_canStartNewSession|_consumeSessionCredit/,
    'the bridge must not re-implement the entitlement check: it belongs in app.jsx beginSessionOrGate() only');
});

test('the bridge opens the real login overlay', () => {
  const bridge = stripComments(src.index);
  assert.match(bridge, /if \(window\._showAuthOverlay\) window\._showAuthOverlay\(startSession\)/,
    'the bridge must open the overlay with the same "sign in, then begin" continuation LandingPhase uses');
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

test('control: an un-deferred React tag fails the blocking-script test', () => {
  const poisoned = mutate(
    src.index,
    /<script defer src="([^"]*react\.production[^"]*)">/,
    '<script src="$1">',
    'blocking: removed defer from React'
  );
  assert.match(poisoned, /<script src="[^"]*react\.production/, 'the mutation must actually have landed');
  assert.throws(() => assertNothingBlocksTheSnapshot(poisoned), /parser-blocking script/);
});

test('control: dropping the desktop media query fails the gating test', () => {
  const poisoned = mutate(
    src.index,
    /@media \(min-width:480px\)\{#saycrd-prerender\{display:none\}\}/,
    '',
    'gating: removed the desktop hide'
  );
  assert.throws(() => assertSnapshotIsGated(poisoned), /above the mobile breakpoint/);
});

test('control: dropping the returning-guest probe fails the gating test', () => {
  const poisoned = mutate(
    src.index,
    /localStorage\.getItem\("saycrd-local-sessions"\)/,
    'null',
    'gating: removed the guest-session probe'
  );
  assert.throws(() => assertSnapshotIsGated(poisoned), /returning-guest probe is gone/);
});

test('control: a desktop-width snapshot fails the visibility test', () => {
  // The single most valuable control here: it proves the visibility check
  // actually distinguishes a visible homepage from an invisible one, rather than
  // passing on any render that contains the right words.
  const desktop = renderAtWidth(1280);
  const text = prerender.visibleText(desktop);
  assert.ok(text.includes('The space between your inner world'),
    'the desktop render still contains the copy — which is exactly why presence alone is not enough');
  assert.ok(hiddenElementCount(desktop) > 0, 'the mutation must actually produce hidden elements');
  assert.throws(() => prerender.verify(desktop), /opacity:0/);
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
