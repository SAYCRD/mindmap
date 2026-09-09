// Guest and account complimentary sessions used to be two counters. An
// account that had spent its 2 could log out and "Continue without an
// account" for 2 more. These tests pin the shared device ledger that closes
// that bypass, without changing the 2-session total, pricing, Square, or
// purchased credits.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "path";
import { fileURLToPath } from "node:url";

const PUBLIC = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "public");
const LANDING = fs.readFileSync(path.join(PUBLIC, "landing.jsx"), "utf8");
const APP = fs.readFileSync(path.join(PUBLIC, "app.jsx"), "utf8");
const INDEX = fs.readFileSync(path.join(PUBLIC, "index.html"), "utf8");

const KEY = "saycrd-complimentary-used";

function extractFunction(source, name) {
  const start = source.indexOf("\nfunction " + name + "(");
  if (start === -1) throw new Error("extractFunction: '" + name + "' not found");
  function matchPair(from, openCh, closeCh) {
    let depth = 0;
    let inLine = false;
    let inBlock = false;
    let inStr = null;
    for (let i = from; i < source.length; i++) {
      const c = source[i];
      const next = source[i + 1];
      const prev = source[i - 1];
      if (inLine) {
        if (c === "\n") inLine = false;
        continue;
      }
      if (inBlock) {
        if (c === "*" && next === "/") {
          inBlock = false;
          i++;
        }
        continue;
      }
      if (inStr) {
        if (c === inStr && prev !== "\\") inStr = null;
        continue;
      }
      if (c === "/" && next === "/") {
        inLine = true;
        i++;
        continue;
      }
      if (c === "/" && next === "*") {
        inBlock = true;
        i++;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        inStr = c;
        continue;
      }
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
  const bodyOpen = source.indexOf("{", paramClose);
  const bodyClose = matchPair(bodyOpen, "{", "}");
  if (bodyClose === -1) throw new Error("extractFunction: unbalanced braces for '" + name + "'");
  return source.slice(start + 1, bodyClose + 1);
}

function fakeStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    getItem(k) {
      return map.has(k) ? map.get(k) : null;
    },
    setItem(k, v) {
      map.set(k, String(v));
    },
    _get(k) {
      return map.get(k);
    },
  };
}

function loadHelpers(storage, currentUser) {
  const names = [
    "_isRealAccount",
    "_guestSessionCount",
    "_readComplimentaryUsed",
    "_rememberComplimentaryUsed",
    "_complimentaryUsedOnDevice",
    "_canStartNewSession",
  ];
  const src =
    "var FREE_GUEST_SESSION_LIMIT = 2;\n" +
    'var COMPLIMENTARY_USED_KEY = "saycrd-complimentary-used";\n' +
    names.map((n) => extractFunction(LANDING, n)).join("\n");
  const windowObj = { currentUser: currentUser || null };
  const fn = new Function(
    "window",
    "localStorage",
    src +
      "\nreturn { _isRealAccount, _guestSessionCount, _readComplimentaryUsed, _rememberComplimentaryUsed, _complimentaryUsedOnDevice, _canStartNewSession };"
  );
  return fn(windowObj, storage);
}

test("extraction: the ledger helpers exist in landing.jsx and are substantial", () => {
  for (const name of [
    "_readComplimentaryUsed",
    "_rememberComplimentaryUsed",
    "_complimentaryUsedOnDevice",
    "_canStartNewSession",
  ]) {
    const src = extractFunction(LANDING, name);
    assert.ok(src.length > 40, name + " looks truncated");
    assert.match(src, new RegExp("function " + name));
  }
  assert.match(LANDING, /FREE_GUEST_SESSION_LIMIT = 2/, "must not change the complimentary total");
  assert.match(LANDING, /saycrd-complimentary-used/, "landing.jsx must use the shared device key");
});

test("an unused device can start a guest session", () => {
  const h = loadHelpers(fakeStorage());
  assert.equal(h._canStartNewSession(), true);
  assert.equal(h._complimentaryUsedOnDevice(), 0);
});

test("two guest sessions on this device block a new guest session", () => {
  const storage = fakeStorage({
    "saycrd-local-user-sessions": JSON.stringify([{ date: "1" }, { date: "2" }]),
  });
  const h = loadHelpers(storage);
  assert.equal(h._guestSessionCount(), 2);
  assert.equal(h._canStartNewSession(), false);
});

test("account complimentary spent on this device blocks guest continue after logout", () => {
  // The bypass: no guest sessions, but the account already used its 2.
  const storage = fakeStorage({ [KEY]: "2" });
  const h = loadHelpers(storage, null);
  assert.equal(h._guestSessionCount(), 0);
  assert.equal(h._readComplimentaryUsed(), 2);
  assert.equal(h._canStartNewSession(), false);
});

