// api/__tests__/session-sync.test.js — Stage 3 (session-persistence-audit):
// unit tests for public/session-sync.js's pure sync logic. Uses a fake
// in-memory localStorage and a fake fetch (no real network, no browser,
// no database) so guest-to-account transfer, duplicate prevention,
// failed-upload recovery, and server-to-Dashboard merge are all exercised
// deterministically. See that file's own header for why it is
// require()-able here despite living under public/.
import test from "node:test";
import assert from "node:assert/strict";
import SessionSync from "../../public/session-sync.js";

const { createSessionSync } = SessionSync;

function fakeStorage(seed) {
  const map = new Map(Object.entries(seed || {}));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, value);
    },
    _dump() {
      const out = {};
      for (const [k, v] of map.entries()) out[k] = v;
      return out;
    },
  };
}

// route: { "POST /api/sessions": (body) => ({status, body}), ... }
function fakeFetch(routes, calls) {
  return async function fetchImpl(url, opts) {
    const method = (opts && opts.method) || "GET";
    const path = url.split("?")[0];
    const key = method + " " + path;
    calls.push({ method, url, body: opts && opts.body ? JSON.parse(opts.body) : undefined });
    const handler = routes[key];
    if (!handler) throw new Error("no fake route for " + key);
    const result = await handler(opts && opts.body ? JSON.parse(opts.body) : undefined, url);
    if (result === "NETWORK_ERROR") throw new Error("simulated network failure");
    return { ok: result.status >= 200 && result.status < 300, status: result.status, json: async () => result.body };
  };
}

const UID = "real-user-uid-1";

function draftSession(overrides) {
  return Object.assign({ date: "2026-01-01T00:00:00.000Z", rawText: "hello", themes: [] }, overrides || {});
}

test("session-sync: guest-to-account transfer syncs every pending local session, creating drafts and completing the ones with a report", async () => {
  const calls = [];
  const sessions = [draftSession({ id: "s1" }), draftSession({ id: "s2", fieldReport: { sections: [] } })];
  const storage = fakeStorage({ "saycrd-real-user-uid-1-sessions": JSON.stringify(sessions) });

  const fetchImpl = fakeFetch(
    {
      "POST /api/sessions": (body) => ({ status: 201, body: { session: { id: body.id, status: "draft" } } }),
      "POST /api/session-complete": (body) => ({
        status: 200,
        body: { session: { id: body.session_id, status: "completed" }, report: { id: "r1", session_id: body.session_id } },
      }),
    },
    calls
  );

  const sync = createSessionSync({ fetchImpl, getToken: async () => "test-token", storage, now: () => "NOW" });
  const result = await sync.syncPendingSessions(UID);

  assert.equal(result.synced, 1, "only the session with a fieldReport reaches fully-complete");
  assert.equal(result.pending, 1, "the session without a report stays in draft, still pending");

  const stored = JSON.parse(storage.getItem("saycrd-real-user-uid-1-sessions"));
  const s1 = stored.find((s) => s.id === "s1");
  const s2 = stored.find((s) => s.id === "s2");
  assert.equal(s1._syncStage, "draft");
  assert.equal(s2._syncStage, "complete");
  // Never erased -- both sessions, guest-created before any account
  // existed, are still present locally after the transfer.
  assert.equal(stored.length, 2);

  const createCalls = calls.filter((c) => c.url === "/api/sessions");
  const completeCalls = calls.filter((c) => c.url === "/api/session-complete");
  assert.equal(createCalls.length, 2, "both sessions get an idempotent create call");
  assert.equal(completeCalls.length, 1, "only the session with a report gets a complete call");
});

test("session-sync: duplicate prevention — a session already marked complete is never re-sent on a later sync pass", async () => {
  const calls = [];
  const sessions = [draftSession({ id: "s1", fieldReport: { sections: [] }, _syncStage: "complete" })];
  const storage = fakeStorage({ "saycrd-real-user-uid-1-sessions": JSON.stringify(sessions) });
  const fetchImpl = fakeFetch(
    {
      "POST /api/sessions": () => ({ status: 201, body: { session: {} } }),
      "POST /api/session-complete": () => ({ status: 200, body: { session: {}, report: {} } }),
    },
    calls
  );

  const sync = createSessionSync({ fetchImpl, getToken: async () => "test-token", storage, now: () => "NOW" });
  const result = await sync.syncPendingSessions(UID);

  assert.equal(result.synced, 0);
  assert.equal(result.pending, 0);
  assert.equal(calls.length, 0, "an already-complete session must never trigger a network call again");
});

