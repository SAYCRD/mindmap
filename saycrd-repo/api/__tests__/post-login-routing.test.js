'use strict';

/*
 * Post-login routing + boot-gate tests.
 *
 * app.jsx is a browser bundle with no exports, and there is no jsdom or React
 * in node_modules, so — following the established pattern in
 * session-balance-ui.test.js — these tests lift the real function source out of
 * public/app.jsx, transform it, and run it against hand-built globals.
 *
 * The extractor is brace-balanced and, critically, anchored on the `function`
 * keyword and the FIRST `{` that opens the BODY. An earlier extractor in this
 * repo anchored on "the first `{` after the name", which for
 * `SessionBalance({ credits })` grabbed the destructuring brace and produced a
 * body-less fragment — every assertion then passed against nothing. Negative
 * controls at the bottom of this file exist to prove these tests can fail.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const APP_JSX = path.join(__dirname, '..', '..', 'public', 'app.jsx');
const SOURCE = fs.readFileSync(APP_JSX, 'utf8');

/* Extract `function NAME(...) { ... }` with balanced braces, skipping the
   parameter list so a destructured param can never be mistaken for the body. */
function extractFunction(src, name) {
  const decl = new RegExp('function\\s+' + name + '\\s*\\(', 'g');
  const m = decl.exec(src);
  if (!m) throw new Error('function not found: ' + name);

  // Walk the parameter list to its closing paren (handles nested braces).
  let i = m.index + m[0].length;
  let parenDepth = 1;
  while (i < src.length && parenDepth > 0) {
    if (src[i] === '(') parenDepth++;
    else if (src[i] === ')') parenDepth--;
    i++;
  }
  // The body's opening brace is the next `{`.
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
  // A real function here is substantially more than a signature. This guard is
  // what catches the body-less-fragment failure mode.
  if (out.length < 80) throw new Error('suspiciously short body for ' + name + ' (' + out.length + ' chars)');
  if (!/return|for|if/.test(out.slice(out.indexOf('{')))) {
    throw new Error('extracted fragment for ' + name + ' has no statements');
  }
  return out;
}

/* Build a callable copy of the two synchronous auth predicates against a
   controllable localStorage + location. */
function loadPredicates(opts) {
  const store = Object.assign({}, (opts && opts.storage) || {});
  const throwOnAccess = !!(opts && opts.throwOnAccess);
  const keys = Object.keys(store);

  const localStorage = {
    get length() {
      if (throwOnAccess) throw new Error('localStorage blocked');
      return keys.length;
    },
    key(i) {
      if (throwOnAccess) throw new Error('localStorage blocked');
      return keys[i];
    },
    getItem(k) {
      if (throwOnAccess) throw new Error('localStorage blocked');
      return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null;
    },
  };
  const location = { hash: (opts && opts.hash) || '' };

  const src =
    extractFunction(SOURCE, '_hasPersistedAuthToken') +
    '\n' +
    extractFunction(SOURCE, '_authMayBeSignedIn') +
    '\nreturn { _hasPersistedAuthToken: _hasPersistedAuthToken, _authMayBeSignedIn: _authMayBeSignedIn };';

  // eslint-disable-next-line no-new-func
  return new Function('localStorage', 'location', src)(localStorage, location);
}

/* ── The predicate that keeps public pages fast ── */

test('signed-out visitor is not gated: no auth token means no boot state', () => {
  const p = loadPredicates({ storage: {} });
  assert.strictEqual(p._authMayBeSignedIn(), false);
});

test('unrelated localStorage data does not trigger the boot state', () => {
  const p = loadPredicates({
    storage: {
      'saycrd-local-user-sessions': '[{"date":"x"}]',
      'saycrd-disclaimer-ack': '1',
      'theme': 'dark',
    },
  });
  assert.strictEqual(p._authMayBeSignedIn(), false);
});

test('a persisted supabase session IS detected', () => {
  const p = loadPredicates({
    storage: { 'sb-lydamoxkymwuccepeeyz-auth-token': '{"access_token":"t"}' },
  });
  assert.strictEqual(p._hasPersistedAuthToken(), true);
  assert.strictEqual(p._authMayBeSignedIn(), true);
});

