// api/__tests__/session-balance-ui.test.js — unit tests for the two pieces of
// public/app.jsx that tell a user how many sessions they own: the useCredits()
// hook and the SessionBalance component.
//
// Why this file looks unusual: app.jsx is a browser script, not a module. It
// has no exports, it is written in JSX, and it expects React plus a DOM to
// already exist as globals. session-sync.js could simply be require()d here;
// app.jsx cannot. Rather than restructure a 12k-line file to make two
// functions importable, this test lifts their REAL source out of app.jsx,
// runs it through the same Babel transform build/compile.js uses, and
// evaluates it against injected useState/useEffect/createElement stand-ins.
//
// That means these tests exercise the shipped source, not a copy of it: edit
// the component and this file sees the edit. The risk of source-lifting is an
// extractor that quietly matches nothing and turns every assertion green
// against an empty string, so extraction is guarded on both sides — the
// integrity tests below fail if a function goes missing, and also fail if the
// extractor stops being able to report failure.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import babel from "@babel/core";

const APP_JSX = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "app.jsx");
const SOURCE = fs.readFileSync(APP_JSX, "utf8");

// Pulls one top-level `function NAME(...) { ... }` out of app.jsx by matching
// delimiters, rather than by a regex over the body. Delimiter matching
// survives the nested functions, object literals and JSX inside these
// components, all of which defeat a naive non-greedy regex.
//
// The parameter list has to be skipped explicitly before the body is read.
// A destructuring parameter — `function SessionBalance({ credits, variant })`
// — opens and closes a brace before the body ever starts, so jumping to the
// first `{` after the function name captures the parameter list alone and
// yields a 44-character "function" whose body is silently dropped.
function extractFunction(source, name) {
  const start = source.indexOf("\nfunction " + name + "(");
  if (start === -1) throw new Error("extractFunction: '" + name + "' not found in app.jsx");

  // Walks `source` from `i`, skipping strings and comments, and returns the
  // index just past the delimiter pair that opens at `i`.
  function matchPair(from, openCh, closeCh) {
    let depth = 0;
    let inLine = false;
    let inBlock = false;
    let inStr = null;
    for (let i = from; i < source.length; i++) {
      const c = source[i];
      const next = source[i + 1];
      const prev = source[i - 1];
      if (inLine) { if (c === "\n") inLine = false; continue; }
      if (inBlock) { if (c === "*" && next === "/") { inBlock = false; i++; } continue; }
      if (inStr) { if (c === inStr && prev !== "\\") inStr = null; continue; }
      if (c === "/" && next === "/") { inLine = true; i++; continue; }
      if (c === "/" && next === "*") { inBlock = true; i++; continue; }
      if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
      if (c === openCh) depth++;
      else if (c === closeCh) {
        depth--;
        if (depth === 0) return i;
      }
    }
    return -1;
  }

  const paramOpen = source.indexOf("(", start);
  const paramClose = matchPair(paramOpen, "(", ")");
  if (paramClose === -1) throw new Error("extractFunction: unbalanced parameter list for '" + name + "'");
  const bodyOpen = source.indexOf("{", paramClose);
  if (bodyOpen === -1) throw new Error("extractFunction: no body for '" + name + "'");
  const bodyClose = matchPair(bodyOpen, "{", "}");
  if (bodyClose === -1) throw new Error("extractFunction: unbalanced braces while reading '" + name + "'");

  const extracted = source.slice(start + 1, bodyClose + 1);
  // Cheap shape check so a future refactor of app.jsx cannot hand back
  // something that merely looks like a function.
  if (!extracted.startsWith("function " + name) || !extracted.endsWith("}")) {
    throw new Error("extractFunction: '" + name + "' did not extract as a whole function");
  }
  return extracted;
}

const SRC_USE_CREDITS = extractFunction(SOURCE, "useCredits");
const SRC_SESSION_BALANCE = extractFunction(SOURCE, "SessionBalance");
// The real predicate, not a reimplementation — so the signed-out test is
// bound to the app's actual definition of "is this a real account".
const SRC_IS_REAL_ACCOUNT = extractFunction(SOURCE, "_isRealAccount");

const { code: COMPILED } = babel.transform(
  [SRC_IS_REAL_ACCOUNT, SRC_USE_CREDITS, SRC_SESSION_BALANCE].join("\n\n"),
  { presets: [["@babel/preset-react", { development: false }]], configFile: false, babelrc: false, filename: "app.jsx" }
);

