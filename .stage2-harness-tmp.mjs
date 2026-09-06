#!/usr/bin/env node
// Stage 2 (session-persistence-audit) live API verification harness.
// Disposable, staging-only test script — NOT part of the application.
// Exercises the real route handlers (api/sessions.js, reports.js, captures.js,
// bookmarks.js) against real staging Postgres + real Supabase Auth, using two
// disposable Auth users created via the Admin API. Guarantees cleanup of all
// created rows and both Auth users, even on failure, via try/finally.
// DISPOSABLE: deleted after the run, never committed.

const STAGING_REF = "lbydmtgeojnozzhwsava";
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;
const STAGING_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxieWRtdGdlb2pub3p6aHdzYXZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2Mjc5NTUsImV4cCI6MjEwNDIwMzk1NX0.hj2K6Rrix7_jthpetTQqcQUiibgPZm6HScTFVPyGV_o";
const STAGING_SERVICE_KEY = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;

if (!STAGING_SERVICE_KEY) {
  console.error("ABORT: STAGING_SUPABASE_SERVICE_ROLE_KEY not set in environment.");
  process.exit(1);
}

// Set env vars BEFORE importing any API module — _lib.js's getServiceClient()
// reads these lazily, but we set them ahead of the dynamic import regardless.
process.env.SUPABASE_URL = STAGING_URL;
process.env.SUPABASE_SERVICE_ROLE_KEY = STAGING_SERVICE_KEY;

// Hard preflight assertion — abort immediately if this doesn't look like staging.
if (!process.env.SUPABASE_URL.includes(STAGING_REF)) {
  console.error("ABORT: SUPABASE_URL does not contain the staging project ref. Refusing to proceed.");
  process.exit(1);
}

const API_DIR = "/vercel/share/v0-project/saycrd-repo/api";
const { default: sessionsHandler } = await import(API_DIR + "/sessions.js");
const { default: reportsHandler } = await import(API_DIR + "/reports.js");
const { default: capturesHandler } = await import(API_DIR + "/captures.js");
const { default: bookmarksHandler } = await import(API_DIR + "/bookmarks.js");
const { getServiceClient } = await import(API_DIR + "/_lib.js");

const sb = getServiceClient();
// Belt-and-suspenders: re-confirm the constructed client itself targets staging.
if (!sb.supabaseUrl || !sb.supabaseUrl.includes(STAGING_REF)) {
  console.error("ABORT: service client is not pointed at staging after import.");
  process.exit(1);
}

function makeReq({ method = "GET", query = {}, body = undefined, headers = {} } = {}) {
  return { method, query, body, headers };
}
function makeRes() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    ended: false,
    setHeader(n, v) {
      this.headers[n] = v;
    },
    status(c) {
      this.statusCode = c;
      return this;
    },
    json(p) {
      this.body = p;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
  };
}
async function call(handler, opts) {
  const req = makeReq(opts);
  const res = makeRes();
  await handler(req, res);
  return res;
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass: !!pass, detail: detail || "" });
}
async function t(name, fn) {
  try {
    await fn();
  } catch (e) {
    record(name, false, "threw: " + e.message);
  }
}

