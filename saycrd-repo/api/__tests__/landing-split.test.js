'use strict';

/*
 * Stage 1: the public homepage is its own bundle.
 *
 * index.html now makes ONE decision before requesting any application code:
 * a visitor with no persisted session gets landing.compiled.js (React, ReactDOM,
 * landing.jsx, landing-shell.jsx) and nothing else, while a returning visitor
 * gets the application in exactly the order it loaded before the split and never
 * requests the landing bundle at all.
 *
 * That split introduces three ways to break the homepage that the single bundle
 * made impossible, and this file exists to close all three:
 *
 *   1. CLOSURE. landing.compiled.js no longer contains app.jsx. Any helper the
 *      landing code reaches for that only app.jsx defines is now a ReferenceError
 *      on the public homepage — for signed-out visitors only, which is precisely
 *      the audience least likely to be watching a console.
 *
 *   2. DRIFT. Chrome rendered by both bundles has to have ONE definition. It was
 *      briefly duplicated instead, and the copy silently lost the global
 *      @keyframes, so every animation on the landing page resolved to nothing.
 *
 *   3. DISAGREEMENT. The boot decision in index.html and the app's own boot gate
 *      judge "is this a returning visitor?" separately. If they ever answer
 *      differently, the visitor is shown a page the other half of the system is
 *      about to replace — the flash this split was built to remove.
 *
 * Structural claims are validator functions that THROW, so the negative controls
 * at the bottom can prove each one actually fails when the thing it protects is
 * removed. A test that cannot be made to fail is not evidence. In this repo a
 * faulty control has already been mistaken for a passing test, and an extractor
 * that quietly matched nothing has reported a whole family of tests as green, so
 * the analyzer below is self-tested and the controls mutate by PATTERN — they
 * must keep working against both the committed sources and the post-build state.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const acorn = require('acorn');

const REPO = path.join(__dirname, '..', '..');
const PUBLIC_DIR = path.join(REPO, 'public');
const P = {
  index: path.join(PUBLIC_DIR, 'index.html'),
  landing: path.join(PUBLIC_DIR, 'landing.jsx'),
  shell: path.join(PUBLIC_DIR, 'landing-shell.jsx'),
  app: path.join(PUBLIC_DIR, 'app.jsx'),
  landingBundle: path.join(PUBLIC_DIR, 'landing.compiled.js'),
  appBundle: path.join(PUBLIC_DIR, 'app.compiled.js'),
  compile: path.join(REPO, 'build', 'compile.js'),
  react: path.join(PUBLIC_DIR, 'vendor', 'react.production.min.js'),
  reactDom: path.join(PUBLIC_DIR, 'vendor', 'react-dom.production.min.js'),
};

const read = (p) => fs.readFileSync(p, 'utf8');
const src = {
  index: read(P.index),
  landing: read(P.landing),
  shell: read(P.shell),
  app: read(P.app),
};

/* ───────────────────────── helpers ───────────────────────── */

// Several claims below are about what the CODE does. A comment that merely
// discusses a construct must never be able to satisfy them: an assertion in this
// repo has already passed by matching its own explanatory comment, and had that
// comment sat inside the block it was guarding it would have passed for the wrong
// reason indefinitely. Strings are preserved, since real assertions here are
// about string literals (class names, keyframe names, gradient values).
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
      i += 2; continue;
    }
    out += c; i++;
  }
  return out;
}

/*
 * Free-variable analysis over a real AST rather than a regex sweep.
 *
 * Deliberately conservative: a name is "free" only if it is referenced and
 * declared NOWHERE in the file (any scope). That under-reports shadowing bugs but
 * cannot raise a false alarm, and the failure this guards — a helper that lives
 * only in app.jsx and is therefore absent from the landing bundle entirely — is
 * exactly the case it detects.
 */
function freeVariables(code, filename) {
  const ast = acorn.parse(code, {
    ecmaVersion: 'latest',
    sourceType: 'script',
    allowReturnOutsideFunction: true,
    locations: true,
  });

  const declared = new Set();
  const referenced = new Map(); // name -> first line

  function declarePattern(node) {
    if (!node) return;
    switch (node.type) {
      case 'Identifier': declared.add(node.name); break;
      case 'ObjectPattern': node.properties.forEach((p) => declarePattern(p.value || p.argument)); break;
      case 'ArrayPattern': node.elements.forEach(declarePattern); break;
      case 'AssignmentPattern': declarePattern(node.left); break;
      case 'RestElement': declarePattern(node.argument); break;
      default: break;
    }
  }

  // Hand-rolled walk: acorn-walk is not a guaranteed dependency here, and the
  // node set this AST actually contains is small enough to traverse generically.
  function walk(node, parent) {
    if (!node || typeof node.type !== 'string') return;

    if (node.type === 'VariableDeclarator') declarePattern(node.id);
    if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
      if (node.id) declared.add(node.id.name);
      node.params.forEach(declarePattern);
    }
    if (node.type === 'ClassDeclaration' && node.id) declared.add(node.id.name);
    if (node.type === 'CatchClause') declarePattern(node.param);

    if (node.type === 'Identifier') {
      // Not a reference: property names, non-computed member access, labels, keys.
      const isProp = parent && parent.type === 'MemberExpression' && parent.property === node && !parent.computed;
      const isKey = parent && parent.type === 'Property' && parent.key === node && !parent.computed;
      const isLabel = parent && (parent.type === 'LabeledStatement' || parent.type === 'BreakStatement' || parent.type === 'ContinueStatement');
      if (!isProp && !isKey && !isLabel && !referenced.has(node.name)) {
        referenced.set(node.name, node.loc.start.line);
      }
    }

    for (const key of Object.keys(node)) {
      if (key === 'loc' || key === 'start' || key === 'end' || key === 'type') continue;
      const v = node[key];
      if (Array.isArray(v)) v.forEach((c) => walk(c, node));
      else if (v && typeof v === 'object' && typeof v.type === 'string') walk(v, node);
    }
  }
  walk(ast, null);

  // Guard against the analyzer silently doing nothing — the failure mode that has
  // previously reported an entire family of tests as green with an empty result.
  if (declared.size === 0 || referenced.size === 0) {
    throw new Error(`analyzer found ${declared.size} declarations / ${referenced.size} references in ${filename} — it is not inspecting the file`);
  }

  const free = [];
  for (const [name, line] of referenced) {
    if (!declared.has(name)) free.push({ name, line });
  }
  return { free, declared, referenced };
}

