'use strict';

/*
 * The mobile landing "flash": page appears, disappears, reappears.
 *
 * Cause, measured in a real browser at 393px: index.html dispatches
 * "saycrd-auth-change" from getSession()/onAuthStateChange, which resolve on
 * their own schedule. The phase-0 handler treated any real auth event as "the
 * visitor just logged in" and called setPhase(8), so an event arriving after
 * the landing page had painted unmounted a page the visitor was reading --
 * landing visible at 262ms, replaced by the Dashboard at 2430ms.
 *
 * The fix must NOT be "background auth never routes on mobile", because that
 * breaks the legitimate returning user. The discriminator is which decision
 * the event belongs to:
 *
 *   bootedWithSession   a token existed at mount, so the boot gate owns this
 *                       visitor's first destination and sends them to the
 *                       Dashboard without painting the landing page at all.
 *                       Late resolution is still that same initial decision.
 *   _authUserInitiated  the visitor opened the login overlay and signed in.
 *
 * Only when neither holds is navigation a forced one mid-session.
 *
 * WHY THIS FILE IS SHAPED LIKE THIS: app.jsx is a browser bundle with no
 * exports and there is no jsdom/React in node_modules, so -- following
 * post-login-routing.test.js, session-balance-ui.test.js and
 * mobile-landing-header.test.js -- the real handleAuthChange source is lifted
 * out of public/app.jsx and EXECUTED against controlled inputs. A text match
 * on the guard would still pass if its operands were inverted, so every
 * routing claim below runs the actual function.
 *
 * Structural claims run against comment-stripped source. This file's own
 * explanation contains the strings it asserts on ("_authUserInitiated",
 * "setPhase(8)"), and a previous version of a sibling test passed because it
 * matched an explanatory COMMENT rather than code.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const APP_JSX = path.join(__dirname, '..', '..', 'public', 'app.jsx');
const INDEX_HTML = path.join(__dirname, '..', '..', 'public', 'index.html');
const COMPILED = path.join(__dirname, '..', '..', 'public', 'app.compiled.js');

const appSrc = fs.readFileSync(APP_JSX, 'utf8');
const htmlSrc = fs.readFileSync(INDEX_HTML, 'utf8');

/* Remove // and block comments plus JSX comments, so a structural claim can
   never be satisfied by prose. Deliberately conservative: it also strips the
   contents of strings containing "//" (e.g. URLs), which is fine because no
   assertion here depends on one. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}
const appCode = stripComments(appSrc);
const htmlCode = stripComments(htmlSrc);

/* Brace-matching extractor. An extractor anchored on "the first { after the
   name" is the recurring bug in this suite: for a destructured parameter list
   it grabs the destructuring brace and returns a body-less fragment against
   which every later assertion passes while checking nothing. This one finds
   the parameter list, walks past it, and only then matches braces -- and the
   callers below assert the result is big enough to be a real body. */
function extractFunction(src, name) {
  const decl = 'function ' + name + '(';
  const start = src.indexOf(decl);
  assert.ok(start >= 0, 'could not find function ' + name);
  let i = src.indexOf('(', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) { i++; break; } }
  }
  while (i < src.length && src[i] !== '{') i++;
  const bodyStart = i;
  depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i).replace(src.slice(start, bodyStart), decl.slice(0, -1) + '() ');
}

/* index.html declares these as `window.foo = function(...)`, not `function
   foo(...)`, so they need their own anchor. Same brace-walking body logic. */
function extractAssignedFunction(src, name) {
  const decl = name + ' = function';
  const start = src.indexOf(decl);
  assert.ok(start >= 0, 'could not find assigned function ' + name);
  let i = src.indexOf('(', start);
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '(') depth++;
    else if (src[i] === ')') { depth--; if (depth === 0) { i++; break; } }
  }
  while (i < src.length && src[i] !== '{') i++;
  depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) { i++; break; } }
  }
  return src.slice(start, i);
}

const handlerSrc = extractFunction(appCode, 'handleAuthChange');

