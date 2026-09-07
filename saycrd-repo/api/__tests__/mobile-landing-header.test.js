'use strict';

/*
 * Signed-out mobile landing header + reveal timing.
 *
 * Why the shape of this file: app.jsx is a browser bundle with no exports and
 * there is no jsdom/React in node_modules, so — following the pattern already
 * used by session-balance-ui.test.js and post-login-routing.test.js — these
 * tests lift real function source out of public/app.jsx.
 *
 * _isDebugSurface() needs nothing but `window`, so it is EXECUTED against
 * hand-built globals rather than pattern-matched. The layout/timing guards are
 * necessarily structural (they live inside JSX style props), so each one is
 * scoped to LandingPhase's extracted body and asserts on parsed numbers, not
 * on the presence of a string. Negative controls at the bottom prove the whole
 * file can go red.
 *
 * NOTE on the extractor: `LandingPhase({ onStart, onNavigateLegal })` takes a
 * DESTRUCTURED parameter. An extractor anchored on "first `{` after the name"
 * grabs that destructuring brace and yields a body-less fragment, against which
 * every assertion below would pass while checking nothing. This extractor walks
 * the parameter list first and guards on body length.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', '..', 'public');
const APP_JSX = path.join(PUBLIC, 'app.jsx');
const COMPILED = path.join(PUBLIC, 'app.compiled.js');
const SOURCE = fs.readFileSync(APP_JSX, 'utf8');

function extractFunction(src, name) {
  const decl = new RegExp('function\\s+' + name + '\\s*\\(', 'g');
  const m = decl.exec(src);
  if (!m) throw new Error('function not found: ' + name);

  // Walk the parameter list to its closing paren so a destructured param
  // cannot be mistaken for the function body.
  let i = m.index + m[0].length;
  let parenDepth = 1;
  while (i < src.length && parenDepth > 0) {
    if (src[i] === '(') parenDepth++;
    else if (src[i] === ')') parenDepth--;
    i++;
  }
  const bodyStart = src.indexOf('{', i);
  if (bodyStart < 0) throw new Error('body brace not found: ' + name);

  let depth = 0;
  let j = bodyStart;
  for (; j < src.length; j++) {
    if (src[j] === '{') depth++;
    else if (src[j] === '}') {
      depth--;
      if (depth === 0) { j++; break; }
    }
  }
  const out = src.slice(m.index, j);
  if (out.length < 200) {
    throw new Error('suspiciously short body for ' + name + ' (' + out.length + ' chars)');
  }
  return out;
}

/* Run a source-extracted function with a controlled `window`. */
function runDebugSurface(win) {
  const src = extractFunction(SOURCE, '_isDebugSurface');
  // eslint-disable-next-line no-new-func
  const make = new Function('window', 'URLSearchParams', src + '; return _isDebugSurface;');
  return make(win, URLSearchParams)();
}

/* Strip comments before making any structural claim about the code.
   This is not cosmetic: the first draft of this file asserted that `"begin"`
   sits inside a !isMobile gate and FAILED against correct source, because the
   explanatory comment above the gate contains the word "begin" in quotes and
   was matched first. Any test that greps source has to look at code only.
   String literals are respected so a "https://" inside one is not eaten. */