// Builds the two functions against a controlled environment. Nothing here is
// React: createElement returns plain objects, so a render is inspectable
// without a DOM, and the hook stand-ins let a test step through mount,
// re-render and cleanup deliberately.
function loadModule(env) {
  const factory = new Function(
    "React", "useState", "useEffect", "window", "fetch", "FB", "FD",
    COMPILED + "\nreturn { useCredits: useCredits, SessionBalance: SessionBalance, _isRealAccount: _isRealAccount };"
  );
  return factory(env.React, env.useState, env.useEffect, env.window, env.fetch, "font-body", "font-display");
}

function makeWindow(overrides) {
  const listeners = new Map();
  return Object.assign(
    {
      currentUser: null,
      _saycrdToken: null,
      addEventListener(type, fn) {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type).add(fn);
      },
      removeEventListener(type, fn) {
        if (listeners.has(type)) listeners.get(type).delete(fn);
      },
      dispatchEvent(evt) {
        const set = listeners.get(evt.type);
        if (set) for (const fn of Array.from(set)) fn(evt);
      },
      _listenerCount(type) {
        return listeners.has(type) ? listeners.get(type).size : 0;
      },
    },
    overrides || {}
  );
}

// A deliberately small React: enough to run one hook-bearing function
// repeatedly with persistent state, and to record which effects ran.
function createHarness(win, fetchImpl) {
  const slots = [];
  const effects = [];
  let cursor = 0;
  let renders = 0;
  let hook = null;
  let latest;

  function useState(init) {
    const idx = cursor++;
    if (!(idx in slots)) slots[idx] = typeof init === "function" ? init() : init;
    return [
      slots[idx],
      (next) => {
        slots[idx] = typeof next === "function" ? next(slots[idx]) : next;
        render();
      },
    ];
  }

  function useEffect(fn, deps) {
    const idx = cursor++;
    assert.deepEqual(deps, [], "useCredits' effect must stay mount-only; a changed dep list needs this harness updated");
    if (!effects[idx]) effects[idx] = { ran: false, cleanup: null };
    if (!effects[idx].ran) {
      effects[idx].ran = true;
      effects[idx].cleanup = fn() || null;
    }
  }

  const env = {
    React: { createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat() }) },
    useState,
    useEffect,
    window: win,
    fetch: fetchImpl,
  };
  const mod = loadModule(env);

  function render() {
    cursor = 0;
    renders++;
    latest = hook();
    return latest;
  }

  return {
    mod,
    mount() {
      hook = mod.useCredits;
      return render();
    },
    get value() {
      return latest;
    },
    get renders() {
      return renders;
    },
    unmount() {
      for (const e of effects) if (e && e.cleanup) e.cleanup();
    },
  };
}

// Lets the hook's fetch().then().then() chain settle.
async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
}

function okFetch(payload, calls) {
  return async function (url, opts) {
    calls.push({ url, opts });
    return { ok: true, json: async () => payload };
  };
}

// Collapses a rendered tree to its visible text, so assertions read like what
// a user sees instead of poking at style objects.
function textOf(node) {
  if (node == null || node === false) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join(" ");
  return [textOf(node.props && node.props.children), ...(node.children || []).map(textOf)].join(" ");
}

function renderBalance(mod, credits, variant) {
  return mod.SessionBalance({ credits, variant });
}

/* ---------- extraction integrity (guards against a blind harness) ---------- */

test("extraction integrity: the real useCredits and SessionBalance source is lifted out of app.jsx", () => {
  assert.ok(SRC_USE_CREDITS.includes("/api/credits"), "useCredits source must contain its endpoint");
  assert.ok(SRC_USE_CREDITS.includes("saycrd-credits-changed"), "useCredits source must contain its refresh event");
  assert.ok(SRC_SESSION_BALANCE.includes("No sessions available"), "SessionBalance source must contain its empty headline");
  assert.ok(SRC_SESSION_BALANCE.includes("complimentary"), "SessionBalance source must contain the free-session wording");
  assert.ok(SRC_USE_CREDITS.length > 400 && SRC_SESSION_BALANCE.length > 400, "both functions should be substantial, not truncated");
  assert.ok(COMPILED.includes("createElement"), "JSX must have been transformed");
});