test('extractor produced a real handleAuthChange body, not a fragment', () => {
  assert.ok(
    handlerSrc.length > 400,
    'extracted body is only ' + handlerSrc.length + ' chars -- extractor is broken, ' +
    'and every routing assertion below would pass against nothing'
  );
  for (const marker of ['isReal', 'routedOnAuth', 'setPhase']) {
    assert.ok(handlerSrc.includes(marker), 'extracted body missing ' + marker);
  }
});

/* Build the real handler with injected dependencies. routedOnAuth lives in the
   enclosing effect, so it is declared in the factory preamble exactly as the
   effect declares it. */
function makeHandler(opts) {
  const routes = [];
  const win = {
    currentUser: opts.currentUser === undefined ? null : opts.currentUser,
    _authUserInitiated: !!opts.authUserInitiated,
  };
  const phaseRef = { current: opts.phase };
  const setPhase = (p) => { routes.push(p); phaseRef.current = p; };
  const factory = new Function(
    'window', 'phaseRef', 'setPhase', '_isMobileViewport', 'bootedWithSession',
    'var routedOnAuth = false;\n' + handlerSrc + '\nreturn handleAuthChange;'
  );
  const handler = factory(
    win, phaseRef, setPhase,
    () => !!opts.isMobile,
    { current: !!opts.bootedWithSession }
  );
  return { handler, routes, phaseRef, win };
}

const REAL_USER = { id: '11111111-2222-3333-4444-555555555555', email: 'r@e.com' };
const DASHBOARD = 8;

/* ── Routing case 1: signed-out mobile visitor stays on the landing page ── */

test('mobile: background auth does NOT move a visitor who booted signed-out', () => {
  const h = makeHandler({ isMobile: true, bootedWithSession: false, phase: 0, currentUser: REAL_USER });
  h.handler();
  assert.deepStrictEqual(h.routes, [], 'the landing page was unmounted under the visitor');
  assert.strictEqual(h.phaseRef.current, 0);
});

test('mobile: repeated background auth events still never navigate', () => {
  const h = makeHandler({ isMobile: true, bootedWithSession: false, phase: 0, currentUser: REAL_USER });
  h.handler(); h.handler(); h.handler();
  assert.deepStrictEqual(h.routes, []);
});

/* ── Routing case 2: returning authenticated user reaches the Dashboard ── */

test('mobile: a visitor who booted WITH a session still routes to the Dashboard', () => {
  const h = makeHandler({ isMobile: true, bootedWithSession: true, phase: 0, currentUser: REAL_USER });
  h.handler();
  assert.deepStrictEqual(h.routes, [DASHBOARD],
    'legitimate returning-user routing was suppressed -- this is the failure mode the fix must avoid');
});

test('mobile: late resolution for a booted-with-session visitor still routes', () => {
  // The boot gate bails after BOOT_AUTH_TIMEOUT_MS; auth can land afterwards.
  // That is still this visitor's initial destination decision.
  const h = makeHandler({ isMobile: true, bootedWithSession: true, phase: 0, currentUser: REAL_USER });
  h.handler();
  assert.deepStrictEqual(h.routes, [DASHBOARD]);
});

/* ── Routing case 3: an explicit login always routes ── */

test('mobile: a user-initiated login routes to the Dashboard even with no token at boot', () => {
  const h = makeHandler({
    isMobile: true, bootedWithSession: false, phase: 0,
    currentUser: REAL_USER, authUserInitiated: true,
  });
  h.handler();
  assert.deepStrictEqual(h.routes, [DASHBOARD], 'an actual login must never be swallowed by the guard');
});

/* ── Routing case 4: desktop behaviour is unchanged ── */

test('desktop: background auth routes exactly as it did before the fix', () => {
  const h = makeHandler({ isMobile: false, bootedWithSession: false, phase: 0, currentUser: REAL_USER });
  h.handler();
  assert.deepStrictEqual(h.routes, [DASHBOARD], 'desktop routing must be preserved');
});

/* ── Routing case 5: no forced navigation mid-session ── */