test('detection is project-ref agnostic (changing Supabase project keeps it working)', () => {
  const p = loadPredicates({
    storage: { 'sb-someotherprojectref-auth-token': '{"access_token":"t"}' },
  });
  assert.strictEqual(p._authMayBeSignedIn(), true);
});

test('a PKCE code-verifier alone is not a session', () => {
  // Written during a sign-in that has not completed. Treating it as a session
  // would show the boot state to someone who is still signed out.
  const p = loadPredicates({
    storage: { 'sb-lydamoxkymwuccepeeyz-auth-token-code-verifier': 'abc123' },
  });
  assert.strictEqual(p._authMayBeSignedIn(), false);
});

test('an empty auth-token value is not a session', () => {
  const p = loadPredicates({ storage: { 'sb-ref-auth-token': '' } });
  assert.strictEqual(p._authMayBeSignedIn(), false);
});

test('magic-link/recovery callback in the URL fragment counts as maybe-signed-in', () => {
  const p = loadPredicates({
    storage: {},
    hash: '#access_token=eyJ&refresh_token=r&type=recovery',
  });
  assert.strictEqual(p._hasPersistedAuthToken(), false, 'nothing persisted yet');
  assert.strictEqual(p._authMayBeSignedIn(), true, 'but a session is arriving');
});

test('unavailable localStorage degrades to signed-out instead of throwing', () => {
  // Private mode / embedded webview. Must not break the public page.
  const p = loadPredicates({ throwOnAccess: true });
  assert.strictEqual(p._authMayBeSignedIn(), false);
});

/* ── The bounded boot gate ── */

test('boot timeout is short enough to never feel like a hang', () => {
  const m = SOURCE.match(/BOOT_AUTH_TIMEOUT_MS\s*=\s*(\d+)/);
  assert.ok(m, 'BOOT_AUTH_TIMEOUT_MS must be defined');
  const ms = Number(m[1]);
  assert.ok(ms > 0, 'must be a positive bound');
  assert.ok(ms <= 1500, 'boot state must not hold the first route for >1.5s, got ' + ms);
});

test('the boot gate is bounded by BOTH _authReady and a timeout', () => {
  const fn = extractFunction(SOURCE, 'SAYCRDFlow');
  const effect = fn.slice(fn.indexOf('if (!authResolving) return;'));
  const scoped = effect.slice(0, effect.indexOf('window.addEventListener("saycrd-auth-change", handleAuthChange)'));
  assert.match(scoped, /setTimeout\(\s*settle\s*,\s*BOOT_AUTH_TIMEOUT_MS\s*\)/, 'needs the timeout backstop');
  assert.match(scoped, /_authReady/, 'needs to settle on auth resolving');
  assert.match(scoped, /\.then\(\s*settle\s*,\s*settle\s*\)/, 'a REJECTED auth promise must settle too, not hang');
  assert.match(scoped, /else\s+settle\(\)/, 'must settle immediately when no auth promise exists');
});

test('boot gate settles exactly once even if auth and timeout both fire', () => {
  // Guards against a double setPhase / double setState on a slow connection
  // where _authReady resolves right around the timeout.
  const fn = extractFunction(SOURCE, 'SAYCRDFlow');
  const effect = fn.slice(fn.indexOf('if (!authResolving) return;'));
  assert.match(effect.slice(0, 900), /var settled = false;[\s\S]*if \(settled\) return;[\s\S]*settled = true;/);
});