test("extraction integrity: the extractor fails loudly when a function is absent or unbalanced", () => {
  // Two-sided proof: an extractor that has never been seen to fail is not
  // evidence. If either of these stops throwing, every test above is at risk
  // of asserting against an empty string.
  assert.throws(() => extractFunction(SOURCE, "thisFunctionDoesNotExist"), /not found in app.jsx/);
  assert.throws(() => extractFunction("\nfunction broken() { if (x) {", "broken"), /unbalanced braces/);
});

test("extraction integrity: a destructuring parameter list does not truncate the body", () => {
  // Regression pin. The first version of this extractor jumped to the first
  // `{` after the function name, which for `SessionBalance({ credits })` is
  // the destructuring brace — so it returned a 44-character fragment with no
  // body at all, and every render assertion would have run against nothing.
  const sample = "\nfunction Sample({ a, b }) { const x = { nested: 1 }; return x.nested; }\n";
  const got = extractFunction(sample, "Sample");

  assert.match(got, /return x\.nested;/, "the body must be captured, not just the parameter list");
  assert.ok(got.endsWith("}"));
  assert.ok(got.length > 60, "a destructured signature alone would be far shorter than the whole function");
  // And the real component, which is what actually matters here.
  assert.match(SRC_SESSION_BALANCE, /variant === "menu"/, "SessionBalance's body must include its variant branch");
  assert.match(SRC_SESSION_BALANCE, /aria-live/, "SessionBalance's body must include its live-region markup");
});

/* ---------- useCredits ---------- */

test("useCredits: a signed-in user's purchased credit is fetched and reported", async () => {
  const calls = [];
  const win = makeWindow({ currentUser: { id: "user-1" }, _saycrdToken: "tok" });
  const h = createHarness(win, okFetch({ balance: 1, freeRemaining: 0 }, calls));

  h.mount();
  await flush();

  assert.equal(calls.length, 1, "exactly one /api/credits read on mount");
  assert.equal(calls[0].url, "/api/credits");
  assert.equal(calls[0].opts.headers.Authorization, "Bearer tok", "the session token is sent");
  assert.deepEqual(h.value, { balance: 1, freeRemaining: 0, total: 1, loaded: true });
});

test("useCredits: total sums complimentary and purchased, because a session is spent from free first", async () => {
  const win = makeWindow({ currentUser: { id: "user-1" }, _saycrdToken: "tok" });
  const h = createHarness(win, okFetch({ balance: 3, freeRemaining: 1 }, []));

  h.mount();
  await flush();

  // The server spends complimentary sessions before credits, so a user with
  // 1 free + 3 purchased genuinely has 4 sessions available. Reporting only
  // the credit balance here would understate what they can do.
  assert.equal(h.value.total, 4);
  assert.equal(h.value.freeRemaining, 1);
  assert.equal(h.value.balance, 3);
});

test("useCredits: stays unloaded before the response arrives, so nothing can render a premature zero", () => {
  const win = makeWindow({ currentUser: { id: "user-1" }, _saycrdToken: "tok" });
  const h = createHarness(win, () => new Promise(() => {})); // never settles

  const first = h.mount();

  assert.equal(first.loaded, false, "loading must be distinguishable from a real zero balance");
  assert.equal(first.balance, 0);
});

test("useCredits: a failed /api/credits read leaves the value unloaded rather than reporting zero", async () => {
  const win = makeWindow({ currentUser: { id: "user-1" }, _saycrdToken: "tok" });
  const h = createHarness(win, async () => ({ ok: false, status: 500, json: async () => ({}) }));

  h.mount();
  await flush();

  assert.equal(h.value.loaded, false, "a 500 must not be mistaken for an empty balance");
});

test("useCredits: a rejected fetch is caught and still leaves the value unloaded", async () => {
  const win = makeWindow({ currentUser: { id: "user-1" }, _saycrdToken: "tok" });
  const h = createHarness(win, async () => {
    throw new Error("network down");
  });

  h.mount();
  await flush();

  assert.equal(h.value.loaded, false, "a network error must not surface as zero sessions");
});

