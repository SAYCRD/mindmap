'use strict';

/*
 * The first-session disclaimer must run on every start path — homepage,
 * Dashboard, and post-session — and must not run on later starts or on
 * MapPhase's mid-session back to pour.
 *
 * After login always landed on the Dashboard, mobile first sessions started
 * there via setPhase(1) and skipped the gate. Desktop homepage begin still
 * hit it, which is why it looked desktop-only.
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('path');

const APP = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'app.jsx'), 'utf8');

function extractFunction(src, name) {
  const decl = new RegExp('function\\s+' + name + '\\s*\\(', 'g');
  const m = decl.exec(src);
  if (!m) throw new Error('function not found: ' + name);
  let i = m.index + m[0].length;
  let parenDepth = 1;
  while (i < src.length && parenDepth > 0) {
    if (src[i] === '(') parenDepth++;
    else if (src[i] === ')') parenDepth--;
    i++;
  }
  while (i < src.length && src[i] !== '{') i++;
  if (src[i] !== '{') throw new Error('no body: ' + name);
  const start = i;
  let depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  throw new Error('unbalanced: ' + name);
}

test('homepage, Dashboard, and post-session starts all go through the disclaimer gate', () => {
  assert.match(APP, /LandingPhase onStart=\{function\(\)\{beginSessionOrGate\(function\(\)\{setPhase\(1\);\}\);\}/,
    'homepage start must still gate');
  assert.match(APP, /CompletionPhase onStart=\{function\(\)\{beginSessionOrGate\(function\(\)\{setPhase\(1\);\}\);\}/,
    'post-session start skipped the gate');
  assert.match(APP, /JourneysPhase onStart=\{function\(\)\{beginSessionOrGate\(function\(\)\{setPhase\(1\);\}\);\}/,
    'Dashboard start skipped the gate — that is why mobile never saw it');
  assert.match(APP, /__SAYCRD_START_REQUESTED[\s\S]{0,400}beginSessionOrGate\(function\(\)\{\s*setPhase\(1\);/,
    'the landing-bundle handoff must still go through the gate');
});

test('MapPhase onBack to pour does not re-open the disclaimer', () => {
  const at = APP.indexOf('{cp==="map"&&<MapPhase');
  assert.ok(at > 0, 'MapPhase render is gone');
  const slice = APP.slice(at, at + 500);
  assert.match(slice, /onBack=\{function\(\)\{setPhase\(1\);\}/,
    'mid-session back to pour must stay a direct setPhase(1)');
  assert.doesNotMatch(slice, /beginSessionOrGate/,
    'backing out of map is not a first start');
});

test('the gate still only fires on a first session with no ack', () => {
  const fn = extractFunction(APP, 'beginSessionOrGate');
  assert.match(fn, /sessions\.length === 0 && !hasAcknowledgedDisclaimer\(\)/,
    'must still require zero saved sessions AND no ack');
  assert.doesNotMatch(fn, /innerWidth|_isMobileViewport/,
    'must not be viewport-gated — first session is first session on both');
});

test('control: Dashboard skipping the gate fails the start-path test', () => {
  const poisoned = APP.replace(
    'JourneysPhase onStart={function(){beginSessionOrGate(function(){setPhase(1);});}}',
    'JourneysPhase onStart={function(){setPhase(1);}}'
  );
  assert.ok(poisoned !== APP, 'the mutation must actually have landed');
  assert.doesNotMatch(
    poisoned,
    /JourneysPhase onStart=\{function\(\)\{beginSessionOrGate\(function\(\)\{setPhase\(1\);\}\);\}/,
    'poisoned Dashboard start must no longer go through the gate'
  );
});