test("one complimentary used still allows the second guest session", () => {
  const storage = fakeStorage({ [KEY]: "1" });
  const h = loadHelpers(storage);
  assert.equal(h._canStartNewSession(), true);
});

test("a real account is not gated by the guest ledger — paywall/credits handle them", () => {
  const storage = fakeStorage({ [KEY]: "2" });
  const h = loadHelpers(storage, { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" });
  assert.equal(h._canStartNewSession(), true);
});

test("remembering complimentary used is monotonic and capped at 2", () => {
  const storage = fakeStorage();
  const h = loadHelpers(storage);
  h._rememberComplimentaryUsed(1);
  assert.equal(h._readComplimentaryUsed(), 1);
  h._rememberComplimentaryUsed(0);
  assert.equal(h._readComplimentaryUsed(), 1, "must never decrease — logout cannot reset the allowance");
  h._rememberComplimentaryUsed(9);
  assert.equal(h._readComplimentaryUsed(), 2, "must not change the complimentary total");
});

test("index.html overlay and bypass consult the same device ledger", () => {
  assert.match(INDEX, /function _saycrdComplimentaryUsedOnDevice\(/);
  assert.match(INDEX, /saycrd-complimentary-used/);
  const helperAt = INDEX.indexOf("function _saycrdComplimentaryUsedOnDevice");
  const helper = INDEX.slice(helperAt, helperAt + 700);
  assert.doesNotMatch(
    helper,
    /saycrd-local-sessions/,
    "index.html must not probe guest session keys — that hid the homepage snapshot"
  );
  const bypassAt = INDEX.indexOf("window._localBypass = function");
  assert.ok(bypassAt > 0, "_localBypass is gone");
  const bypass = INDEX.slice(bypassAt, bypassAt + 900);
  assert.match(bypass, /_saycrdComplimentaryUsedOnDevice\(\) >= 2/, "bypass must refuse when the shared 2 are spent");

  const overlayAt = INDEX.indexOf("window._showAuthOverlay = function");
  assert.ok(overlayAt > 0, "_showAuthOverlay is gone");
  const overlay = INDEX.slice(overlayAt, overlayAt + 4500);
  assert.match(
    overlay,
    /requireAccount[\s\S]{0,200}_saycrdComplimentaryUsedOnDevice\(\) >= 2/,
    "login overlay must hide Continue without an account when the shared 2 are spent"
  );
});

test("useCredits writes account freeUsed onto the device ledger", () => {
  const src = extractFunction(APP, "useCredits");
  assert.match(src, /_rememberComplimentaryUsed\(2 - next\.freeRemaining\)/, "spent complimentary must survive logout");
  assert.doesNotMatch(
    src,
    /_rememberComplimentaryUsed\([^)]*balance/,
    "must not write purchased credits onto the complimentary ledger"
  );
});

test("a guest field-report save records complimentary use", () => {
  const src = extractFunction(APP, "saveFieldReportToSession");
  assert.match(src, /!_isRealAccount\(\)/);
  assert.match(src, /_rememberComplimentaryUsed\(_guestSessionCount\(\)\)/);
});

test("control: dropping the ledger from _canStartNewSession reopens the logout bypass", () => {
  const poisoned = LANDING.replace(
    "return _isRealAccount() || _complimentaryUsedOnDevice() < FREE_GUEST_SESSION_LIMIT;",
    "return _isRealAccount() || _guestSessionCount() < FREE_GUEST_SESSION_LIMIT;"
  );
  assert.notEqual(poisoned, LANDING, "the mutation must actually have landed");
  const start = poisoned.indexOf("\nfunction _canStartNewSession(");
  assert.ok(start > 0);
  const body = poisoned.slice(start, start + 220);
  assert.match(body, /_guestSessionCount\(\)/);
  assert.doesNotMatch(body, /_complimentaryUsedOnDevice\(\)/);

  const storage = fakeStorage({ [KEY]: "2" });
  const names = ["_isRealAccount", "_guestSessionCount", "_readComplimentaryUsed", "_rememberComplimentaryUsed", "_complimentaryUsedOnDevice", "_canStartNewSession"];
  const src =
    "var FREE_GUEST_SESSION_LIMIT = 2;\n" +
    'var COMPLIMENTARY_USED_KEY = "saycrd-complimentary-used";\n' +
    names.map((n) => extractFunction(poisoned, n)).join("\n");
  const fn = new Function(
    "window",
    "localStorage",
    src + "\nreturn { _canStartNewSession, _guestSessionCount };"
  );
  const h = fn({ currentUser: null }, storage);
  assert.equal(h._guestSessionCount(), 0);
  assert.equal(h._canStartNewSession(), true, "poisoned gate must allow the bypass so the real test is not blind");
});
