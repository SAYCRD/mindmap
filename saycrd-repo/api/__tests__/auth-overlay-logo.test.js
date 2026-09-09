'use strict';

/*
 * The login / create-account overlay (opened from "Log in or create an
 * account to save your sessions") was painting the circular mark and the
 * last letter of BLINDSPOT as cut off.
 *
 * Two stacked causes, both in the overlay CSS:
 *
 *   1. The 44px close control sits in the top-right of .auth-card. The
 *      letter-spaced wordmark was centered with no side padding, so on a
 *      380px card the last T ran into the X.
 *   2. letter-spacing adds space AFTER the last glyph. text-indent only
 *      padded the left, so overflow-y:auto on the mobile sheet (which
 *      computes overflow-x to auto as well) clipped the T and the ring
 *      of the mark, whose PNG goes to the image edge.
 *
 * Structural claims are validator functions that THROW, so the negative
 * controls at the bottom can prove each one actually fails when the
 * thing it protects is removed.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const INDEX = path.join(__dirname, '..', '..', 'public', 'index.html');
const html = fs.readFileSync(INDEX, 'utf8');

function rule(src, selector) {
  const start = src.indexOf(selector + '{');
  assert.ok(start >= 0, 'missing CSS rule ' + selector);
  const end = src.indexOf('}', start);
  assert.ok(end > start, 'unclosed CSS rule ' + selector);
  const body = src.slice(start, end + 1);
  assert.ok(body.length > selector.length + 3, 'empty CSS rule ' + selector);
  return body;
}

function mobileBlock(src) {
  const start = src.indexOf('@media (max-width: 480px)');
  assert.ok(start >= 0, 'the mobile auth overlay breakpoint is gone');
  const brace = src.indexOf('{', start);
  let depth = 0;
  for (let i = brace; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') {
      depth--;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  assert.fail('unclosed @media (max-width: 480px) block');
}

function assertLogoMarkup(src) {
  assert.match(src, /class="auth-logo-row"/, 'the overlay lost the logo row');
  assert.match(
    src,
    /<img[^>]*class="auth-logo-mark"[^>]*>/,
    'the overlay lost the circular mark'
  );
  assert.match(
    src,
    /class="auth-logo">BLINDSPOT</,
    'the overlay lost the BLINDSPOT wordmark'
  );
}

function assertLogoRowClearsCloseButton(src) {
  const row = rule(src, '.auth-logo-row');
  const pad = row.match(/padding:0 ([0-9.]+)rem/);
  assert.ok(pad, 'the logo row has no horizontal padding to clear the close control');
  assert.ok(
    Number(pad[1]) >= 1.5,
    'logo-row side padding is ' + pad[1] + 'rem; needs ≥1.5rem to clear the 44px close control'
  );
  assert.match(row, /overflow:\s*visible/, 'the logo row clips overflow');
  assert.match(row, /flex-wrap:\s*nowrap/, 'the logo row is allowed to wrap the mark onto its own line');
}

function assertMarkNotClipped(src) {
  const mark = rule(src, '.auth-logo-mark');
  assert.match(mark, /object-fit:\s*contain/, 'the mark can be cropped by the img box');
  assert.match(mark, /flex-shrink:\s*0/, 'the mark is allowed to shrink');
  assert.match(mark, /padding:\s*[0-9.]+rem/, 'the mark has no inset, so a ring that goes to the PNG edge clips');
}

function assertWordmarkLastLetterFits(src) {
  const word = rule(src, '.auth-logo');
  assert.match(word, /flex-shrink:\s*0/, 'the wordmark is allowed to shrink and clip the last T');
  assert.match(word, /padding-right:\s*[0-9.]+em/, 'trailing letter-spacing is not kept inside the box');
  assert.match(word, /white-space:\s*nowrap/, 'the wordmark can wrap mid-letter');
  assert.match(word, /overflow:\s*visible/, 'the wordmark clips its last glyph');
  assert.doesNotMatch(
    word,
    /text-indent/,
    'text-indent is back — it ate width on the left and did not protect the last T'
  );
}

function assertMobileWordmarkShrinks(src) {
  const mobile = mobileBlock(src);
  assert.match(
    mobile,
    /\.auth-logo\{[^}]*font-size:\s*1\.[0-4][0-9]*rem/,
    'on a 320px sheet the wordmark is still the desktop size and will hit the close control'
  );
}

function assertOverlayDoesNotClipTop(src) {
  const overlay = rule(src, '.auth-overlay');
  assert.match(
    overlay,
    /align-items:\s*safe center/,
    'overlay still uses align-items:center, which clips the logo when the card is taller than the viewport'
  );
  assert.match(
    overlay,
    /overflow-y:\s*auto/,
    'overlay cannot scroll to the logo when the card overflows'
  );
}

function assertMobileSheetDoesNotClipTop(src) {
  const mobile = mobileBlock(src);
  const start = mobile.indexOf('.auth-card{');
  assert.ok(start >= 0, 'mobile block lost .auth-card');
  const card = mobile.slice(start, mobile.indexOf('}', start) + 1);
  assert.match(
    card,
    /justify-content:\s*safe center/,
    'mobile sheet still uses justify-content:center, which clips the logo off the top of a short phone'
  );
  assert.doesNotMatch(
    card,
    /justify-content:\s*center/,
    'mobile sheet has a bare justify-content:center (safe center is required)'
  );
}

test('the overlay still has the mark and the wordmark', () => {
  assertLogoMarkup(html);
});

test('the logo row keeps clear of the 44px close control', () => {
  assertLogoRowClearsCloseButton(html);
});

test('the circular mark is inset and not cropped', () => {
  assertMarkNotClipped(html);
});

test('the wordmark keeps its last letter inside the box', () => {
  assertWordmarkLastLetterFits(html);
});

test('the mobile sheet uses a tighter wordmark so the row still fits', () => {
  assertMobileWordmarkShrinks(html);
});

test('a tall card does not clip the logo off the top of the overlay', () => {
  assertOverlayDoesNotClipTop(html);
});

test('a short phone sheet does not clip the logo off the top', () => {
  assertMobileSheetDoesNotClipTop(html);
});

function mutate(source, pattern, replacement, label) {
  const out = source.replace(pattern, replacement);
  assert.notStrictEqual(out, source, 'negative control "' + label + '" did not modify its input — the control is broken');
  return out;
}

test('control: dropping row padding fails the close-button clearance test', () => {
  const poisoned = mutate(html, /\.auth-logo-row\{[^}]+\}/, '.auth-logo-row{display:flex}', 'row padding');
  assert.throws(() => assertLogoRowClearsCloseButton(poisoned));
});

test('control: a cropped mark fails the inset test', () => {
  const poisoned = mutate(html, /\.auth-logo-mark\{[^}]+\}/, '.auth-logo-mark{width:1.6rem;height:1.6rem}', 'mark inset');
  assert.throws(() => assertMarkNotClipped(poisoned));
});

test('control: restoring text-indent without padding-right fails the last-letter test', () => {
  const poisoned = mutate(
    html,
    /\.auth-logo\{[^}]+\}/,
    '.auth-logo{font-size:1.9rem;letter-spacing:.25em;text-indent:.25em}',
    'text-indent'
  );
  assert.throws(() => assertWordmarkLastLetterFits(poisoned));
});

test('control: a desktop-sized mobile wordmark fails the fit test', () => {
  const poisoned = mutate(
    html,
    /@media \(max-width: 480px\)\{[\s\S]*?\n    \}/,
    '@media (max-width: 480px){\n      .auth-overlay{padding:0}\n    }',
    'mobile wordmark'
  );
  assert.throws(() => assertMobileWordmarkShrinks(poisoned));
});

test('control: restoring align-items:center fails the overlay clip test', () => {
  const poisoned = mutate(
    html,
    /align-items:\s*safe center/,
    'align-items:center',
    'overlay align-items'
  );
  assert.throws(() => assertOverlayDoesNotClipTop(poisoned));
});

test('control: restoring justify-content:center fails the mobile clip test', () => {
  const poisoned = mutate(
    html,
    /justify-content:\s*safe center/,
    'justify-content:center',
    'mobile justify-content'
  );
  assert.throws(() => assertMobileSheetDoesNotClipTop(poisoned));
});
