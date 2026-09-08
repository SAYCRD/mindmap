'use strict';

/*
 * After "start a session" then Back, the homepage could not scroll.
 *
 * Cause: the landing page nested an overflowY:auto scroller (height:100%)
 * inside another overflow:auto flex child inside a 100vh overflow:hidden
 * shell. iOS drops the inner scroller after a position:fixed overlay or a
 * focused input, and the shell then clips the rest of the page. The document
 * is now the only scroller on landing; internal phases keep the locked
 * viewport.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(REPO, rel), 'utf8');

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

function assertHomepageIsNotANestedScroller(src) {
  const landing = stripComments(src);
  if (/height:"100%", overflowY:"auto"/.test(landing)) {
    throw new Error('LandingPhase/LegalPage is a nested scroller again (height 100% + overflowY auto)');
  }
  if (!/minHeight:"100%", overflowX:"hidden"/.test(landing)) {
    throw new Error('the homepage root no longer fills the viewport without becoming a scroller');
  }
  return true;
}

function assertDocumentIsTheLandingScroller(html) {
  const code = stripComments(html);
  if (!/body\.saycrd-landing,body\.saycrd-landing #root\{height:auto;min-height:100%;overflow-x:hidden;overflow-y:auto\}/.test(code)) {
    throw new Error('body.saycrd-landing is not the document scroller');
  }
  if (!/body\.saycrd-landing \.saycrd-app-shell\{height:auto;min-height:100dvh;overflow:visible\}/.test(code)) {
    throw new Error('the landing shell still clips to 100vh');
  }
  if (!/body\.saycrd-internal \.saycrd-app-shell\{height:100vh;height:100dvh;overflow:hidden\}/.test(code)) {
    throw new Error('internal phases no longer lock the viewport');
  }
  return true;
}

test('the homepage is not a nested scroller', () => {
  assertHomepageIsNotANestedScroller(read('public/landing.jsx'));
});

test('the document is the landing scroller', () => {
  assertDocumentIsTheLandingScroller(read('public/index.html'));
});

test('the standalone shell does not clip the homepage', () => {
  const shell = stripComments(read('public/landing-shell.jsx'));
  assert.match(shell, /overflow:"visible"/,
    'landing-shell must not wrap the homepage in overflow:hidden');
  assert.doesNotMatch(shell, /overflow:"hidden"/,
    'a leftover overflow:hidden on the landing chrome would clip the page again');
});

test('the app landing chrome does not clip after returning from a session', () => {
  const app = stripComments(read('public/app.jsx'));
  assert.match(app, /const landingScroll = cp === "landing"/,
    'the app no longer distinguishes landing chrome from the locked session viewport');
  assert.match(app, /overflow: landingScroll \? "visible" : "hidden"/,
    'returning to the homepage would still be inside overflow:hidden');
  assert.match(app, /document\.body\.classList\.toggle\("saycrd-landing", landingScroll\)/,
    'legal pages must use the same document scroller as the homepage');
});

test('closing the auth overlay blurs the focused field', () => {
  const html = stripComments(read('public/index.html'));
  const at = html.indexOf('window._closeAuthOverlay = function');
  assert.ok(at !== -1, '_closeAuthOverlay is gone');
  const body = html.slice(at, at + 900);
  assert.match(body, /active\.blur/,
    'close must blur the focused input or iOS keeps the keyboard viewport and the page cannot scroll');
  assert.doesNotMatch(body, /scrollTop|scrollTo\(/,
    'close must not rewrite scroll position');
});

test('DisclaimerGate can return to the homepage without beginning', () => {
  const landing = stripComments(read('public/landing.jsx'));
  const app = stripComments(read('public/app.jsx'));
  assert.match(landing, /function DisclaimerGate\(\{ onBegin, onNavigateLegal, onClose \}\)/,
    'DisclaimerGate no longer accepts onClose');
  assert.match(landing, /onClick=\{onClose\}/,
    'the dismiss control is not wired');
  assert.match(landing, /Back to the page/,
    'the dismiss label drifted from the auth overlay');
  assert.match(app, /onClose=\{function\(\)\{ pendingAfterDisclaimer\.current = null; setShowDisclaimer\(false\); \}/,
    'dismissing the gate must not start the session');
});

test('control: putting the nested scroller back fails the homepage test', () => {
  const poisoned = mutate(
    read('public/landing.jsx'),
    /minHeight:"100%", overflowX:"hidden"/,
    'height:"100%", overflowY:"auto", overflowX:"hidden"',
    'scroll: restored nested overflowY auto'
  );
  assert.throws(() => assertHomepageIsNotANestedScroller(poisoned), /nested scroller/);
});

test('control: clipping the landing shell fails the document-scroller test', () => {
  const poisoned = mutate(
    read('public/index.html'),
    /body\.saycrd-landing \.saycrd-app-shell\{height:auto;min-height:100dvh;overflow:visible\}/,
    'body.saycrd-landing .saycrd-app-shell{height:100vh;overflow:hidden}',
    'scroll: clipped the landing shell again'
  );
  assert.throws(() => assertDocumentIsTheLandingScroller(poisoned), /clips to 100vh/);
});