// Everything the browser itself supplies to a classic script on this page, plus
// the two globals the vendored <script> tags define. A free variable outside this
// set is a helper the bundle expects someone else to have defined.
const PAGE_GLOBALS = new Set([
  'React', 'ReactDOM',
  'window', 'document', 'location', 'history', 'navigator', 'screen', 'console',
  'localStorage', 'sessionStorage', 'performance', 'crypto', 'globalThis', 'self',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask',
  'requestAnimationFrame', 'cancelAnimationFrame', 'requestIdleCallback',
  'fetch', 'Headers', 'Request', 'Response', 'AbortController', 'FormData',
  'Blob', 'File', 'FileReader', 'URL', 'URLSearchParams', 'Image', 'Audio',
  'Event', 'CustomEvent', 'MutationObserver', 'IntersectionObserver', 'ResizeObserver',
  'getComputedStyle', 'matchMedia', 'alert', 'confirm', 'prompt', 'atob', 'btoa',
  'Object', 'Array', 'String', 'Number', 'Boolean', 'Symbol', 'BigInt', 'Function',
  'Math', 'JSON', 'Date', 'RegExp', 'Error', 'TypeError', 'RangeError',
  'Promise', 'Map', 'Set', 'WeakMap', 'WeakSet', 'Proxy', 'Reflect', 'Intl',
  'parseInt', 'parseFloat', 'isNaN', 'isFinite', 'NaN', 'Infinity', 'undefined',
  'encodeURIComponent', 'decodeURIComponent', 'encodeURI', 'decodeURI',
  'ArrayBuffer', 'DataView', 'Uint8Array', 'Int32Array', 'Float32Array',
  'TextEncoder', 'TextDecoder', 'structuredClone', 'arguments', 'eval',
]);

function bundleExists(p) {
  return fs.existsSync(p);
}

/* ═══════════════════════════════════════════════════════════════════════════
   1. CLOSURE — the landing bundle can stand on its own
   ═══════════════════════════════════════════════════════════════════════ */

// The single most valuable claim in this file: nothing the landing bundle
// references is missing from it.
function assertLandingBundleIsClosed(code) {
  const { free } = freeVariables(code, 'landing.compiled.js');
  const missing = free.filter((f) => !PAGE_GLOBALS.has(f.name));
  if (missing.length) {
    const detail = missing.map((m) => `${m.name} (line ${m.line})`).join(', ');
    throw new Error(`landing bundle references ${missing.length} identifier(s) it does not define: ${detail}`);
  }
}

test('landing bundle defines every identifier it references', (t) => {
  if (!bundleExists(P.landingBundle)) return t.skip('landing.compiled.js not built');
  assertLandingBundleIsClosed(read(P.landingBundle));
});

test('the free-variable analyzer reports a genuinely undefined identifier', () => {
  // Proves the analyzer is not vacuously passing. Without this, a broken walk
  // would report the test above as green forever.
  const { free } = freeVariables('var a = 1; function f(){ return a + _saycrdNotDefined(b); }', 'synthetic');
  const names = free.map((f) => f.name);
  assert.ok(names.includes('_saycrdNotDefined'), 'analyzer missed an undefined function call');
  assert.ok(names.includes('b'), 'analyzer missed an undefined variable read');
  assert.ok(!names.includes('a'), 'analyzer wrongly reported a declared variable as free');
  assert.ok(!names.includes('f'), 'analyzer wrongly reported a declared function as free');
});

test('the analyzer does not mistake property names for free variables', () => {
  const { free } = freeVariables('var o = {}; o.somePropertyName; var q = { someKey: 1 };', 'synthetic');
  const names = free.map((f) => f.name);
  assert.ok(!names.includes('somePropertyName'), 'member property counted as a reference');
  assert.ok(!names.includes('someKey'), 'object key counted as a reference');
});