function stripComments(src) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      out += c;
      if (c === '\\') { out += next === undefined ? '' : next; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; out += c; i++; continue; }
    if (c === '/' && next === '*') {
      const end = src.indexOf('*/', i + 2);
      i = end < 0 ? src.length : end + 2;
      out += ' ';
      continue;
    }
    if (c === '/' && next === '/') {
      const end = src.indexOf('\n', i);
      i = end < 0 ? src.length : end;
      out += ' ';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const LANDING_RAW = extractFunction(SOURCE, 'LandingPhase');
const LANDING = stripComments(LANDING_RAW);

/* Sum the delay + duration out of a CSS transition shorthand, in ms. */
function transitionMs(value) {
  const times = value.match(/([0-9]*\.?[0-9]+)s/g) || [];
  return times.reduce((acc, t) => acc + parseFloat(t) * 1000, 0);
}

/* Every reveal("<desktop>", "<mobile>") pair inside LandingPhase. */
function revealPairs() {
  const re = /reveal\(\s*"([^"]*)"\s*,\s*"([^"]*)"\s*\)/g;
  const out = [];
  let m;
  while ((m = re.exec(LANDING)) !== null) out.push({ desktop: m[1], mobile: m[2] });
  return out;
}

/* reveal() is used for two different kinds of value: CSS transition shorthands
   (which carry timings) and translateY offsets (which do not). Timing
   assertions apply only to the former, distance assertions only to the
   latter -- lumping them together is what made the first draft of this file
   fail against its own correct source. */
const HAS_TIME = /[0-9]s\b|[0-9]\.[0-9]+s\b/;
function transitionPairs() {
  return revealPairs().filter((p) => HAS_TIME.test(p.desktop) && HAS_TIME.test(p.mobile));
}
function transformPairs() {
  return revealPairs().filter((p) => /translate/.test(p.desktop) && /translate/.test(p.mobile));
}
function pxOf(value) {
  const m = value.match(/(-?[0-9]*\.?[0-9]+)px/);
  return m ? Math.abs(parseFloat(m[1])) : NaN;
}

// ---------------------------------------------------------------------------
// The extractor itself
// ---------------------------------------------------------------------------

test('extractor returns a real LandingPhase body, not the destructuring brace', () => {
  assert.ok(LANDING.length > 4000, 'LandingPhase body implausibly small: ' + LANDING.length);
  // If the destructuring brace had been used as the body start, the fragment
  // would stop at `onNavigateLegal }` and contain no JSX at all.
  assert.ok(LANDING.includes('BLINDSPOT'), 'extracted body is missing the wordmark');
  assert.ok(LANDING.includes('return'), 'extracted body has no return statement');
});

// ---------------------------------------------------------------------------
// Diagnostic label: off by default, on with an explicit flag
// ---------------------------------------------------------------------------

test('_isDebugSurface is false with no query string and no flag', () => {
  assert.strictEqual(runDebugSurface({ location: { search: '' } }), false);
});

test('_isDebugSurface is false for an unrelated query string', () => {
  assert.strictEqual(runDebugSurface({ location: { search: '?ref=twitter&utm_source=x' } }), false);
});

test('_isDebugSurface is true for ?debug=1', () => {
  assert.strictEqual(runDebugSurface({ location: { search: '?debug=1' } }), true);
});

test('_isDebugSurface is true for ?debug=1 among other params', () => {
  assert.strictEqual(runDebugSurface({ location: { search: '?a=b&debug=1&c=d' } }), true);
});

test('_isDebugSurface is false for ?debug=0 and ?debug alone', () => {
  assert.strictEqual(runDebugSurface({ location: { search: '?debug=0' } }), false);
  assert.strictEqual(runDebugSurface({ location: { search: '?debug' } }), false);
  assert.strictEqual(runDebugSurface({ location: { search: '?debug=true' } }), false);
});

test('_isDebugSurface honours the window._saycrdDebug escape hatch, strictly', () => {
  assert.strictEqual(runDebugSurface({ _saycrdDebug: true, location: { search: '' } }), true);
  // Truthy-but-not-true must NOT enable it: a stray string on window should
  // never turn the readout on for a real visitor.
  assert.strictEqual(runDebugSurface({ _saycrdDebug: 'yes', location: { search: '' } }), false);
  assert.strictEqual(runDebugSurface({ _saycrdDebug: 1, location: { search: '' } }), false);
});

test('_isDebugSurface swallows a throwing location instead of breaking the app', () => {
  const hostile = { get location() { throw new Error('blocked'); } };
  assert.strictEqual(runDebugSurface(hostile), false);
});

test('the v5.2 phase readout is rendered only behind the debug gate', () => {
  const line = SOURCE.split('\n').find((l) => l.includes('v5.2 |'));
  assert.ok(line, 'the v5.2 readout no longer exists — update or delete this test');
  assert.ok(
    /_isDebugSurface\(\)\s*&&/.test(line),
    'the v5.2 readout is not gated by _isDebugSurface(): ' + line.trim().slice(0, 120)
  );
});

// ---------------------------------------------------------------------------
// The nav CTA must not render on phones
// ---------------------------------------------------------------------------

test('LandingPhase derives a phone breakpoint and keeps it current on resize', () => {
  assert.ok(/window\.innerWidth\s*<\s*480/.test(LANDING), 'no innerWidth < 480 breakpoint');
  assert.ok(/addEventListener\(\s*"resize"/.test(LANDING), 'breakpoint never updates on resize');
  assert.ok(/removeEventListener\(\s*"resize"/.test(LANDING), 'resize listener is never cleaned up');
});

/* The nav CTA is the pill-shaped one (padding 10px 26px); the hero CTA is the
   larger one below the fold line (padding 16px 36px). Identifying them by
   their own style rather than by ordinal keeps these tests meaningful if the
   markup around them moves. */
const NAV_CTA = 'padding:"10px 26px"';
const HERO_CTA = 'padding:"16px 36px"';

function gateOpenAt(index) {
  // Is `index` inside a `{!isMobile && ( ... )}` block?
  const before = LANDING.slice(0, index);
  const gate = before.lastIndexOf('{!isMobile && (');
  if (gate < 0) return false;
  // Count paren depth from the gate to the target; if it has returned to 0 the
  // block already closed and the target is outside it.
  let depth = 0;
  for (let i = gate + '{!isMobile && '.length; i < index; i++) {
    const ch = LANDING[i];
    if (ch === '(') depth++;
    else if (ch === ')') {
      depth--;
      if (depth === 0) return false;
    }
  }
  return depth > 0;
}

test('the nav CTA is gated behind !isMobile so it cannot render on phones', () => {
  const idx = LANDING.indexOf(NAV_CTA);
  assert.ok(idx > -1, 'nav CTA not found by its padding — update NAV_CTA');
  assert.ok(
    gateOpenAt(idx),
    'the nav CTA is not inside a !isMobile gate — it will overlap the auth control on phones'
  );
});

test('the legacy "begin" label only exists inside the gated nav CTA', () => {
  const labels = [...LANDING.matchAll(/"begin"/g)].map((m) => m.index);
  assert.ok(labels.length > 0, 'the legacy "begin" label is gone entirely — update this test');
  for (const at of labels) {
    assert.ok(gateOpenAt(at), 'a "begin" label at ' + at + ' is reachable on mobile');
  }
});

test('the hero CTA is NOT gated by isMobile, so phones keep the primary action', () => {
  const idx = LANDING.indexOf(HERO_CTA);
  assert.ok(idx > -1, 'hero CTA not found by its padding — update HERO_CTA');
  assert.ok(
    !gateOpenAt(idx),
    'the hero CTA has been wrapped in a !isMobile gate — mobile would lose its primary action'
  );
});

test('the auth control is never gated behind the mobile breakpoint', () => {
  const idxs = [...LANDING.matchAll(/_showAuthOverlay/g)].map((m) => m.index);
  assert.ok(idxs.length > 0, 'auth control not found in LandingPhase');
  for (const at of idxs) {
    assert.ok(!gateOpenAt(at), 'an auth control at ' + at + ' is hidden on mobile');
  }
});

test('mobile header uses a fixed gutter and a tighter wordmark so the two controls fit', () => {
  assert.ok(
    /isMobile \? "0 20px" : "0 7vw"/.test(LANDING),
    'mobile gutter is still 7vw, which overflows at 320px'
  );
  assert.ok(
    /fontSize: isMobile \? 16 : 18/.test(LANDING),
    'wordmark font size is not reduced on mobile'
  );
  assert.ok(
    /letterSpacing: isMobile \? "0\.18em" : "0\.3em"/.test(LANDING),
    'wordmark letter-spacing is not tightened on mobile'
  );
});

test('desktop header values are preserved verbatim', () => {
  assert.ok(LANDING.includes('"0 7vw"'), 'desktop 7vw gutter was removed');
  assert.ok(/: 18/.test(LANDING), 'desktop 18px wordmark was removed');
  assert.ok(LANDING.includes('"0.3em"'), 'desktop 0.3em letter-spacing was removed');
});

// ---------------------------------------------------------------------------
// Reveal timing: faster on mobile, still animated
// ---------------------------------------------------------------------------

test('the reveal helper picks the mobile value only on mobile', () => {
  assert.ok(
    /function reveal\(desktop, mobile\)\s*\{\s*return isMobile \? mobile : desktop; \}/.test(LANDING),
    'reveal() is missing or no longer selects on isMobile'
  );
});

test('reveal() covers both the transitions and the transforms', () => {
  assert.ok(revealPairs().length >= 5, 'expected at least 5 reveal() pairs, found ' + revealPairs().length);
  assert.ok(transitionPairs().length >= 3, 'expected at least 3 timed pairs, found ' + transitionPairs().length);
  assert.ok(transformPairs().length >= 2, 'expected at least 2 transform pairs, found ' + transformPairs().length);
  // Every pair must be classified, or a future edit could slip past unchecked.
  assert.strictEqual(
    transitionPairs().length + transformPairs().length,
    revealPairs().length,
    'some reveal() pair is neither a timed transition nor a transform'
  );
});

test('every timed reveal pair is strictly faster on mobile than on desktop', () => {
  for (const p of transitionPairs()) {
    const d = transitionMs(p.desktop);
    const m = transitionMs(p.mobile);
    assert.ok(d > 0, 'desktop transition has no timing: ' + p.desktop);
    assert.ok(m > 0, 'mobile transition has no timing: ' + p.mobile);
    assert.ok(m < d, 'mobile is not faster than desktop: "' + p.mobile + '" vs "' + p.desktop + '"');
  }
});

test('every reveal transform travels no further on mobile', () => {
  for (const p of transformPairs()) {
    const d = pxOf(p.desktop);
    const m = pxOf(p.mobile);
    assert.ok(Number.isFinite(d) && Number.isFinite(m), 'unparseable transform pair: ' + JSON.stringify(p));
    assert.ok(m <= d, 'mobile transform travels further: ' + p.mobile + ' vs ' + p.desktop);
    // Keep some movement: a 0px slide is a different (flatter) design.
    assert.ok(m > 0, 'mobile transform was flattened to zero: ' + p.mobile);
  }
});

test('the reveal keeps a real fade on mobile rather than snapping to opaque', () => {
  for (const p of transitionPairs()) {
    const durations = (p.mobile.match(/([0-9]*\.?[0-9]+)s/g) || []).map((t) => parseFloat(t) * 1000);
    // First number in the shorthand is the duration; it must remain non-trivial.
    assert.ok(durations[0] >= 250, 'mobile duration is too abrupt to read as a fade: ' + p.mobile);
  }
});

test('the whole mobile reveal finishes well under a second', () => {
  const worst = Math.max(...transitionPairs().map((p) => transitionMs(p.mobile)));
  assert.ok(worst <= 700, 'slowest mobile reveal is ' + worst + 'ms, expected <= 700ms');
  // And desktop must still be the slower, softer one.
  const worstDesktop = Math.max(...transitionPairs().map((p) => transitionMs(p.desktop)));
  assert.ok(worstDesktop > worst, 'desktop reveal is no longer slower than mobile');
});

test('the pre-reveal beat is shortened on mobile but not removed', () => {
  const m = LANDING.match(/setShow\(true\); \}, isMobile \? (\d+) : (\d+)\)/);
  assert.ok(m, 'the initial reveal timeout is no longer breakpoint-aware');
  const mobileDelay = parseInt(m[1], 10);
  const desktopDelay = parseInt(m[2], 10);
  assert.ok(mobileDelay < desktopDelay, 'mobile delay ' + mobileDelay + ' is not below desktop ' + desktopDelay);
  // Must stay > 0 so the opacity:0 initial state paints and the fade runs.
  assert.ok(mobileDelay > 0, 'mobile delay of 0 would skip the fade entirely');
  assert.ok(mobileDelay <= 50, 'mobile delay ' + mobileDelay + 'ms is still perceptible dead time');
});

test('the reveal timeout is cleaned up', () => {
  assert.ok(/clearTimeout\(t\)/.test(LANDING), 'the reveal timeout is never cleared');
});

// ---------------------------------------------------------------------------
// The shipped artifact must carry the same gates
// ---------------------------------------------------------------------------

test('the compiled bundle carries the debug gate and the mobile breakpoint', () => {
  const compiled = fs.readFileSync(COMPILED, 'utf8');
  assert.ok(compiled.includes('_isDebugSurface'), 'compiled bundle predates the debug gate');
  assert.ok(compiled.includes('_saycrdDebug'), 'compiled bundle is missing the debug escape hatch');
  assert.ok(/innerWidth\s*<\s*480/.test(compiled), 'compiled bundle has no phone breakpoint');
  assert.ok(compiled.includes('0 20px'), 'compiled bundle is missing the mobile gutter');
});

// ---------------------------------------------------------------------------
// Encoding ratchet
// ---------------------------------------------------------------------------

/* A tooling pass through this file silently turned a "→" inside an AI prompt
   string into three U+FFFD replacement characters. Nothing failed: the app
   still ran, and the damage was invisible except as garbage handed to the
   model. 16 such characters already exist in app.jsx and are out of scope
   here; this ratchet just refuses to let the count grow. */
const KNOWN_REPLACEMENT_CHARS = 16;

test('no new U+FFFD replacement characters creep into the bundle source', () => {
  const count = (SOURCE.match(/\uFFFD/g) || []).length;
  assert.ok(
    count <= KNOWN_REPLACEMENT_CHARS,
    'app.jsx gained replacement characters (' + count + ' > ' + KNOWN_REPLACEMENT_CHARS +
    '). Some tool has mangled non-ASCII text — check the diff for "\\uFFFD" before committing.'
  );
});

test('the compiled bundle carries no more mangled characters than its source', () => {
  const compiled = fs.readFileSync(COMPILED, 'utf8');
  const compiledCount = (compiled.match(/\uFFFD/g) || []).length;
  assert.ok(
    compiledCount <= KNOWN_REPLACEMENT_CHARS,
    'app.compiled.js has ' + compiledCount + ' replacement characters'
  );
});

test('the card-slider prompt keeps its arrow glyph', () => {
  const line = SOURCE.split('\n').find((l) => l.includes('cfLines = cfKeys.map'));
  assert.ok(line, 'card-slider prompt line not found — update this test');
  assert.ok(line.includes('\u2192'), 'the "→" in the card-slider prompt has been mangled');
  assert.ok(!line.includes('\uFFFD'), 'the card-slider prompt contains replacement characters');
});

// ---------------------------------------------------------------------------
// Negative controls — these prove the assertions above are load-bearing
// ---------------------------------------------------------------------------

test('NEGATIVE CONTROL: an ungated readout line is detected', () => {
  const ungated = '<div style={{ position: "fixed" }}>v5.2 | {cp}:{phase}</div>';
  assert.ok(!/_isDebugSurface\(\)\s*&&/.test(ungated), 'control line should look ungated');
});

test('NEGATIVE CONTROL: a "begin" label outside the gate is detected', () => {
  const bad = '<nav><button>{"begin"}</button></nav>';
  const idx = bad.indexOf('"begin"');
  assert.strictEqual(bad.slice(0, idx).lastIndexOf('{!isMobile && ('), -1,
    'control fragment should have no gate');
});

test('NEGATIVE CONTROL: a slower-on-mobile pair is detected', () => {
  const d = transitionMs('opacity 0.35s ease');
  const m = transitionMs('opacity 0.8s ease');
  assert.ok(!(m < d), 'control pair should be slower on mobile');
});

test('NEGATIVE CONTROL: the extractor rejects a body-less fragment', () => {
  const fake = 'function LandingPhase({ onStart, onNavigateLegal }) { }';
  assert.throws(() => extractFunction(fake, 'LandingPhase'), /suspiciously short body/);
});

test('NEGATIVE CONTROL: transitionMs returns 0 for a value with no timing', () => {
  assert.strictEqual(transitionMs('opacity ease'), 0);
});

test('NEGATIVE CONTROL: stripComments removes the exact trap that broke this file', () => {
  // A comment mentioning "begin" must not survive into the searchable body,
  // or the gate assertions match prose instead of code.
  const withComment = '/* its label was the legacy "begin", so */ var x = 1;';
  assert.ok(!stripComments(withComment).includes('"begin"'));
  const lineComment = '// the "begin" label\nvar y = 2;';
  assert.ok(!stripComments(lineComment).includes('"begin"'));
  // ...but a real string literal must survive untouched.
  assert.ok(stripComments('var u = "https://x.test/a";').includes('https://x.test/a'));
  assert.ok(stripComments('var l = "begin";').includes('"begin"'));
  // An apostrophe inside a comment must not open a phantom string and eat code.
  assert.ok(stripComments("/* don't */ var z = 3;").includes('var z = 3;'));
});

test('NEGATIVE CONTROL: gateOpenAt is false outside a gate and true inside one', () => {
  // Exercised against the real body: the wordmark is always rendered, the
  // "begin" label never is on mobile.
  const logoAt = LANDING.indexOf('BLINDSPOT');
  assert.ok(logoAt > -1);
  assert.strictEqual(gateOpenAt(logoAt), false, 'the wordmark must not be inside the mobile gate');
  assert.strictEqual(gateOpenAt(LANDING.indexOf('"begin"')), true);
  // A position before any gate at all.
  assert.strictEqual(gateOpenAt(5), false);
});