for (const phase of [1, 2, 5, 7, 9]) {
  test('mid-session (phase ' + phase + '): a real auth event never navigates', () => {
    const h = makeHandler({
      isMobile: true, bootedWithSession: true, phase,
      currentUser: REAL_USER, authUserInitiated: true,
    });
    h.handler();
    assert.deepStrictEqual(h.routes, [], 'a visitor mid-session was yanked to the Dashboard');
  });
}

/* ── Sign-out / guest handling must survive the new guard ── */

test('signing out from an account-gated screen still navigates away from it', () => {
  for (const phase of [7, 8, 9]) {
    const h = makeHandler({ isMobile: true, bootedWithSession: true, phase, currentUser: null });
    h.handler();
    assert.deepStrictEqual(h.routes, [0], 'phase ' + phase + ' kept showing session data after sign-out');
  }
});

test('"Continue without account" does not burn the one-shot routing latch', () => {
  // Regression from PR #50: a non-real event used to spend the latch, stranding
  // the genuine login that followed.
  const h = makeHandler({ isMobile: true, bootedWithSession: true, phase: 0, currentUser: null });
  h.handler();
  assert.deepStrictEqual(h.routes, []);
  h.win.currentUser = REAL_USER;
  h.handler();
  assert.deepStrictEqual(h.routes, [DASHBOARD], 'the real login after a guest event never routed');
});

test('a local-user (guest) id is not treated as a real account', () => {
  const h = makeHandler({
    isMobile: true, bootedWithSession: true, phase: 0,
    currentUser: { id: 'local-user' },
  });
  h.handler();
  assert.deepStrictEqual(h.routes, []);
});

/* ── The guard's wiring in app.jsx ── */

test('bootedWithSession is seeded from the same probe that arms the boot gate', () => {
  assert.match(
    appCode,
    /bootedWithSession\s*=\s*useRef\(\s*_authMayBeSignedIn\(\)\s*\)/,
    'bootedWithSession must come from _authMayBeSignedIn() so it cannot disagree with authResolving'
  );
  assert.match(appCode, /useState\(_authMayBeSignedIn\)/,
    'the boot gate must still be armed by the same synchronous probe');
});

test('_isMobileViewport uses the same 480px breakpoint as the layout code', () => {
  const fn = extractFunction(appCode, '_isMobileViewport');
  assert.ok(fn.length > 60, 'extracted _isMobileViewport is too small to be real');
  assert.match(fn, /innerWidth\s*<\s*480/);
});

test('the guard sits BEFORE the route, not after it', () => {
  const guard = handlerSrc.indexOf('_isMobileViewport');
  const latch = handlerSrc.indexOf('routedOnAuth = true');
  assert.ok(guard >= 0 && latch >= 0, 'guard or latch missing from the handler');
  assert.ok(guard < latch,
    'the guard must run before routedOnAuth is set, or the latch is spent on a route that never happens');
});

/* ── index.html: intent flag and the dismissal paths ── */

test('_showAuthOverlay marks the login as user-initiated', () => {
  const fn = extractAssignedFunction(htmlCode, 'window._showAuthOverlay');
  assert.ok(fn.length > 200, 'extracted _showAuthOverlay is too small to be real');
  assert.match(fn, /window\._authUserInitiated\s*=\s*true/);
});

test('signing out clears the user-initiated flag', () => {
  assert.match(
    htmlCode,
    /window\.currentUser\s*=\s*null;\s*window\._authUserInitiated\s*=\s*false;\s*window\.dispatchEvent/,
    'sign-out must clear _authUserInitiated before dispatching, or the next background event looks like a login'
  );
});