test('landing bundle executes with only browser globals and React present', (t) => {
  if (!bundleExists(P.landingBundle)) return t.skip('landing.compiled.js not built');
  const result = runBundleInSandbox(read(P.landingBundle));
  assert.strictEqual(result.error, null, `landing bundle threw on load: ${result.error && result.error.message}`);
  assert.ok(result.rendered, 'landing bundle loaded but never rendered into #root');
});

test('the sandbox harness fails when the bundle references something undefined', (t) => {
  if (!bundleExists(P.landingBundle)) return t.skip('landing.compiled.js not built');
  // Same negative-control logic as above, applied to the runtime harness: if the
  // sandbox cannot surface a ReferenceError, its "no error" verdict means nothing.
  const poisoned = read(P.landingBundle) + '\n_saycrdDefinitelyNotDefined();\n';
  const result = runBundleInSandbox(poisoned);
  assert.ok(result.error, 'sandbox reported success while running an undefined call');
  assert.match(String(result.error.message), /_saycrdDefinitelyNotDefined/);
});

// Executes a bundle over the real vendored React with a DOM stub broad enough for
// mount + first render. Anything the bundle needs and does not have surfaces as a
// ReferenceError rather than as a silently blank homepage in production.
function runBundleInSandbox(code) {
  const listeners = {};
  const makeEl = () => {
    const el = {
      style: {}, dataset: {}, children: [], attributes: {},
      classList: { add() {}, remove() {}, contains: () => false, toggle() {} },
      appendChild(c) { el.children.push(c); return c; },
      removeChild() {}, insertBefore() {}, remove() {},
      setAttribute(k, v) { el.attributes[k] = v; }, getAttribute(k) { return el.attributes[k]; },
      removeAttribute() {}, addEventListener() {}, removeEventListener() {},
      contains: () => false, focus() {}, blur() {}, click() {},
      getBoundingClientRect: () => ({ top: 0, left: 0, width: 393, height: 852, bottom: 852, right: 393 }),
      querySelector: () => null, querySelectorAll: () => [],
      innerHTML: '', textContent: '', scrollTop: 0, scrollHeight: 0, offsetHeight: 0,
      nodeType: 1, ownerDocument: null, parentNode: null, firstChild: null, tagName: 'DIV',
    };
    return el;
  };
  const root = makeEl();
  root.id = 'root';

  const documentStub = {
    getElementById: (id) => (id === 'root' ? root : makeEl()),
    createElement: () => makeEl(),
    createElementNS: () => makeEl(),
    createTextNode: (t) => ({ nodeType: 3, textContent: t }),
    createDocumentFragment: () => makeEl(),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
    head: makeEl(), body: makeEl(), documentElement: makeEl(),
    readyState: 'complete', visibilityState: 'visible', cookie: '',
    activeElement: null, defaultView: null,
  };

  const store = {};
  const storageStub = {
    getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
    clear: () => { Object.keys(store).forEach((k) => delete store[k]); },
    key: (i) => Object.keys(store)[i] || null,
  };
  Object.defineProperty(storageStub, 'length', { get: () => Object.keys(store).length });

  const windowStub = {
    document: documentStub, localStorage: storageStub, sessionStorage: storageStub,
    location: { href: 'http://localhost/', origin: 'http://localhost', pathname: '/', search: '', hash: '', hostname: 'localhost' },
    navigator: { userAgent: 'node-test', language: 'en-US', onLine: true },
    innerWidth: 393, innerHeight: 852, devicePixelRatio: 2,
    scrollTo() {}, scrollY: 0, pageYOffset: 0,
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener() {}, dispatchEvent() { return true; },
    requestAnimationFrame: (fn) => setTimeout(fn, 0), cancelAnimationFrame: (id) => clearTimeout(id),
    fetch: () => Promise.reject(new Error('network disabled in test')),
    setTimeout, clearTimeout, setInterval, clearInterval,
    __saycrdAssetUrl: (n) => n,
    __saycrdLoadScript: () => Promise.resolve(),
    __saycrdEnsureAuth: () => Promise.resolve(),
    __saycrdSb: () => Promise.resolve(null),
    __saycrdLoadApp: () => Promise.resolve(),
    __saycrdBootSignedIn: false,
  };
  windowStub.window = windowStub;
  windowStub.self = windowStub;
  documentStub.defaultView = windowStub;

  const sandbox = {
    // React's UMD wrapper resolves its global as `self` before `window`, so this
    // has to be a real top-level binding in the context, not just window.self.
    self: windowStub,
    window: windowStub, document: documentStub,
    localStorage: storageStub, sessionStorage: storageStub,
    location: windowStub.location, navigator: windowStub.navigator,
    console: { log() {}, warn() {}, error() {}, info() {}, debug() {} },
    setTimeout, clearTimeout, setInterval, clearInterval, queueMicrotask,
    requestAnimationFrame: windowStub.requestAnimationFrame,
    cancelAnimationFrame: windowStub.cancelAnimationFrame,
    matchMedia: windowStub.matchMedia, getComputedStyle: windowStub.getComputedStyle,
    fetch: windowStub.fetch, performance: { now: () => 0, getEntriesByType: () => [], getEntriesByName: () => [] },
    process: { env: { NODE_ENV: 'production' } },
    MessageChannel: class { constructor() { this.port1 = { onmessage: null }; this.port2 = { postMessage: () => {} }; } },
  };
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox);

  try {
    vm.runInContext(read(P.react), context, { filename: 'react.js' });
    vm.runInContext(read(P.reactDom), context, { filename: 'react-dom.js' });
  } catch (e) {
    return { error: new Error('vendored React failed to load in sandbox: ' + e.message), rendered: false };
  }
  // The vendored UMD builds attach to `window`; the bundle reads them as bare
  // globals, exactly as the browser resolves them from the same tags.
  sandbox.React = sandbox.React || windowStub.React;
  sandbox.ReactDOM = sandbox.ReactDOM || windowStub.ReactDOM;
  if (!sandbox.React || !sandbox.ReactDOM) {
    return { error: new Error('sandbox could not expose React/ReactDOM'), rendered: false };
  }

  let rendered = false;
  const realCreateRoot = sandbox.ReactDOM.createRoot;
  sandbox.ReactDOM = Object.assign({}, sandbox.ReactDOM, {
    createRoot(container) {
      const r = realCreateRoot ? realCreateRoot.call(null, container) : null;
      return {
        render(el) { rendered = true; if (r) { try { r.render(el); } catch (e) { /* async render errors are not load errors */ } } },
        unmount() { if (r) { try { r.unmount(); } catch (e) {} } },
      };
    },
  });
  windowStub.ReactDOM = sandbox.ReactDOM;

  try {
    vm.runInContext(code, context, { filename: 'bundle.js' });
    return { error: null, rendered };
  } catch (e) {
    return { error: e, rendered };
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   2. DRIFT — chrome rendered by both bundles has exactly one definition
   ═══════════════════════════════════════════════════════════════════════ */

// The bug this encodes actually happened: landing-shell.jsx inlined its own copy
// of the shell, the copy omitted the @keyframes, and every landing animation
// resolved to nothing while the page still looked broadly correct.
function assertShellIsNotDuplicated(shellSource) {
  const code = stripComments(shellSource);
  if (!/<SaycrdShell\b/.test(code)) {
    throw new Error('landing-shell.jsx does not render the shared <SaycrdShell> chrome');
  }
  if (/@keyframes/.test(code)) {
    throw new Error('landing-shell.jsx has re-inlined @keyframes — the shared chrome has been duplicated');
  }
  if (/className\s*=\s*"saycrd-app-shell"/.test(code)) {
    throw new Error('landing-shell.jsx has re-inlined the .saycrd-app-shell wrapper');
  }
}

test('landing-shell.jsx renders the shared chrome instead of copying it', () => {
  assertShellIsNotDuplicated(src.shell);
});

test('SaycrdShell lives in landing.jsx, the file compiled into both bundles', () => {
  const landing = stripComments(src.landing);
  assert.match(landing, /function SaycrdShell\b/, 'SaycrdShell must be defined in landing.jsx so both bundles share one definition');
  assert.match(landing, /@keyframes slideIn/, 'the global keyframes must travel with SaycrdShell');
  assert.match(landing, /SAYCRD_SHELL_BG\s*=/, 'the default shell background must be defined alongside it');

  // Not in app.jsx, or the two copies can drift again.
  const app = stripComments(src.app);
  assert.doesNotMatch(app, /function SaycrdShell\b/, 'app.jsx must not define its own SaycrdShell');
  assert.match(app, /<SaycrdShell\b/, 'app.jsx must render the shared SaycrdShell');
});

test('the global keyframes are defined exactly once across the sources', () => {
  const count = [src.landing, src.shell, src.app]
    .map((s) => (stripComments(s).match(/@keyframes slideIn\b/g) || []).length)
    .reduce((a, b) => a + b, 0);
  assert.strictEqual(count, 1, `expected one definition of the global keyframes, found ${count}`);
});

test('both bundles ship the shared chrome', (t) => {
  if (!bundleExists(P.landingBundle) || !bundleExists(P.appBundle)) return t.skip('bundles not built');
  for (const [name, p] of [['landing', P.landingBundle], ['app', P.appBundle]]) {
    const code = read(p);
    assert.match(code, /@keyframes slideIn/, `${name}.compiled.js is missing the global keyframes`);
    assert.match(code, /saycrd-app-shell/, `${name}.compiled.js is missing the shell wrapper`);
    assert.match(code, /fonts\.googleapis\.com/, `${name}.compiled.js is missing the webfont stylesheet`);
  }
});

// A copy of the gradient map has to exist in the landing bundle, so its values
// are pinned to app.jsx's: otherwise the same page renders a different colour
// depending on which bundle happened to draw it.
function extractGradient(source, key) {
  const code = stripComments(source);
  const re = new RegExp('(?:"' + key + '"|\\b' + key + ')\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")', 'g');
  const found = [];
  let m;
  while ((m = re.exec(code))) found.push(JSON.parse(m[1]));
  return found;
}

test('the landing gradients match app.jsx for every page the landing bundle draws', () => {
  const keys = ['landing', 'privacy', 'terms', 'disclaimer-info'];
  const shell = stripComments(src.shell);
  const block = shell.match(/LANDING_GRADIENTS\s*=\s*\{[\s\S]*?\}/);
  assert.ok(block, 'LANDING_GRADIENTS not found in landing-shell.jsx');

  let compared = 0;
  for (const key of keys) {
    const mine = extractGradient(block[0], key);
    const theirs = extractGradient(src.app, key);
    assert.strictEqual(mine.length, 1, `LANDING_GRADIENTS should define ${key} exactly once`);
    assert.ok(theirs.length >= 1, `app.jsx does not define a gradient for ${key} — the extractor found none`);
    assert.strictEqual(mine[0], theirs[0], `gradient for "${key}" differs: landing=${mine[0]} app=${theirs[0]}`);
    compared++;
  }
  // Guards the extractor: if the regex stops matching, this fails instead of
  // silently comparing nothing.
  assert.strictEqual(compared, keys.length);
});

/* ═══════════════════════════════════════════════════════════════════════════
   3. DISAGREEMENT — one definition of "returning visitor"
   ═══════════════════════════════════════════════════════════════════════ */

// Pulls a named function out of a source file by brace matching, so the test
// exercises the REAL implementation rather than a paraphrase of it. A fixed line
// slice has silently truncated an extracted function in this repo before.
function extractFunction(source, name) {
  const code = stripComments(source);
  const start = code.search(new RegExp('function\\s+' + name + '\\s*\\('));
  if (start === -1) throw new Error(`function ${name} not found`);
  let i = code.indexOf('{', start);
  if (i === -1) throw new Error(`function ${name} has no body`);
  let depth = 0;
  let closed = false;
  for (; i < code.length; i++) {
    if (code[i] === '{') depth++;
    else if (code[i] === '}') { depth--; if (depth === 0) { i++; closed = true; break; } }
  }
  // Tracking the balance explicitly, not inspecting the tail: an unterminated
  // function still ENDS in "}", so a trailing-brace check would accept a
  // truncated body and every claim built on it would be worthless.
  if (!closed) throw new Error(`extraction of ${name} did not terminate at a closing brace`);
  return code.slice(start, i);
}

// The <script> in index.html that owns the boot decision.
function bootScript() {
  const m = src.index.match(/\/\* ── Boot decision[\s\S]*?<\/script>/);
  if (!m) throw new Error('boot decision script not found in index.html');
  return m[0];
}

function compileProbe(text, entry) {
  const fn = new Function('localStorage', 'location', `${text}\nreturn ${entry};`);
  return (store, hash) => {
    const keys = Object.keys(store);
    const ls = {
      length: keys.length,
      key: (i) => keys[i] || null,
      getItem: (k) => (Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null),
    };
    return fn(ls, { hash: hash || '' })(store, hash);
  };
}

test('the boot decision and the app boot gate agree on every fixture', () => {
  const boot = bootScript();
  const bootProbe = compileProbe(
    extractFunction(boot, 'hasPersistedToken') + '\n' + extractFunction(boot, 'mayBeSignedIn'),
    'mayBeSignedIn'
  );
  const appProbe = compileProbe(
    extractFunction(src.app, '_hasPersistedAuthToken') + '\n' + extractFunction(src.app, '_authMayBeSignedIn'),
    '_authMayBeSignedIn'
  );

  const fixtures = [
    { name: 'empty storage', store: {}, hash: '', expect: false },
    { name: 'real supabase token', store: { 'sb-abcdefgh-auth-token': '{"access_token":"x"}' }, hash: '', expect: true },
    { name: 'empty token value', store: { 'sb-abcdefgh-auth-token': '' }, hash: '', expect: false },
    { name: 'PKCE code-verifier only', store: { 'sb-abcdefgh-auth-token-code-verifier': 'abc' }, hash: '', expect: false },
    { name: 'unrelated key', store: { 'saycrd-local-sessions': '[]' }, hash: '', expect: false },
    { name: 'non-sb auth token', store: { 'other-auth-token': 'x' }, hash: '', expect: false },
    { name: 'magic-link fragment, empty storage', store: {}, hash: '#access_token=abc&type=magiclink', expect: true },
    { name: 'recovery fragment, empty storage', store: {}, hash: '#access_token=abc&type=recovery', expect: true },
    { name: 'unrelated fragment', store: {}, hash: '#privacy', expect: false },
    { name: 'verifier plus real token', store: { 'sb-x-auth-token-code-verifier': 'v', 'sb-x-auth-token': '{"a":1}' }, hash: '', expect: true },
  ];

  for (const f of fixtures) {
    const b = bootProbe(f.store, f.hash);
    const a = appProbe(f.store, f.hash);
    assert.strictEqual(b, f.expect, `boot decision wrong for "${f.name}": got ${b}, expected ${f.expect}`);
    assert.strictEqual(a, f.expect, `app boot gate wrong for "${f.name}": got ${a}, expected ${f.expect}`);
  }
  assert.strictEqual(fixtures.length, 10, 'fixture table shrank — the agreement is no longer covered');
});

test('the extractor returns whole functions, not truncated ones', () => {
  // Every extraction above is worthless if this silently returns a prefix.
  for (const [source, name] of [[src.app, '_hasPersistedAuthToken'], [src.app, '_authMayBeSignedIn'], [bootScript(), 'hasPersistedToken'], [bootScript(), 'mayBeSignedIn']]) {
    const text = extractFunction(source, name);
    const opens = (text.match(/\{/g) || []).length;
    const closes = (text.match(/\}/g) || []).length;
    assert.strictEqual(opens, closes, `${name} extracted with unbalanced braces (${opens}/${closes})`);
    assert.match(text, /return\b/, `${name} extracted without a return statement`);
  }
});

/* ═══════════════════════════════════════════════════════════════════════════
   4. The signed-out payload stays small
   ═══════════════════════════════════════════════════════════════════════ */

function assertNoAuthInLandingBundle(code) {
  if (/createClient\s*\(/.test(code)) {
    throw new Error('landing bundle constructs a Supabase client — the signed-out path must not need auth');
  }
  if (/supabase\.co(?!m)/.test(code)) {
    throw new Error('landing bundle references a Supabase endpoint');
  }
}

test('the landing bundle contains no Supabase client', (t) => {
  if (!bundleExists(P.landingBundle)) return t.skip('landing.compiled.js not built');
  assertNoAuthInLandingBundle(read(P.landingBundle));
});

// A static preload defeats the whole split: the browser would fetch the thing the
// boot decision just decided not to run.
function assertNoStaticAuthPreloads(html) {
  const head = html.slice(0, html.indexOf('</head>'));
  const preloads = [...head.matchAll(/<link\s+rel="preload"\s+href="([^"]+)"/g)].map((m) => m[1]);
  const forbidden = preloads.filter((h) => /supabase|env-config|session-sync|auth-layer|app\.compiled/.test(h));
  if (forbidden.length) {
    throw new Error(`index.html statically preloads application/auth assets: ${forbidden.join(', ')}`);
  }
  if (!preloads.some((h) => /react\.production/.test(h))) {
    throw new Error('index.html no longer preloads React — the extractor found no preloads to check');
  }
  return preloads;
}

test('index.html statically preloads only React and ReactDOM', () => {
  const preloads = assertNoStaticAuthPreloads(src.index);
  assert.strictEqual(preloads.length, 2, `expected 2 static preloads, found ${preloads.length}: ${preloads.join(', ')}`);
});

test('no blocking script tag loads Supabase or the app bundle', () => {
  // Scans the whole document: the React tags sit near the end of <body>, so a
  // head-only scan would find nothing and pass without checking anything.
  const srcs = [...src.index.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(srcs.length >= 2, `expected the React script tags to be present, found ${srcs.length}`);
  assert.ok(srcs.some((s) => /react\.production/.test(s)), 'React is no longer loaded by a script tag');
  for (const s of srcs) {
    assert.doesNotMatch(s, /supabase|env-config|session-sync|auth-layer|app\.compiled|landing\.compiled/,
      `${s} must be loaded by the boot decision, not by a blocking tag`);
  }
});

test('env-config.js is never content-hashed', () => {
  // It is per-deployment and served no-store: a cached copy could point a Preview
  // visitor at the production Supabase project.
  // Bounded by the END marker rather than by a lazy brace match, which would stop
  // at the first nested "}" and parse only the first entry.
  const map = src.index.match(/SAYCRD_ASSET_MAP_BEGIN\s*\*\/\s*window\.__SAYCRD_ASSETS\s*=\s*([\s\S]*?);\s*\/\*\s*SAYCRD_ASSET_MAP_END/);
  assert.ok(map, 'asset map not found in index.html');
  const assets = JSON.parse(map[1]);
  assert.ok(Object.keys(assets).length >= 4, 'asset map is suspiciously small');
  assert.ok(!('env-config.js' in assets), 'env-config.js must not be hashed or cached');
  assert.match(bootScript(), /"env-config\.js"/, 'the auth chain must still load env-config.js by its unhashed name');
});

// The app bundle is warmed on the signed-out path so the first click is not a
// cold 598KB download. That warm must never compete with the homepage's own
// paint — measured at 393px it began at 674ms against a 700ms FCP, because
// requestIdleCallback fires in the idle gap BEFORE React has rendered.
function assertWarmWaitsForPaint(html) {
  const at = html.indexOf('var warm = function');
  if (at === -1) throw new Error('the app-bundle warm is gone from index.html');
  const block = html.slice(at, at + 1400);
  if (!/requestAnimationFrame\(function \(\) \{ requestAnimationFrame\(/.test(block)) {
    throw new Error('the warm is not deferred past the first paint with nested rAFs');
  }
  const rafAt = block.indexOf('requestAnimationFrame');
  const idleAt = block.indexOf('requestIdleCallback');
  if (idleAt === -1) throw new Error('the warm no longer waits for idle');
  // The idle wait must be INSIDE the post-paint callback, not racing it.
  if (!/afterPaint = function \(\) \{\s*if \(window\.requestIdleCallback\)/.test(block)) {
    throw new Error('the idle wait is not nested inside the post-paint callback');
  }
  return { rafAt, idleAt };
}

test('the app-bundle warm waits for the homepage to paint', () => {
  assertWarmWaitsForPaint(stripComments(src.index));
});

test('the warm is a low-priority prefetch, not a preload', () => {
  const code = stripComments(src.index);
  const at = code.indexOf('var warm = function');
  assert.ok(at > 0, 'the warm is gone');
  const block = code.slice(at, at + 400);
  assert.match(block, /l\.rel = "prefetch"/,
    'the warm must stay rel=prefetch: preload would compete with the visible page');
  assert.doesNotMatch(block, /l\.rel = "preload"/);
});

test('control: warming without waiting for paint fails the ordering test', () => {
  const poisoned = mutate(
    stripComments(src.index),
    /if \(window\.requestAnimationFrame\) \{/,
    'if (false) {',
    'warm: removed the paint wait'
  );
  assert.throws(() => assertWarmWaitsForPaint(poisoned), /deferred past the first paint/);
});

/* ═══════════════════════════════════════════════════════════════════════════
   5. Handover — the app takes over without double-mounting
   ═══════════════════════════════════════════════════════════════════════ */

test('the landing hands over by loading the app bundle', () => {
  const shell = stripComments(src.shell);
  assert.match(shell, /__saycrdLoadApp\s*\(\s*\)/, 'the shell must load the app bundle to hand over');
  assert.match(shell, /__SAYCRD_START_REQUESTED\s*=\s*true/, 'starting a session must be recorded for the app');
  assert.match(shell, /window\.__saycrdUnmountLanding\s*=/, 'the shell must expose an unmount hook');
});

test('the app releases the landing root before creating its own', () => {
  const app = stripComments(src.app);
  assert.match(app, /__saycrdUnmountLanding/, 'app.jsx must unmount the landing root');
  assert.match(app, /__SAYCRD_START_REQUESTED/, 'app.jsx must consume the start request');

  // Order matters: React refuses the same container twice, so the unmount call
  // has to precede createRoot in the source.
  const unmountAt = app.indexOf('__saycrdUnmountLanding');
  const createAt = app.search(/ReactDOM\.createRoot/);
  assert.ok(createAt > -1, 'createRoot not found in app.jsx');
  assert.ok(unmountAt < createAt, 'app.jsx creates its root before releasing the landing root');
});

test('only the landing bundle mounts the landing root', (t) => {
  if (!bundleExists(P.appBundle) || !bundleExists(P.landingBundle)) return t.skip('bundles not built');
  assert.match(read(P.landingBundle), /LandingShell/, 'landing bundle must contain its entry point');
  assert.doesNotMatch(read(P.appBundle), /function LandingShell\b/,
    'app bundle must not contain the landing entry point, or both would mount');
});

/* ═══════════════════════════════════════════════════════════════════════════
   6. Rollback — the split can be turned off without a revert
   ═══════════════════════════════════════════════════════════════════════ */

// Runs the real build into a temp directory. Rollback DELETES a bundle, so it is
// only safe to exercise against an overridable output dir — verifying it against
// public/ would mean destroying the actual build to prove the escape hatch works.
function runCompile(outDir, env) {
  return execFileSync(process.execPath, [P.compile], {
    cwd: REPO,
    env: Object.assign({}, process.env, { SAYCRD_OUT_DIR: outDir }, env || {}),
    stdio: 'pipe',
    timeout: 120000,
  }).toString();
}

test('the default build emits both bundles', () => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'saycrd-split-'));
  runCompile(stage, {});
  assert.ok(fs.existsSync(path.join(stage, 'landing.compiled.js')), 'split build did not emit landing.compiled.js');
  assert.ok(fs.existsSync(path.join(stage, 'app.compiled.js')), 'split build did not emit app.compiled.js');
  fs.rmSync(stage, { recursive: true, force: true });
});

test('SAYCRD_SINGLE_BUNDLE=1 rolls back to one eager bundle', () => {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'saycrd-single-'));
  // Seed a landing bundle so the test proves rollback REMOVES it rather than
  // merely never writing it: a stale copy would let index.html keep splitting.
  fs.writeFileSync(path.join(stage, 'landing.compiled.js'), '/* stale */');
  runCompile(stage, { SAYCRD_SINGLE_BUNDLE: '1' });
  assert.ok(!fs.existsSync(path.join(stage, 'landing.compiled.js')),
    'rollback left a stale landing.compiled.js behind');
  const app = read(path.join(stage, 'app.compiled.js'));
  assert.match(app, /LandingPhase/, 'the rollback bundle must still contain the homepage');
  fs.rmSync(stage, { recursive: true, force: true });
});

test('SAYCRD_OUT_DIR never lets a build escape into public/', () => {
  // The override exists for the two tests above; if it silently fell back to
  // public/ they would be writing over the real build and passing anyway.
  const compileSrc = stripComments(read(P.compile));
  assert.match(compileSrc, /SAYCRD_OUT_DIR/, 'the output override has been removed');
  assert.doesNotMatch(compileSrc, /writeFileSync\(\s*path\.join\(PUBLIC,\s*bundle\.out/,
    'compile.js still writes bundles straight into public/, ignoring the override');
});

/* ═══════════════════════════════════════════════════════════════════════════
   7. Regressions this change must not reintroduce
   ═══════════════════════════════════════════════════════════════════════ */

test('the login overlay keeps every exit added for the dismissable-overlay fix', () => {
  const html = src.index;
  assert.match(html, /class="auth-close"/, 'the overlay close button is gone');
  assert.match(html, /_closeAuthOverlay/, 'the overlay close handler is gone');
  assert.match(html, /class="auth-back"/, 'the "back to the page" exit is gone');
  assert.match(html, /width:44px;height:44px/, 'the close button lost its 44px touch target');
});

test('the landing bundle renders the homepage, not a placeholder', (t) => {
  if (!bundleExists(P.landingBundle)) return t.skip('landing.compiled.js not built');
  const code = read(P.landingBundle);
  // The real hero copy: proves the bundle carries the actual homepage rather than
  // a stub that happens to mount.
  assert.match(code, /BLINDSPOT/, 'landing bundle does not contain the wordmark');
  assert.ok(/LandingPhase/.test(code), 'landing bundle does not contain the homepage component');
});

/* ═══════════════════════════════════════════════════════════════════════════
   NEGATIVE CONTROLS

   Each mutates a real input by PATTERN and asserts the matching validator
   throws. Pattern-based so they keep working against both the committed sources
   and the post-build state — a control keyed to a literal string has already
   silently stopped mutating anything in this repo, and a control that no-ops is
   indistinguishable from a test that cannot fail.
   ═══════════════════════════════════════════════════════════════════════ */

// Applies a mutation and refuses to proceed unless it actually changed the input.
function mutate(source, pattern, replacement, label) {
  const out = source.replace(pattern, replacement);
  assert.notStrictEqual(out, source, `negative control "${label}" did not modify its input — the control is broken`);
  return out;
}

test('control: a landing bundle missing a helper fails the closure test', (t) => {
  if (!bundleExists(P.landingBundle)) return t.skip('landing.compiled.js not built');
  // Delete the definition of a helper the landing code calls, leaving the calls.
  const poisoned = mutate(
    read(P.landingBundle),
    /function\s+_isRealAccount\s*\(/,
    'function _isRealAccount_REMOVED(',
    'closure: removed _isRealAccount'
  );
  assert.throws(() => assertLandingBundleIsClosed(poisoned), /_isRealAccount/);
});

test('control: re-inlining the shell into landing-shell.jsx fails the drift test', () => {
  const poisoned = mutate(
    src.shell,
    /<SaycrdShell\b/,
    '<div className="saycrd-app-shell"><style>{`@keyframes slideIn{}`}</style><SaycrdShellDisabled',
    'drift: re-inlined shell chrome'
  );
  assert.throws(() => assertShellIsNotDuplicated(poisoned), /duplicated|re-inlined|shared/);
});

test('control: dropping <SaycrdShell> from landing-shell.jsx fails the drift test', () => {
  const poisoned = mutate(src.shell, /<SaycrdShell\b/g, '<SomeOtherWrapper', 'drift: no shared chrome');
  assert.throws(() => assertShellIsNotDuplicated(poisoned), /does not render the shared/);
});

test('control: a Supabase client in the landing bundle fails the payload test', (t) => {
  if (!bundleExists(P.landingBundle)) return t.skip('landing.compiled.js not built');
  const poisoned = read(P.landingBundle) + '\nvar sb = createClient("https://x.supabase.co", "k");\n';
  assert.throws(() => assertNoAuthInLandingBundle(poisoned), /Supabase/);
});

test('control: statically preloading the app bundle fails the preload test', () => {
  const poisoned = mutate(
    src.index,
    /(<link rel="preload" href="static\/react\.production[^"]*" as="script">)/,
    '$1\n<link rel="preload" href="static/app.compiled.js" as="script">',
    'preload: added app bundle'
  );
  assert.throws(() => assertNoStaticAuthPreloads(poisoned), /statically preloads/);
});

test('control: a boot probe that ignores the magic-link fragment disagrees with the app', () => {
  // Reverting exactly the bug found while writing these tests: judging a returning
  // visitor on localStorage alone shows the homepage to someone arriving on a
  // magic link. The fixture table must catch that.
  const boot = mutate(
    bootScript(),
    /if \(location\.hash && location\.hash\.indexOf\("access_token"\) !== -1\) return true;/,
    '/* fragment check removed */',
    'boot: dropped fragment check'
  );
  const probe = compileProbe(
    extractFunction(boot, 'hasPersistedToken') + '\n' + extractFunction(boot, 'mayBeSignedIn'),
    'mayBeSignedIn'
  );
  assert.strictEqual(probe({}, '#access_token=abc&type=magiclink'), false,
    'mutation did not take effect — the control is broken');
});

test('control: the brace-matching extractor rejects an unterminated function', () => {
  assert.throws(
    () => extractFunction('function halfWritten() { if (a) { return 1; }', 'halfWritten'),
    /did not terminate/
  );
});

test('control: stripComments prevents a comment from satisfying a structural claim', () => {
  const commentOnly = 'var x = 1; /* this file renders <SaycrdShell> and defines @keyframes slideIn */';
  assert.throws(() => assertShellIsNotDuplicated(commentOnly), /does not render the shared/);
});
