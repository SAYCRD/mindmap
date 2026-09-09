'use strict';

/*
 * The final session report called a person "she/her" when they had never
 * stated a gender. Gender is not stored. The field-report prompt had a
 * one-line "Never use he, she, him, her" that the model ignored, and the
 * "doesn't fit" rewrite had no gender rule at all.
 *
 * These tests pin the stronger rule on both prompts. They read public/app.jsx
 * (the source of the prompt strings). A match against a comment would be a
 * false green — we extract the actual prompt literals.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..', 'public', 'app.jsx');
const html = fs.readFileSync(APP, 'utf8');

function sliceFrom(src, startNeedle, length) {
  const i = src.indexOf(startNeedle);
  if (i === -1) throw new Error('prompt start not found: ' + startNeedle);
  return src.slice(i, i + length);
}

function fieldReportPrompt(src) {
  return sliceFrom(src, 'You are writing a confidential field report', 3500);
}

function revisionPrompt(src) {
  return sliceFrom(src, 'The subject read their field report and gave feedback', 1800);
}

function mutate(source, pattern, replacement, label) {
  const out = source.replace(pattern, replacement);
  assert.notEqual(out, source, 'negative control "' + label + '" did not modify its input — the control is broken');
  return out;
}

function assertFieldReportDoesNotInferGender(src) {
  const prompt = fieldReportPrompt(src);
  if (prompt.indexOf('GENDER — CRITICAL') === -1) {
    throw new Error('field-report prompt lost GENDER — CRITICAL — the model will infer she/her again');
  }
  if (!/gender is unknown/i.test(prompt)) {
    throw new Error('field-report prompt no longer says gender is unknown');
  }
  if (!/Do not infer it/.test(prompt)) {
    throw new Error('field-report prompt no longer forbids inferring gender');
  }
  if (!/his, hers/.test(prompt)) {
    throw new Error('field-report prompt does not ban his/hers — possessives will slip through');
  }
  if (!/they/.test(prompt) || !/their/.test(prompt)) {
    throw new Error('field-report prompt does not offer they/their as the third-person voice');
  }
  if (!/previous report/.test(prompt)) {
    throw new Error('field-report prompt does not warn against copying she/her from a previous report');
  }
  return true;
}

function assertRevisionDoesNotInferGender(src) {
  const prompt = revisionPrompt(src);
  if (prompt.indexOf('GENDER — CRITICAL') === -1) {
    throw new Error('revision prompt lost GENDER — CRITICAL — a "doesn\'t fit" rewrite can reintroduce she/her');
  }
  if (!/gender is unknown/i.test(prompt)) {
    throw new Error('revision prompt no longer says gender is unknown');
  }
  if (!/his, hers/.test(prompt)) {
    throw new Error('revision prompt does not ban his/hers');
  }
  if (!/rewrite it out/.test(prompt)) {
    throw new Error('revision prompt does not tell the model to strip she/her from the original');
  }
  return true;
}

test('the field-report prompt does not let the model infer gender', () => {
  assertFieldReportDoesNotInferGender(html);
});

test('the report-revision prompt does not let the model infer gender', () => {
  assertRevisionDoesNotInferGender(html);
});

test('control: dropping GENDER from the field report fails the gender test', () => {
  const poisoned = mutate(
    html,
    /GENDER — CRITICAL: The subject's gender is unknown unless they stated it in their own quoted words in THIS session's data[\s\S]*?do not copy it\.\\n\\n/,
    '',
    'field-report gender block'
  );
  assert.throws(
    () => assertFieldReportDoesNotInferGender(poisoned),
    /GENDER — CRITICAL|gender is unknown|Do not infer/
  );
});

test('control: dropping GENDER from the revision prompt fails the gender test', () => {
  const poisoned = mutate(
    html,
    /GENDER — CRITICAL: The subject's gender is unknown unless they stated it in their own quoted words\. Do not infer[\s\S]*?rewrite it out\.\\n\\n/,
    '',
    'revision gender block'
  );
  assert.throws(
    () => assertRevisionDoesNotInferGender(poisoned),
    /GENDER — CRITICAL|gender is unknown|rewrite it out/
  );
});

test('control: the old one-line ban without GENDER CRITICAL fails the field-report test', () => {
  const poisoned = mutate(
    html,
    /GENDER — CRITICAL: The subject's gender is unknown unless they stated it in their own quoted words in THIS session's data[\s\S]*?do not copy it\.\\n\\n/,
    'Never use he, she, him, her.\\n\\n',
    'field-report gender block replaced with the old one-liner'
  );
  assert.throws(
    () => assertFieldReportDoesNotInferGender(poisoned),
    /GENDER — CRITICAL|gender is unknown|Do not infer/
  );
});