async function createDisposableUser(label) {
  const email = `stage2-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@synthetic.invalid`;
  const password = `Stage2-${Math.random().toString(36).slice(2, 10)}!Aa1`;
  const r = await fetch(STAGING_URL + "/auth/v1/admin/users", {
    method: "POST",
    headers: { apikey: STAGING_SERVICE_KEY, Authorization: "Bearer " + STAGING_SERVICE_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, email_confirm: true, password }),
  });
  if (r.status !== 200 && r.status !== 201) throw new Error("create user failed: status " + r.status);
  const body = await r.json();
  return { id: body.id, email, password };
}
async function signIn(email, password) {
  const r = await fetch(STAGING_URL + "/auth/v1/token?grant_type=password", {
    method: "POST",
    headers: { apikey: STAGING_ANON_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await r.json();
  if (!body.access_token) throw new Error("signin failed: status " + r.status);
  return body.access_token;
}
async function deleteDisposableUser(id) {
  if (!id) return;
  await fetch(STAGING_URL + "/auth/v1/admin/users/" + id, {
    method: "DELETE",
    headers: { apikey: STAGING_SERVICE_KEY, Authorization: "Bearer " + STAGING_SERVICE_KEY },
  });
}

let userA = null;
let userB = null;

await (async () => {
  try {
    userA = await createDisposableUser("a");
    userB = await createDisposableUser("b");
    const tokenA = await signIn(userA.email, userA.password);
    const tokenB = await signIn(userB.email, userB.password);
    const authA = { authorization: "Bearer " + tokenA };
    const authB = { authorization: "Bearer " + tokenB };

    // ============ SESSIONS ============
    await t("sessions: no auth -> 401", async () => {
      const res = await call(sessionsHandler, { method: "GET" });
      record("sessions: no auth -> 401", res.statusCode === 401 && res.body.error === "authentication_required");
    });

    await t("sessions: OPTIONS -> 200", async () => {
      const res = await call(sessionsHandler, { method: "OPTIONS", headers: authA });
      record("sessions: OPTIONS -> 200", res.statusCode === 200);
    });

    await t("sessions: create unsupported field -> 400", async () => {
      const res = await call(sessionsHandler, { method: "POST", headers: authA, body: { content: {}, status: "completed" } });
      record("sessions: create unsupported field -> 400", res.statusCode === 400 && res.body.error === "unsupported_field");
    });

    let sessionA1;
    await t("sessions: create success, public fields only", async () => {
      const res = await call(sessionsHandler, { method: "POST", headers: authA, body: { content: { note: "hello" } } });
      sessionA1 = res.body.session;
      const keys = Object.keys(sessionA1 || {}).sort();
      const expected = ["completed_at", "content", "created_at", "id", "schema_version", "status", "updated_at"].sort();
      record("sessions: create success -> 201", res.statusCode === 201);
      record(
        "sessions: create response has exactly public fields, no user_id",
        JSON.stringify(keys) === JSON.stringify(expected) && !("user_id" in sessionA1),
        JSON.stringify(keys)
      );
    });

    await t("sessions: create with client id then repeat is idempotent, content unchanged", async () => {
      const clientId = crypto.randomUUID();
      const res1 = await call(sessionsHandler, { method: "POST", headers: authA, body: { id: clientId, content: { v: 1 } } });
      const res2 = await call(sessionsHandler, { method: "POST", headers: authA, body: { id: clientId, content: { v: 999 } } });
      record("sessions: first create with client id -> 201", res1.statusCode === 201);
      record(
        "sessions: repeat same id, same owner, still draft -> 200 idempotent",
        res2.statusCode === 200 && JSON.stringify(res2.body.session.content) === JSON.stringify({ v: 1 })
      );
    });

    await t("sessions: create with id owned by another user -> 409 conflict, generic", async () => {
      const clientId = crypto.randomUUID();
      const resB = await call(sessionsHandler, { method: "POST", headers: authB, body: { id: clientId, content: {} } });
      const resA = await call(sessionsHandler, { method: "POST", headers: authA, body: { id: clientId, content: {} } });
      record(
        "sessions: id conflict across owners -> 409 conflict",
        resB.statusCode === 201 && resA.statusCode === 409 && resA.body.error === "conflict"
      );
    });

    await t("sessions: autosave unsupported field -> 400", async () => {
      const res = await call(sessionsHandler, {
        method: "PATCH",
        headers: authA,
        query: { id: sessionA1.id },
        body: { content: {}, user_id: userB.id },
      });
      record("sessions: autosave unsupported field -> 400", res.statusCode === 400 && res.body.error === "unsupported_field");
    });

    await t("sessions: autosave content by owner -> 200 updates", async () => {
      const res = await call(sessionsHandler, {
        method: "PATCH",
        headers: authA,
        query: { id: sessionA1.id },
        body: { content: { note: "updated" } },
      });
      record("sessions: autosave success -> 200 content updated", res.statusCode === 200 && res.body.session.content.note === "updated");
    });

    await t("sessions: cross-user autosave -> 404, does not modify", async () => {
      const res = await call(sessionsHandler, {
        method: "PATCH",
        headers: authB,
        query: { id: sessionA1.id },
        body: { content: { note: "hacked" } },
      });
      const verify = await call(sessionsHandler, { method: "GET", headers: authA, query: { id: sessionA1.id } });
      record("sessions: cross-user autosave -> 404 not_found", res.statusCode === 404 && res.body.error === "not_found");
      record("sessions: cross-user autosave did not modify content", verify.body.session.content.note === "updated");
    });

    await t("sessions: getOne — cross-user and nonexistent both -> identical generic 404", async () => {
      const resCross = await call(sessionsHandler, { method: "GET", headers: authB, query: { id: sessionA1.id } });
      const resMissing = await call(sessionsHandler, { method: "GET", headers: authA, query: { id: crypto.randomUUID() } });
      record(
        "sessions: getOne cross-user -> 404 not_found",
        resCross.statusCode === 404 && resCross.body.error === "not_found"
      );
      record(
        "sessions: getOne nonexistent -> 404 not_found (same as cross-user)",
        resMissing.statusCode === 404 && resMissing.body.error === "not_found"
      );
    });

    await t("sessions: getOne invalid id -> 400", async () => {
      const res = await call(sessionsHandler, { method: "GET", headers: authA, query: { id: "not-a-uuid" } });
      record("sessions: getOne invalid id -> 400", res.statusCode === 400 && res.body.error === "invalid_id");
    });

    await t("sessions: autosave on a non-editable (completed) session -> 409", async () => {
      const { data, error } = await sb.from("sessions").insert({ user_id: userA.id, content: {}, status: "draft" }).select("id").single();
      if (error) throw error;
      const { error: updErr } = await sb
        .from("sessions")
        .update({ status: "completed", completed_at: new Date().toISOString() })
        .eq("id", data.id);
      if (updErr) throw updErr;
      const res = await call(sessionsHandler, {
        method: "PATCH",
        headers: authA,
        query: { id: data.id },
        body: { content: { note: "x" } },
      });
      record(
        "sessions: autosave on completed session -> 409 session_not_editable",
        res.statusCode === 409 && res.body.error === "session_not_editable"
      );
    });

    await t("sessions: list pagination + ownership isolation", async () => {
      const ids = [];
      for (let i = 0; i < 3; i++) {
        const res = await call(sessionsHandler, { method: "POST", headers: authA, body: { content: { i } } });
        ids.push(res.body.session.id);
        await new Promise((r) => setTimeout(r, 20));
      }
      const page1 = await call(sessionsHandler, { method: "GET", headers: authA, query: { limit: "2" } });
      const hasCursor = !!page1.body.next_cursor;
      let page2Ids = [];
      if (hasCursor) {
        const page2 = await call(sessionsHandler, { method: "GET", headers: authA, query: { limit: "2", cursor: page1.body.next_cursor } });
        page2Ids = page2.body.sessions.map((s) => s.id);
      }
      const page1Ids = page1.body.sessions.map((s) => s.id);
      const overlap = page1Ids.filter((id) => page2Ids.includes(id));
      record("sessions: list respects limit", page1.body.sessions.length === 2);
      record("sessions: list returns next_cursor when more rows remain", hasCursor);
      record("sessions: list pagination has no overlap/duplicates across pages", overlap.length === 0);

      const listB = await call(sessionsHandler, { method: "GET", headers: authB });
      const leaked = listB.body.sessions.some((s) => ids.includes(s.id) || s.id === sessionA1.id);
      record("sessions: list ownership isolation — userB never sees userA's sessions", !leaked);
    });

    await t("sessions: DELETE method -> 405", async () => {
      const res = await call(sessionsHandler, { method: "DELETE", headers: authA });
      record("sessions: DELETE method -> 405", res.statusCode === 405 && res.body.error === "method_not_allowed");
    });

    // ============ REPORTS ============
    await t("reports: no auth -> 401", async () => {
      const res = await call(reportsHandler, { method: "GET", query: { session_id: sessionA1.id } });
      record("reports: no auth -> 401", res.statusCode === 401 && res.body.error === "authentication_required");
    });

    await t("reports: no report yet for owned session -> 404", async () => {
      const res = await call(reportsHandler, { method: "GET", headers: authA, query: { session_id: sessionA1.id } });
      record("reports: session with no report -> 404 not_found", res.statusCode === 404 && res.body.error === "not_found");
    });

    await t("reports: invalid session_id format -> 400", async () => {
      const res = await call(reportsHandler, { method: "GET", headers: authA, query: { session_id: "bad" } });
      record("reports: invalid session_id -> 400", res.statusCode === 400 && res.body.error === "invalid_session_id");
    });

    await t("reports: cross-user and nonexistent session both -> identical generic 404", async () => {
      const resCross = await call(reportsHandler, { method: "GET", headers: authB, query: { session_id: sessionA1.id } });
      const resMissing = await call(reportsHandler, { method: "GET", headers: authA, query: { session_id: crypto.randomUUID() } });
      record("reports: cross-user session -> 404 not_found", resCross.statusCode === 404 && resCross.body.error === "not_found");
      record(
        "reports: nonexistent session -> 404 not_found (same as cross-user)",
        resMissing.statusCode === 404 && resMissing.body.error === "not_found"
      );
    });

    await t("reports: successful retrieval — exactly public fields, no internal bookkeeping exposed", async () => {
      const { data: sess, error: sessErr } = await sb.from("sessions").insert({ user_id: userA.id, content: {}, status: "completed" }).select("id").single();
      if (sessErr) throw sessErr;
      const { error: repErr } = await sb.from("reports").insert({
        session_id: sess.id,
        user_id: userA.id,
        status: "complete",
        content: { sections: [], oneLineVerdict: "test verdict" },
        one_line_verdict: "test verdict",
        migration_source: null,
        needs_normalization: true,
        attempt_count: 3,
        last_error: "generation_timeout",
      });
      if (repErr) throw repErr;

      const res = await call(reportsHandler, { method: "GET", headers: authA, query: { session_id: sess.id } });
      const keys = Object.keys(res.body.report || {}).sort();
      const expected = ["content", "created_at", "id", "one_line_verdict", "schema_version", "session_id", "status", "updated_at"].sort();
      const noInternal =
        !("user_id" in res.body.report) &&
        !("migration_source" in res.body.report) &&
        !("needs_normalization" in res.body.report) &&
        !("attempt_count" in res.body.report) &&
        !("last_error" in res.body.report);
      record("reports: successful retrieval -> 200", res.statusCode === 200);
      record("reports: response has exactly public fields", JSON.stringify(keys) === JSON.stringify(expected), JSON.stringify(keys));
      record("reports: internal bookkeeping fields never exposed even though populated on the row", noInternal);
    });

    await t("reports: double ownership check — session ok but report.user_id mismatched -> 404", async () => {
      const { data: sess, error: sessErr } = await sb.from("sessions").insert({ user_id: userA.id, content: {}, status: "completed" }).select("id").single();
      if (sessErr) throw sessErr;
      const { error: repErr } = await sb.from("reports").insert({
        session_id: sess.id,
        user_id: userB.id, // deliberately mismatched from session.user_id
        status: "complete",
        content: {},
      });
      if (repErr) throw repErr;

      const res = await call(reportsHandler, { method: "GET", headers: authA, query: { session_id: sess.id } });
      record(
        "reports: mismatched report.user_id (session ok) -> 404, double-check enforced",
        res.statusCode === 404 && res.body.error === "not_found"
      );
    });

    await t("reports: POST method -> 405", async () => {
      const res = await call(reportsHandler, { method: "POST", headers: authA, query: { session_id: sessionA1.id } });
      record("reports: POST method -> 405", res.statusCode === 405 && res.body.error === "method_not_allowed");
    });

    // ============ CAPTURES ============
    await t("captures: no auth -> 401", async () => {
      const res = await call(capturesHandler, { method: "GET" });
      record("captures: no auth -> 401", res.statusCode === 401 && res.body.error === "authentication_required");
    });

    await t("captures: create unsupported field -> 400", async () => {
      const res = await call(capturesHandler, { method: "POST", headers: authA, body: { text: "x", user_id: userB.id } });
      record("captures: create unsupported field -> 400", res.statusCode === 400 && res.body.error === "unsupported_field");
    });

    await t("captures: create text too long -> 400 invalid_text", async () => {
      const res = await call(capturesHandler, { method: "POST", headers: authA, body: { text: "a".repeat(301) } });
      record("captures: text too long -> 400 invalid_text", res.statusCode === 400 && res.body.error === "invalid_text");
    });

    await t("captures: create invalid source -> 400 invalid_source", async () => {
      const res = await call(capturesHandler, { method: "POST", headers: authA, body: { text: "hi", source: "not_a_real_source" } });
      record("captures: invalid source -> 400 invalid_source", res.statusCode === 400 && res.body.error === "invalid_source");
    });

    await t("captures: create with another user's session_id -> 400 invalid_session_id, generic", async () => {
      const sB = await call(sessionsHandler, { method: "POST", headers: authB, body: { content: {} } });
      const res = await call(capturesHandler, { method: "POST", headers: authA, body: { text: "hi", session_id: sB.body.session.id } });
      record("captures: cross-user session_id -> 400 invalid_session_id", res.statusCode === 400 && res.body.error === "invalid_session_id");
    });

    let captureA1;
    await t("captures: create success, public fields only, source defaults to report", async () => {
      const res = await call(capturesHandler, { method: "POST", headers: authA, body: { text: "hello capture" } });
      captureA1 = res.body.capture;
      const keys = Object.keys(captureA1).sort();
      const expected = ["created_at", "id", "note", "session_id", "source", "text"].sort();
      record("captures: create success -> 201", res.statusCode === 201);
      record("captures: default source is report", captureA1.source === "report");
      record(
        "captures: response has exactly public fields, no user_id",
        JSON.stringify(keys) === JSON.stringify(expected) && !("user_id" in captureA1),
        JSON.stringify(keys)
      );
    });

    await t("captures: create with own session_id links correctly", async () => {
      const res = await call(capturesHandler, { method: "POST", headers: authA, body: { text: "linked", session_id: sessionA1.id } });
      record("captures: create with own session_id -> 201 and session_id set", res.statusCode === 201 && res.body.capture.session_id === sessionA1.id);
    });

    await t("captures: list pagination + ownership isolation", async () => {
      const ids = [];
      for (let i = 0; i < 3; i++) {
        const res = await call(capturesHandler, { method: "POST", headers: authA, body: { text: "page-test-" + i } });
        ids.push(res.body.capture.id);
        await new Promise((r) => setTimeout(r, 20));
      }
      const page1 = await call(capturesHandler, { method: "GET", headers: authA, query: { limit: "2" } });
      const hasCursor = !!page1.body.next_cursor;
      let page2Ids = [];
      if (hasCursor) {
        const page2 = await call(capturesHandler, { method: "GET", headers: authA, query: { limit: "2", cursor: page1.body.next_cursor } });
        page2Ids = page2.body.captures.map((c) => c.id);
      }
      const page1Ids = page1.body.captures.map((c) => c.id);
      const overlap = page1Ids.filter((id) => page2Ids.includes(id));
      record("captures: list respects limit", page1.body.captures.length === 2);
      record("captures: list pagination no overlap", overlap.length === 0);

      const listB = await call(capturesHandler, { method: "GET", headers: authB });
      const leaked = listB.body.captures.some((c) => ids.includes(c.id) || c.id === captureA1.id);
      record("captures: list ownership isolation", !leaked);
    });

    await t("captures: delete — cross-user and nonexistent both -> identical generic 404", async () => {
      const resCross = await call(capturesHandler, { method: "DELETE", headers: authB, query: { id: captureA1.id } });
      const verify = await call(capturesHandler, { method: "GET", headers: authA, query: {} });
      const stillThere = verify.body.captures.some((c) => c.id === captureA1.id);
      const resMissing = await call(capturesHandler, { method: "DELETE", headers: authA, query: { id: crypto.randomUUID() } });
      record("captures: cross-user delete -> 404 not_found", resCross.statusCode === 404 && resCross.body.error === "not_found");
      record("captures: cross-user delete did not remove the row", stillThere);
      record(
        "captures: nonexistent delete -> 404 not_found (same as cross-user)",
        resMissing.statusCode === 404 && resMissing.body.error === "not_found"
      );
    });

    await t("captures: delete own -> 200, then gone", async () => {
      const res = await call(capturesHandler, { method: "DELETE", headers: authA, query: { id: captureA1.id } });
      const verify = await call(capturesHandler, { method: "GET", headers: authA, query: {} });
      const gone = !verify.body.captures.some((c) => c.id === captureA1.id);
      record("captures: own delete -> 200 ok:true", res.statusCode === 200 && res.body.ok === true);
      record("captures: deleted row is actually gone", gone);
    });

    await t("captures: delete invalid id format -> 400", async () => {
      const res = await call(capturesHandler, { method: "DELETE", headers: authA, query: { id: "not-a-uuid" } });
      record("captures: delete invalid id -> 400 invalid_id", res.statusCode === 400 && res.body.error === "invalid_id");
    });

    await t("captures: PATCH method (no update route exists) -> 405", async () => {
      const res = await call(capturesHandler, { method: "PATCH", headers: authA, query: { id: crypto.randomUUID() } });
      record("captures: PATCH method -> 405", res.statusCode === 405 && res.body.error === "method_not_allowed");
    });

    // ============ BOOKMARKS ============
    await t("bookmarks: no auth -> 401", async () => {
      const res = await call(bookmarksHandler, { method: "GET" });
      record("bookmarks: no auth -> 401", res.statusCode === 401 && res.body.error === "authentication_required");
    });

    await t("bookmarks: create unsupported field -> 400", async () => {
      const res = await call(bookmarksHandler, { method: "POST", headers: authA, body: { text: "x", user_id: userB.id } });
      record("bookmarks: create unsupported field -> 400", res.statusCode === 400 && res.body.error === "unsupported_field");
    });

    await t("bookmarks: create text too long -> 400 invalid_text", async () => {
      const res = await call(bookmarksHandler, { method: "POST", headers: authA, body: { text: "a".repeat(2001) } });
      record("bookmarks: text too long -> 400 invalid_text", res.statusCode === 400 && res.body.error === "invalid_text");
    });

    await t("bookmarks: create with another user's session_id -> 400 invalid_session_id, generic", async () => {
      const sB = await call(sessionsHandler, { method: "POST", headers: authB, body: { content: {} } });
      const res = await call(bookmarksHandler, { method: "POST", headers: authA, body: { text: "hi", session_id: sB.body.session.id } });
      record("bookmarks: cross-user session_id -> 400 invalid_session_id", res.statusCode === 400 && res.body.error === "invalid_session_id");
    });

    let bookmarkA1;
    await t("bookmarks: create success, public fields only", async () => {
      const res = await call(bookmarksHandler, { method: "POST", headers: authA, body: { text: "hello bookmark", label: "important" } });
      bookmarkA1 = res.body.bookmark;
      const keys = Object.keys(bookmarkA1).sort();
      const expected = ["created_at", "id", "label", "session_id", "text"].sort();
      record("bookmarks: create success -> 201", res.statusCode === 201);
      record(
        "bookmarks: response has exactly public fields, no user_id",
        JSON.stringify(keys) === JSON.stringify(expected) && !("user_id" in bookmarkA1),
        JSON.stringify(keys)
      );
    });

    await t("bookmarks: list pagination + ownership isolation", async () => {
      const ids = [];
      for (let i = 0; i < 3; i++) {
        const res = await call(bookmarksHandler, { method: "POST", headers: authA, body: { text: "page-test-" + i } });
        ids.push(res.body.bookmark.id);
        await new Promise((r) => setTimeout(r, 20));
      }
      const page1 = await call(bookmarksHandler, { method: "GET", headers: authA, query: { limit: "2" } });
      const hasCursor = !!page1.body.next_cursor;
      let page2Ids = [];
      if (hasCursor) {
        const page2 = await call(bookmarksHandler, { method: "GET", headers: authA, query: { limit: "2", cursor: page1.body.next_cursor } });
        page2Ids = page2.body.bookmarks.map((b) => b.id);
      }
      const page1Ids = page1.body.bookmarks.map((b) => b.id);
      const overlap = page1Ids.filter((id) => page2Ids.includes(id));
      record("bookmarks: list respects limit", page1.body.bookmarks.length === 2);
      record("bookmarks: list pagination no overlap", overlap.length === 0);

      const listB = await call(bookmarksHandler, { method: "GET", headers: authB });
      const leaked = listB.body.bookmarks.some((b) => ids.includes(b.id) || b.id === bookmarkA1.id);
      record("bookmarks: list ownership isolation", !leaked);
    });

    await t("bookmarks: delete — cross-user and nonexistent both -> identical generic 404", async () => {
      const resCross = await call(bookmarksHandler, { method: "DELETE", headers: authB, query: { id: bookmarkA1.id } });
      const verify = await call(bookmarksHandler, { method: "GET", headers: authA, query: {} });
      const stillThere = verify.body.bookmarks.some((b) => b.id === bookmarkA1.id);
      const resMissing = await call(bookmarksHandler, { method: "DELETE", headers: authA, query: { id: crypto.randomUUID() } });
      record("bookmarks: cross-user delete -> 404 not_found", resCross.statusCode === 404 && resCross.body.error === "not_found");
      record("bookmarks: cross-user delete did not remove the row", stillThere);
      record(
        "bookmarks: nonexistent delete -> 404 not_found (same as cross-user)",
        resMissing.statusCode === 404 && resMissing.body.error === "not_found"
      );
    });

    await t("bookmarks: delete own -> 200, then gone", async () => {
      const res = await call(bookmarksHandler, { method: "DELETE", headers: authA, query: { id: bookmarkA1.id } });
      const verify = await call(bookmarksHandler, { method: "GET", headers: authA, query: {} });
      const gone = !verify.body.bookmarks.some((b) => b.id === bookmarkA1.id);
      record("bookmarks: own delete -> 200 ok:true", res.statusCode === 200 && res.body.ok === true);
      record("bookmarks: deleted row is actually gone", gone);
    });

    await t("bookmarks: PATCH method (no update route exists) -> 405", async () => {
      const res = await call(bookmarksHandler, { method: "PATCH", headers: authA, query: { id: crypto.randomUUID() } });
      record("bookmarks: PATCH method -> 405", res.statusCode === 405 && res.body.error === "method_not_allowed");
    });
  } finally {
    const cleanupErrors = [];
    try {
      if (userA) {
        await sb.from("captures").delete().eq("user_id", userA.id);
        await sb.from("bookmarks").delete().eq("user_id", userA.id);
        await sb.from("sessions").delete().eq("user_id", userA.id); // cascades any reports
      }
      if (userB) {
        await sb.from("captures").delete().eq("user_id", userB.id);
        await sb.from("bookmarks").delete().eq("user_id", userB.id);
        await sb.from("sessions").delete().eq("user_id", userB.id);
      }
    } catch (e) {
      cleanupErrors.push("row cleanup: " + e.message);
    }
    try {
      if (userA) await deleteDisposableUser(userA.id);
    } catch (e) {
      cleanupErrors.push("delete userA: " + e.message);
    }
    try {
      if (userB) await deleteDisposableUser(userB.id);
    } catch (e) {
      cleanupErrors.push("delete userB: " + e.message);
    }

    const passed = results.filter((r) => r.pass).length;
    const failed = results.filter((r) => !r.pass);
    console.log(
      JSON.stringify(
        {
          total: results.length,
          passed,
          failed: failed.length,
          failures: failed.map((f) => ({ name: f.name, detail: f.detail })),
          cleanupErrors,
          userAId: userA ? userA.id : null,
          userBId: userB ? userB.id : null,
        },
        null,
        2
      )
    );
  }
})();