test('the boot gate renders instead of the landing page only while resolving', () => {
  assert.match(
    SOURCE,
    /cp==="landing"&&\(authResolving\?<BootGate\/>:<LandingPhase/,
    'landing must be swapped for BootGate only when authResolving is true'
  );
});

test('BootGate announces itself to assistive tech without an undefined sr-only class', () => {
  const fn = extractFunction(SOURCE, 'BootGate');
  assert.match(fn, /role="status"/);
  assert.match(fn, /aria-live="polite"/);
  // .sr-only is NOT defined in this app's CSS, so using it would render the
  // text visibly and duplicate the label on screen.
  assert.ok(!/sr-only/.test(fn), 'must not rely on an undefined .sr-only class');
});

/* ── The routing bug this PR fixes ── */

test('initial phase is the landing page, not a currentUser-dependent guess', () => {
  // The old initializer was `_hasReturningSessions() ? 8 : 0`, which read
  // window.currentUser — assigned by index.html only AFTER app.compiled.js
  // runs — so it was false on every load and never routed anyone.
  assert.match(SOURCE, /const \[phase, setPhase\] = useState\(0\);/);
  assert.ok(
    !/useState\(function\(\)\{ return _hasReturningSessions\(\)/.test(SOURCE),
    'must not resurrect the never-true initializer'
  );
});

test('_hasReturningSessions is fully removed, not left dead', () => {
  // Its declaration and every CALL must be gone. Historical mentions inside
  // comments are intentionally allowed — they document why the old
  // window.currentUser-dependent initializer never worked.
  assert.ok(
    !/function\s+_hasReturningSessions\s*\(/.test(SOURCE),
    'declaration should be gone'
  );
  const codeOnly = SOURCE
    .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
    .replace(/^\s*\/\/.*$/gm, '');      // whole-line comments
  assert.ok(
    !/_hasReturningSessions\s*\(/.test(codeOnly),
    'no live calls should remain'
  );
});

test('the one-shot auth-routing latch is only set when a route actually happened', () => {
  const fn = extractFunction(SOURCE, 'SAYCRDFlow');
  const handler = fn.slice(fn.indexOf('function handleAuthChange()'));
  const body = handler.slice(0, handler.indexOf('window.addEventListener'));

  // The latch must be set INSIDE the successful-route branch...
  assert.match(
    body,
    /if \(phaseRef\.current === 0 && isReal\) \{[\s\S]*routedOnAuth = true;[\s\S]*setPhase\(8\);[\s\S]*\}/,
    'routedOnAuth must be set together with setPhase(8)'
  );

  // ...and must NOT be set unconditionally right after the early return, which
  // is what let a guest event burn the latch and strand a real login.
  assert.ok(
    !/if \(routedOnAuth\) return;\s*routedOnAuth = true;/.test(body),
    'latch must not be burned before the isReal check'
  );
});

test('auth state is re-read immediately, not only via the event', () => {
  // index.html dispatches saycrd-auth-change from microtask callbacks on a
  // cached session, which can fire before this macrotask-scheduled effect
  // attaches its listener. Without a direct call the event is lost for the
  // whole page load.
  const fn = extractFunction(SOURCE, 'SAYCRDFlow');
  const idx = fn.indexOf('window.addEventListener("saycrd-auth-change", handleAuthChange)');
  assert.ok(idx > 0);
  const after = fn.slice(idx, idx + 700);
  assert.match(after, /handleAuthChange\(\);/, 'must call handleAuthChange() directly after subscribing');
});

test('signing out still navigates away from account-gated phases', () => {
  // Pre-existing protection that must survive this refactor: leaving the
  // Dashboard/Journeys/Report phases mounted after sign-out would keep another
  // person's session history on screen.
  const fn = extractFunction(SOURCE, 'SAYCRDFlow');
  const handler = fn.slice(fn.indexOf('function handleAuthChange()'));
  const notReal = handler.slice(handler.indexOf('if (!isReal)'), handler.indexOf('if (routedOnAuth) return;'));
  assert.match(
    notReal,
    /phaseRef\.current === 7 \|\| phaseRef\.current === 8 \|\| phaseRef\.current === 9/,
    'sign-out must still detect the account-gated phases'
  );
  assert.match(notReal, /setPhase\(0\)/, 'and navigate back to the public landing page');
});

test('signing out re-arms the routing latch so a re-login still routes', () => {
  // Regression: sign-out reset phase to 0 but left the one-shot latch spent,
  // so signing out and back in during a single page load stranded the second
  // login on the landing page. Verified live in the browser before the fix.
  const fn = extractFunction(SOURCE, 'SAYCRDFlow');
  const handler = fn.slice(fn.indexOf('function handleAuthChange()'));
  const notReal = handler.slice(handler.indexOf('if (!isReal)'), handler.indexOf('if (routedOnAuth) return;'));
  assert.match(notReal, /routedOnAuth = false;/, 'the latch must be re-armed on sign-out');
});

test('post-login destination is the Dashboard (8), never the completion ceremony (7)', () => {
  const fn = extractFunction(SOURCE, 'SAYCRDFlow');
  const handler = fn.slice(fn.indexOf('function handleAuthChange()'));
  const body = handler.slice(0, handler.indexOf('window.addEventListener'));
  assert.ok(/setPhase\(8\)/.test(body), 'routes to the Dashboard');
  assert.ok(!/setPhase\(7\)/.test(body), 'must never route to the post-session ceremony');
});

/* ── Session history after a late login ── */

test('useSyncedSessions re-loads from the server once the account becomes real', () => {
  const fn = extractFunction(SOURCE, 'useSyncedSessions');
  assert.match(fn, /saycrd-auth-change/, 'must listen for auth changes');
  assert.match(fn, /\}, \[authTick\]\);/, 'server-load effect must re-run on auth change, not [] once');
  assert.match(fn, /setSessions\(loadSessions\(\)\)/, 'must re-read the uid-keyed local cache on auth change');
});

/* ── First-run destination ── */

test('a brand-new account gets a real first-run dashboard, not a bare empty list', () => {
  const fn = extractFunction(SOURCE, 'JourneysPhase');
  assert.match(fn, /GETTING STARTED/);
  assert.match(fn, /Welcome to Blindspot/);
  assert.match(fn, /This is your dashboard\./);
  assert.ok(!/No sessions yet\. Start your first\./.test(fn), 'bare empty state should be replaced');
  // Returning users must keep their original framing.
  assert.match(fn, /YOUR JOURNEYS/);
  assert.match(fn, /Your sessions over time/);
});

test('the entitlement balance and primary action remain on the dashboard', () => {
  const fn = extractFunction(SOURCE, 'JourneysPhase');
  assert.match(fn, /<SessionBalance credits=\{credits\}/, 'PR #49 balance UI must survive');
  assert.match(fn, /Start a new session/);
});

/* ── Negative controls: prove the harness can fail ──
   Each asserts that a corrupted input FAILS, so a silently-broken extractor or
   an always-true matcher cannot make this file green against nothing. */

test('negative control: extractor rejects a missing function', () => {
  assert.throws(() => extractFunction(SOURCE, '__NoSuchFunction__'), /function not found/);
});

test('negative control: extractor rejects a body-less fragment', () => {
  // The exact historical failure: anchoring on a destructuring brace.
  const fake = 'function SessionBalance({ credits, variant }) { }';
  assert.throws(() => extractFunction(fake, 'SessionBalance'), /suspiciously short|no statements/);
});

test('negative control: extractor returns a real, balanced body', () => {
  const fn = extractFunction(SOURCE, '_hasPersistedAuthToken');
  const opens = (fn.match(/\{/g) || []).length;
  const closes = (fn.match(/\}/g) || []).length;
  assert.strictEqual(opens, closes, 'braces must balance');
  assert.ok(fn.length > 200, 'real body should be substantial, got ' + fn.length);
  assert.match(fn, /localStorage/);
});

test('negative control: the predicate harness detects a wrong answer', () => {
  const p = loadPredicates({ storage: { 'sb-ref-auth-token': '{"access_token":"t"}' } });
  // If the predicate were stubbed/broken to always return false, the
  // "IS detected" test above would be meaningless. Assert the harness really
  // distinguishes the two inputs.
  const signedOut = loadPredicates({ storage: {} });
  assert.notStrictEqual(p._authMayBeSignedIn(), signedOut._authMayBeSignedIn());
});

test('negative control: source assertions fail against mutated source', () => {
  const mutated = SOURCE.replace(
    /if \(phaseRef\.current === 0 && isReal\) \{/,
    'if (phaseRef.current === 0 && isReal) { /*x*/'
  ).replace(/routedOnAuth = true;\n        setPhase\(8\);/, 'setPhase(8);');
  assert.ok(
    !/if \(phaseRef\.current === 0 && isReal\) \{[\s\S]{0,200}?routedOnAuth = true;[\s\S]{0,80}?setPhase\(8\);/.test(mutated),
    'a source without the latch-inside-branch must not match the pattern the real test requires'
  );
});