test("useCredits: a signed-out visitor is never fetched for and never reports a balance", async () => {
  const calls = [];
  const win = makeWindow({ currentUser: null, _saycrdToken: null });
  const h = createHarness(win, okFetch({ balance: 9, freeRemaining: 9 }, calls));

  h.mount();
  await flush();

  assert.equal(calls.length, 0, "no credits request for a signed-out visitor");
  assert.equal(h.value.loaded, false);
  assert.equal(h.value.total, 0);
});

test("useCredits: the local-user guest id is treated as signed out", async () => {
  const calls = [];
  const win = makeWindow({ currentUser: { id: "local-user" }, _saycrdToken: "tok" });
  const h = createHarness(win, okFetch({ balance: 5, freeRemaining: 0 }, calls));

  h.mount();
  await flush();

  assert.equal(calls.length, 0, "the guest sentinel id must not trigger a credits read");
  assert.equal(h.value.loaded, false);
});

test("useCredits: a signed-in user whose token has not arrived yet is not fetched for", async () => {
  const calls = [];
  const win = makeWindow({ currentUser: { id: "user-1" }, _saycrdToken: null });
  const h = createHarness(win, okFetch({ balance: 1, freeRemaining: 0 }, calls));

  h.mount();
  await flush();

  assert.equal(calls.length, 0, "without a token the request would 401; it must be skipped");
  assert.equal(h.value.loaded, false);
});

test("useCredits: re-reads the balance when saycrd-credits-changed fires", async () => {
  const calls = [];
  let payload = { balance: 1, freeRemaining: 0 };
  const win = makeWindow({ currentUser: { id: "user-1" }, _saycrdToken: "tok" });
  const h = createHarness(win, async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => payload };
  });

  h.mount();
  await flush();
  assert.equal(h.value.balance, 1);

  // Spending a session server-side is what makes the shown number stale.
  payload = { balance: 0, freeRemaining: 0 };
  win.dispatchEvent({ type: "saycrd-credits-changed" });
  await flush();

  assert.equal(calls.length, 2, "the event triggers a second read");
  assert.equal(h.value.balance, 0, "the displayed balance follows the server");
  assert.equal(h.value.loaded, true);
});

test("useCredits: re-reads on saycrd-auth-change, so signing in populates the balance", async () => {
  const calls = [];
  const win = makeWindow({ currentUser: null, _saycrdToken: null });
  const h = createHarness(win, okFetch({ balance: 2, freeRemaining: 0 }, calls));

  h.mount();
  await flush();
  assert.equal(calls.length, 0, "nothing fetched while signed out");

  win.currentUser = { id: "user-1" };
  win._saycrdToken = "tok";
  win.dispatchEvent({ type: "saycrd-auth-change" });
  await flush();

  assert.equal(calls.length, 1, "signing in triggers the first read");
  assert.equal(h.value.total, 2);
});

test("useCredits: unmounting removes both listeners and stops late responses from applying", async () => {
  let resolveFetch;
  const win = makeWindow({ currentUser: { id: "user-1" }, _saycrdToken: "tok" });
  const h = createHarness(win, () => new Promise((r) => { resolveFetch = r; }));

  h.mount();
  assert.equal(win._listenerCount("saycrd-credits-changed"), 1);
  assert.equal(win._listenerCount("saycrd-auth-change"), 1);

  h.unmount();
  assert.equal(win._listenerCount("saycrd-credits-changed"), 0, "listener must be released on unmount");
  assert.equal(win._listenerCount("saycrd-auth-change"), 0);

  const rendersBefore = h.renders;
  resolveFetch({ ok: true, json: async () => ({ balance: 7, freeRemaining: 0 }) });
  await flush();

  assert.equal(h.renders, rendersBefore, "a response arriving after unmount must not set state");
});

/* ---------- SessionBalance ---------- */

test("SessionBalance: renders the purchased-credit case a payer actually sees", () => {
  const { mod } = createHarness(makeWindow(), okFetch({}, []));
  const out = renderBalance(mod, { balance: 1, freeRemaining: 0, total: 1, loaded: true });

  const text = textOf(out);
  assert.match(text, /1 session available/);
  assert.match(text, /1 purchased/);
  assert.doesNotMatch(text, /complimentary/, "no free sessions left, so no free breakdown");
});

test("SessionBalance: renders nothing while the balance is still loading", () => {
  const { mod } = createHarness(makeWindow(), okFetch({}, []));

  assert.equal(renderBalance(mod, { balance: 0, freeRemaining: 0, total: 0, loaded: false }), null);
});