test("session-sync: duplicate prevention — retrying create for the same session id does not send a second create request per pass", async () => {
  const calls = [];
  const sessions = [draftSession({ id: "s1", _syncStage: "draft" })];
  const storage = fakeStorage({ "saycrd-real-user-uid-1-sessions": JSON.stringify(sessions) });
  const fetchImpl = fakeFetch({ "POST /api/sessions": () => ({ status: 201, body: { session: {} } }) }, calls);

  const sync = createSessionSync({ fetchImpl, getToken: async () => "test-token", storage, now: () => "NOW" });
  await sync.syncPendingSessions(UID);

  assert.equal(calls.length, 0, "a session already at the draft stage skips the create call entirely on a later pass");
});

test("session-sync: failed upload recovery — a network failure leaves the session pending with a recorded, non-silent error, and a later retry succeeds", async () => {
  const calls = [];
  const sessions = [draftSession({ id: "s1" })];
  const storage = fakeStorage({ "saycrd-real-user-uid-1-sessions": JSON.stringify(sessions) });

  let shouldFail = true;
  const fetchImpl = fakeFetch(
    {
      "POST /api/sessions": () => (shouldFail ? "NETWORK_ERROR" : { status: 201, body: { session: { id: "s1", status: "draft" } } }),
    },
    calls
  );

  const sync = createSessionSync({ fetchImpl, getToken: async () => "test-token", storage, now: () => "NOW" });

  const firstAttempt = await sync.syncPendingSessions(UID);
  assert.equal(firstAttempt.failed, 1);
  assert.equal(firstAttempt.pending, 1);
  let stored = JSON.parse(storage.getItem("saycrd-real-user-uid-1-sessions"));
  assert.equal(stored[0]._syncError, "network", "the failure is recorded, never silently swallowed");
  assert.notEqual(stored[0]._syncStage, "complete");
  assert.equal(stored.length, 1, "the session's local content is never erased after a failed upload");

  shouldFail = false;
  const retryAttempt = await sync.syncPendingSessions(UID);
  assert.equal(retryAttempt.failed, 0);
  stored = JSON.parse(storage.getItem("saycrd-real-user-uid-1-sessions"));
  assert.equal(stored[0]._syncError, null, "a successful retry clears the recorded error");
  assert.equal(stored[0]._syncStage, "draft");
});

test("session-sync: guests are never synced — no network call is made for a guest or bypass uid", async () => {
  const calls = [];
  const storage = fakeStorage({ "saycrd-local-user-sessions": JSON.stringify([draftSession({ id: "s1" })]) });
  const fetchImpl = fakeFetch({ "POST /api/sessions": () => ({ status: 201, body: { session: {} } }) }, calls);
  const sync = createSessionSync({ fetchImpl, getToken: async () => "test-token", storage, now: () => "NOW" });

  const resultLocal = await sync.syncPendingSessions("local");
  const resultBypass = await sync.syncPendingSessions("local-user");
  assert.deepEqual(resultLocal, { synced: 0, failed: 0, pending: 0 });
  assert.deepEqual(resultBypass, { synced: 0, failed: 0, pending: 0 });
  assert.equal(calls.length, 0);
});

test("session-sync: server-to-Dashboard loading — merging server sessions adds a different device's session without erasing a local-only unsynced one", async () => {
  const localOnly = draftSession({ id: "local-only-1" });
  const storage = fakeStorage({ "saycrd-real-user-uid-1-sessions": JSON.stringify([localOnly]) });
  const sync = createSessionSync({ fetchImpl: async () => { throw new Error("not used"); }, getToken: async () => null, storage, now: () => "NOW" });

  const serverSessions = [
    { id: "server-only-1", status: "completed", content: { date: "2026-02-01T00:00:00.000Z", rawText: "from another device" } },
  ];
  const merged = sync.mergeServerSessionsIntoLocal(UID, serverSessions);

  assert.equal(merged.length, 2, "the local-only session is kept, the server-only one is added");
  const local = merged.find((s) => s.id === "local-only-1");
  const fromServer = merged.find((s) => s.id === "server-only-1");
  assert.ok(local, "local-only session was never erased");
  assert.ok(fromServer);
  assert.equal(fromServer.rawText, "from another device");
  assert.equal(fromServer._syncStage, "complete");
});

test("session-sync: server-to-Dashboard loading — a server row that also exists locally is merged with local fields taking priority", async () => {
  const local = draftSession({ id: "shared-1", rawText: "local has a richer edit", _syncStage: "draft" });
  const storage = fakeStorage({ "saycrd-real-user-uid-1-sessions": JSON.stringify([local]) });
  const sync = createSessionSync({ fetchImpl: async () => { throw new Error("not used"); }, getToken: async () => null, storage, now: () => "NOW" });

  const serverSessions = [{ id: "shared-1", status: "completed", content: { date: "2026-01-01T00:00:00.000Z", rawText: "stale server copy" } }];
  const merged = sync.mergeServerSessionsIntoLocal(UID, serverSessions);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].rawText, "local has a richer edit", "local content wins over a conflicting server field");
  assert.equal(merged[0]._syncStage, "complete", "sync stage still reflects the server's authoritative status");
});