test('_closeAuthOverlay hides the overlay and clears both pieces of auth state', () => {
  const fn = extractAssignedFunction(htmlCode, 'window._closeAuthOverlay');
  assert.ok(fn.length > 150, 'extracted _closeAuthOverlay is too small to be real');
  assert.match(fn, /classList\.remove\(["']is-visible["']\)/);
  assert.match(fn, /_authSuccessCallback\s*=\s*null/,
    'an abandoned flow must not resume later in the page load');
  assert.match(fn, /_authUserInitiated\s*=\s*false/);
});

test('_closeAuthOverlay does not touch scroll position', () => {
  const fn = extractAssignedFunction(htmlCode, 'window._closeAuthOverlay');
  assert.ok(!/scrollTo|scrollTop\s*=|overflow\s*=/.test(fn),
    'the overlay is position:fixed, so rewriting scroll here would MOVE the visitor rather than restore them');
});

test('the overlay has a visible close control and a worded escape', () => {
  assert.match(htmlSrc, /id="auth-close"[^>]*aria-label="[^"]+"/,
    'the x control needs an accessible label');
  assert.match(htmlSrc, /id="auth-close"[^>]*onclick="window\._closeAuthOverlay\(\)"/);
  assert.match(htmlSrc, /id="auth-back"[^>]*onclick="window\._closeAuthOverlay\(\)"/);
  assert.match(htmlSrc, /id="auth-back"[^>]*>\s*Back to the page\s*</);
});

test('the worded escape is outside the row that requireAccount hides', () => {
  // #auth-bypass-row is display:none in requireAccount mode. If #auth-back were
  // inside it, the only remaining exit would be the unlabelled x icon.
  const rowStart = htmlSrc.indexOf('id="auth-bypass-row"');
  const backIdx = htmlSrc.indexOf('id="auth-back"');
  assert.ok(rowStart >= 0 && backIdx > rowStart, 'expected #auth-back after the bypass row');
  const between = htmlSrc.slice(rowStart, backIdx);
  const opens = (between.match(/<div\b/g) || []).length;
  const closes = (between.match(/<\/div>/g) || []).length;
  assert.ok(closes > opens, '#auth-back is still nested inside the hideable bypass row');
});

test('Escape and backdrop-click both dismiss the overlay', () => {
  assert.match(htmlCode, /addEventListener\(["']keydown["']/, 'no Escape handler registered');
  const esc = htmlCode.slice(htmlCode.indexOf('addEventListener("keydown"'));
  assert.match(esc.slice(0, 400), /Escape/);
  assert.match(esc.slice(0, 400), /_closeAuthOverlay\(\)/);
  assert.match(htmlCode, /e\.target === overlay/,
    'backdrop dismissal must be target-checked so a click inside the card does not close it');
});

test('the close control meets the 44px touch-target minimum', () => {
  const css = htmlSrc.slice(htmlSrc.indexOf('.auth-close{'), htmlSrc.indexOf('.auth-close:hover'));
  const w = css.match(/width:(\d+)px/);
  const h = css.match(/height:(\d+)px/);
  assert.ok(w && Number(w[1]) >= 44, 'close control width is under 44px');
  assert.ok(h && Number(h[1]) >= 44, 'close control height is under 44px');
});

/* ── The shipped bundle must actually contain the fix ── */

test('app.compiled.js carries the guard and is newer than the source', () => {
  const compiled = fs.readFileSync(COMPILED, 'utf8');
  // Assert on STRING LITERALS only: the bundle is minified, so local names like
  // bootedWithSession are renamed and asserting on them could never pass.
  assert.ok(compiled.includes('_authUserInitiated'),
    'the rebuilt bundle is missing the intent flag -- app.compiled.js was not regenerated');
  assert.ok(compiled.includes('innerWidth'), 'the rebuilt bundle is missing the viewport probe');
});

test('the cache-busting version was bumped in both places', () => {
  const refs = htmlSrc.match(/app\.compiled\.js\?v=([0-9-]+)/g) || [];
  assert.strictEqual(refs.length, 2, 'expected exactly 2 versioned references to app.compiled.js');
  assert.strictEqual(refs[0], refs[1], 'the preload and the script tag disagree, so one of them serves a stale bundle');
  assert.ok(!refs[0].endsWith('20260907-13'), 'the version was not bumped, so browsers keep the cached bundle');
});