test("SessionBalance: renders nothing when the read failed — never a false 'No sessions available'", () => {
  const { mod } = createHarness(makeWindow(), okFetch({}, []));
  // This is the regression that matters most: a failed read must not be
  // presented to a paying user as though their credit were gone.
  const out = renderBalance(mod, { balance: 0, freeRemaining: 0, total: 0, loaded: false });

  assert.equal(out, null);
  assert.doesNotMatch(textOf(out), /No sessions available/);
});

test("SessionBalance: renders nothing for a signed-out visitor", () => {
  const { mod } = createHarness(makeWindow(), okFetch({}, []));

  assert.equal(renderBalance(mod, undefined), null, "no credits object at all");
  assert.equal(renderBalance(mod, null), null);
});

test("SessionBalance: says '1 session available' in the singular", () => {
  const { mod } = createHarness(makeWindow(), okFetch({}, []));
  const text = textOf(renderBalance(mod, { balance: 1, freeRemaining: 0, total: 1, loaded: true }));

  assert.match(text, /\b1 session available\b/);
  assert.doesNotMatch(text, /1 sessions available/, "must not read '1 sessions'");
});

test("SessionBalance: pluralises for more than one session", () => {
  const { mod } = createHarness(makeWindow(), okFetch({}, []));
  const text = textOf(renderBalance(mod, { balance: 2, freeRemaining: 2, total: 4, loaded: true }));

  assert.match(text, /4 sessions available/);
  assert.match(text, /2 complimentary/);
  assert.match(text, /2 purchased/);
});

test("SessionBalance: a confirmed zero reads 'No sessions available' with no misleading breakdown", () => {
  const { mod } = createHarness(makeWindow(), okFetch({}, []));
  const text = textOf(renderBalance(mod, { balance: 0, freeRemaining: 0, total: 0, loaded: true }));

  assert.match(text, /No sessions available/);
  assert.doesNotMatch(text, /purchased/);
  assert.doesNotMatch(text, /complimentary/);
});

test("SessionBalance: shows only the complimentary part when nothing has been purchased", () => {
  const { mod } = createHarness(makeWindow(), okFetch({}, []));
  const text = textOf(renderBalance(mod, { balance: 0, freeRemaining: 2, total: 2, loaded: true }));

  assert.match(text, /2 sessions available/);
  assert.match(text, /2 complimentary/);
  assert.doesNotMatch(text, /purchased/);
});

test("SessionBalance: the dashboard variant is announced to screen readers", () => {
  const { mod } = createHarness(makeWindow(), okFetch({}, []));
  const out = renderBalance(mod, { balance: 1, freeRemaining: 0, total: 1, loaded: true });

  assert.equal(out.props.role, "status");
  assert.equal(out.props["aria-live"], "polite");
});

test("SessionBalance: the menu variant shows the same numbers in a denser layout", () => {
  const { mod } = createHarness(makeWindow(), okFetch({}, []));
  const credits = { balance: 3, freeRemaining: 1, total: 4, loaded: true };

  const dashboard = textOf(renderBalance(mod, credits));
  const menu = textOf(renderBalance(mod, credits, "menu"));

  for (const fragment of ["4 sessions available", "1 complimentary", "3 purchased"]) {
    assert.match(dashboard, new RegExp(fragment));
    assert.match(menu, new RegExp(fragment), "variant must change density only, never the numbers");
  }
  assert.equal(renderBalance(mod, { loaded: false }, "menu"), null, "the menu variant honours the same guard");
});

/* ---------- hook and component together ---------- */

test("end to end: a purchase landing while the app is open turns an empty balance into a visible session", async () => {
  let payload = { balance: 0, freeRemaining: 0 };
  const win = makeWindow({ currentUser: { id: "user-1" }, _saycrdToken: "tok" });
  const h = createHarness(win, async () => ({ ok: true, json: async () => payload }));

  h.mount();
  await flush();
  assert.match(textOf(renderBalance(h.mod, h.value)), /No sessions available/);

  // The paywall dispatches this once /api/credits confirms the purchase.
  payload = { balance: 1, freeRemaining: 0 };
  win.dispatchEvent({ type: "saycrd-credits-changed" });
  await flush();

  const text = textOf(renderBalance(h.mod, h.value));
  assert.match(text, /1 session available/);
  assert.match(text, /1 purchased/);
});
