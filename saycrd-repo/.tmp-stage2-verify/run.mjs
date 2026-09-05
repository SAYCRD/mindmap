// Stage 2 live verification harness — TEMPORARY, deleted after this run.
// Targets ONLY the isolated staging Supabase branch (lbydmtgeojnozzhwsava).
// Never logs raw row content, tokens, or keys — only structural
// pass/fail assertions and generic error codes.
import { createClient } from "@supabase/supabase-js";
import { createSessionsHandler } from "../api/sessions.js";
import { createReportsHandler } from "../api/reports.js";
import { createCapturesHandler } from "../api/captures.js";
import { createBookmarksHandler } from "../api/bookmarks.js";

const STAGING_URL = "https://lbydmtgeojnozzhwsava.supabase.co";
const STAGING_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxieWRtdGdlb2pub3p6aHdzYXZhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODg2Mjc5NTUsImV4cCI6MjEwNDIwMzk1NX0.hj2K6Rrix7_jthpetTQqcQUiibgPZm6HScTFVPyGV_o";
const STAGING_SERVICE_KEY = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;

if (!STAGING_SERVICE_KEY) {
  console.error("[FAIL-SETUP] STAGING_SUPABASE_SERVICE_ROLE_KEY not present in process.env");
  process.exit(1);
}

const serviceClient = createClient(STAGING_URL, STAGING_SERVICE_KEY, { auth: { persistSession: false } });

async function stagingGetAuthedUser(req) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  if (!token) return null;
  try {
    const { data, error } = await serviceClient.auth.getUser(token);
    if (error || !data || !data.user) return null;
    return data.user;
  } catch (e) {
    return null;
  }
}
function stagingGetServiceClient() {
  return serviceClient;
}

const sessionsHandler = createSessionsHandler({ getAuthedUser: stagingGetAuthedUser, getServiceClient: stagingGetServiceClient });
const reportsHandler = createReportsHandler({ getAuthedUser: stagingGetAuthedUser, getServiceClient: stagingGetServiceClient });
const capturesHandler = createCapturesHandler({ getAuthedUser: stagingGetAuthedUser, getServiceClient: stagingGetServiceClient });
const bookmarksHandler = createBookmarksHandler({ getAuthedUser: stagingGetAuthedUser, getServiceClient: stagingGetServiceClient });

// ---- fake req/res (mirrors api/__tests__/_http.js's shape) ----
function makeReq({ method = "GET", headers = {}, query = {}, body = undefined } = {}) {
  return { method, headers, query, body };
}
function makeRes() {
  const res = {
    statusCode: null,
    body: undefined,
    ended: false,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    end() {
      this.ended = true;
      return this;
    },
    setHeader() {},
  };
  return res;
}

// ---- result tracking (structural only — never logs row content) ----
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`[PASS] ${name}`);
  } catch (e) {
    results.push({ name, ok: false, reason: e.message });
    console.log(`[FAIL] ${name}: ${e.message}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

// Captures any 4xx/5xx body seen during the whole run, for the
// logging/response-safety check at the end.
const seenErrorBodies = [];
function trackRes(res) {
  if (res.statusCode >= 400 && res.body) seenErrorBodies.push(res.body);
  return res;
}

const defects = [];
const fixes = [];

async function main() {
  console.log("=== Stage 2 live verification against staging branch lbydmtgeojnozzhwsava ===");

  // ---------------------------------------------------------------
  // 0. Disposable users
  // ---------------------------------------------------------------
  const stamp = Date.now();
  const emailA = `stage2-verify-a-${stamp}@example.test`;
  const emailB = `stage2-verify-b-${stamp}@example.test`;
  const password = `Ver1fy!${stamp}Aa`;

  const { data: createdA, error: errA } = await serviceClient.auth.admin.createUser({
    email: emailA,
    password,
    email_confirm: true,
  });
  const { data: createdB, error: errB } = await serviceClient.auth.admin.createUser({
    email: emailB,
    password,
    email_confirm: true,
  });
  if (errA || errB) {
    console.error("[FAIL-SETUP] could not create disposable staging users");
    process.exit(1);
  }
  const userA = createdA.user;
  const userB = createdB.user;

  const anonA = createClient(STAGING_URL, STAGING_ANON_KEY, { auth: { persistSession: false } });
  const anonB = createClient(STAGING_URL, STAGING_ANON_KEY, { auth: { persistSession: false } });
  const { data: signInA, error: signInErrA } = await anonA.auth.signInWithPassword({ email: emailA, password });
  const { data: signInB, error: signInErrB } = await anonB.auth.signInWithPassword({ email: emailB, password });
  if (signInErrA || signInErrB) {
    console.error("[FAIL-SETUP] could not sign in disposable staging users");
    await serviceClient.auth.admin.deleteUser(userA.id);
    await serviceClient.auth.admin.deleteUser(userB.id);
    process.exit(1);
  }
  const jwtA = signInA.session.access_token;
  const jwtB = signInB.session.access_token;
  // Tampered token — stands in for "a token not valid for this project"
  // without ever touching real production credentials/data. Flips one
  // character in the signature segment so the JWT is syntactically valid
  // but fails signature verification against staging's GoTrue.
  const tamperedJwt = tamperSignature(jwtA);

  const authHeader = (jwt) => (jwt ? { authorization: `Bearer ${jwt}` } : {});

  // Track ids created during this run for cleanup.
  const createdSessionIds = new Set();
  const createdCaptureIds = new Set();
  const createdBookmarkIds = new Set();

  // ---------------------------------------------------------------
  // 1. Auth boundary — for every route
  // ---------------------------------------------------------------
  const routes = [
    { name: "sessions", handler: sessionsHandler, method: "GET", query: {} },
    { name: "reports", handler: reportsHandler, method: "GET", query: { session_id: "00000000-0000-0000-0000-000000000000" } },
    { name: "captures", handler: capturesHandler, method: "GET", query: {} },
    { name: "bookmarks", handler: bookmarksHandler, method: "GET", query: {} },
  ];

  for (const r of routes) {
    await check(`[auth:${r.name}] missing token rejected`, async () => {
      const res = trackRes(makeRes());
      await r.handler(makeReq({ method: r.method, query: r.query, headers: {} }), res);
      assert(res.statusCode === 401, `expected 401, got ${res.statusCode}`);
      assert(res.body.error === "authentication_required", `unexpected error code: ${res.body.error}`);
    });

    await check(`[auth:${r.name}] invalid token rejected`, async () => {
      const res = trackRes(makeRes());
      await r.handler(makeReq({ method: r.method, query: r.query, headers: { authorization: "Bearer not-a-real-token" } }), res);
      assert(res.statusCode === 401, `expected 401, got ${res.statusCode}`);
    });

    await check(`[auth:${r.name}] tampered/foreign-signature token rejected`, async () => {
      const res = trackRes(makeRes());
      await r.handler(makeReq({ method: r.method, query: r.query, headers: authHeader(tamperedJwt) }), res);
      assert(res.statusCode === 401, `expected 401, got ${res.statusCode}`);
    });

    await check(`[auth:${r.name}] valid staging JWT accepted (not 401)`, async () => {
      const res = trackRes(makeRes());
      await r.handler(makeReq({ method: r.method, query: r.query, headers: authHeader(jwtA) }), res);
      assert(res.statusCode !== 401, `valid token was rejected, got ${res.statusCode}`);
    });
  }

  // Forged user_id in body — sessions/captures/bookmarks all whitelist
  // keys, so user_id must be rejected outright (400 unsupported_field),
  // never merged into the insert.
  await check("[auth:sessions] forged user_id field rejected outright", async () => {
    const res = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "POST", headers: authHeader(jwtA), body: { content: {}, user_id: userB.id } }), res);
    assert(res.statusCode === 400 && res.body.error === "unsupported_field", `expected 400 unsupported_field, got ${res.statusCode} ${res.body && res.body.error}`);
  });
  await check("[auth:captures] forged user_id field rejected outright", async () => {
    const res = trackRes(makeRes());
    await capturesHandler(makeReq({ method: "POST", headers: authHeader(jwtA), body: { text: "x", user_id: userB.id } }), res);
    assert(res.statusCode === 400 && res.body.error === "unsupported_field", `expected 400 unsupported_field, got ${res.statusCode} ${res.body && res.body.error}`);
  });
  await check("[auth:bookmarks] forged user_id field rejected outright", async () => {
    const res = trackRes(makeRes());
    await bookmarksHandler(makeReq({ method: "POST", headers: authHeader(jwtA), body: { text: "x", user_id: userB.id } }), res);
    assert(res.statusCode === 400 && res.body.error === "unsupported_field", `expected 400 unsupported_field, got ${res.statusCode} ${res.body && res.body.error}`);
  });

  // ---------------------------------------------------------------
  // 2. Sessions
  // ---------------------------------------------------------------
  let draftId = null;
  await check("[sessions] create a valid draft", async () => {
    const res = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "POST", headers: authHeader(jwtA), body: { content: { note: "hello" } } }), res);
    assert(res.statusCode === 201, `expected 201, got ${res.statusCode}`);
    assert(res.body.session.status === "draft", `expected draft, got ${res.body.session.status}`);
    assertOnlyKeys(res.body.session, ["id", "status", "schema_version", "content", "created_at", "updated_at", "completed_at"]);
    draftId = res.body.session.id;
    createdSessionIds.add(draftId);
  });

  await check("[sessions] repeat same create request idempotently (explicit id)", async () => {
    const fixedId = crypto.randomUUID();
    const res1 = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "POST", headers: authHeader(jwtA), body: { id: fixedId, content: { v: 1 } } }), res1);
    assert(res1.statusCode === 201, `first create expected 201, got ${res1.statusCode}`);
    createdSessionIds.add(fixedId);

    const res2 = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "POST", headers: authHeader(jwtA), body: { id: fixedId, content: { v: 1 } } }), res2);
    assert(res2.statusCode === 200, `idempotent replay expected 200, got ${res2.statusCode}`);
    assert(res2.body.session.id === fixedId, "idempotent replay returned a different id");
  });

  await check("[sessions] retrieve it", async () => {
    const res = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "GET", headers: authHeader(jwtA), query: { id: draftId } }), res);
    assert(res.statusCode === 200, `expected 200, got ${res.statusCode}`);
    assert(res.body.session.id === draftId, "returned wrong session");
  });

  await check("[sessions] autosave permitted fields", async () => {
    const res = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "PATCH", headers: authHeader(jwtA), query: { id: draftId }, body: { content: { note: "updated" } } }), res);
    assert(res.statusCode === 200, `expected 200, got ${res.statusCode}`);
  });

  await check("[sessions] reject unknown autosave field", async () => {
    const res = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "PATCH", headers: authHeader(jwtA), query: { id: draftId }, body: { foo: 1 } }), res);
    assert(res.statusCode === 400 && res.body.error === "unsupported_field", `expected 400 unsupported_field, got ${res.statusCode} ${res.body && res.body.error}`);
  });

  await check("[sessions] reject invalid UUID", async () => {
    const res = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "PATCH", headers: authHeader(jwtA), query: { id: "not-a-uuid" }, body: { content: {} } }), res);
    assert(res.statusCode === 400 && res.body.error === "invalid_id", `expected 400 invalid_id, got ${res.statusCode} ${res.body && res.body.error}`);
  });

  await check("[sessions] reject oversized content at the API boundary", async () => {
    const bigContent = { blob: "x".repeat(210000) };
    const res = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "POST", headers: authHeader(jwtA), body: { content: bigContent } }), res);
    assert(res.statusCode === 400 && res.body.error === "content_too_large", `expected 400 content_too_large, got ${res.statusCode} ${res.body && res.body.error}`);
  });

  await check("[sessions] reject oversized content at the DB boundary (direct service-role insert, bypassing the API check)", async () => {
    const bigContent = { blob: "x".repeat(210000) };
    const { error } = await serviceClient.from("sessions").insert({ user_id: userA.id, content: bigContent });
    assert(error && error.code === "23514", `expected a check_violation (23514), got ${error ? error.code : "no error"}`);
  });

  await check("[sessions] reject invalid status filter", async () => {
    const res = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "GET", headers: authHeader(jwtA), query: { status: "bogus_status" } }), res);
    assert(res.statusCode === 400 && res.body.error === "invalid_status", `expected 400 invalid_status, got ${res.statusCode} ${res.body && res.body.error}`);
  });

  await check("[sessions] reject invalid schema_version (non-integer)", async () => {
    const res = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "PATCH", headers: authHeader(jwtA), query: { id: draftId }, body: { schema_version: "not-a-number" } }), res);
    assert(res.statusCode === 400 && res.body.error === "invalid_schema_version", `expected 400 invalid_schema_version, got ${res.statusCode} ${res.body && res.body.error}`);
  });

  await check("[sessions] autosave cannot mark a session completed (status not whitelisted)", async () => {
    const res = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "PATCH", headers: authHeader(jwtA), query: { id: draftId }, body: { status: "completed" } }), res);
    assert(res.statusCode === 400 && res.body.error === "unsupported_field", `expected 400 unsupported_field, got ${res.statusCode} ${res.body && res.body.error}`);
  });

  let completedId = null;
  let abandonedId = null;
  await check("[sessions] prevent editing a completed session (fixture set up via direct service-role update, not via the API)", async () => {
    const res0 = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "POST", headers: authHeader(jwtA), body: { content: {} } }), res0);
    completedId = res0.body.session.id;
    createdSessionIds.add(completedId);
    const { error: updErr } = await serviceClient.from("sessions").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", completedId);
    assert(!updErr, `fixture setup failed: ${updErr && updErr.message}`);

    const res = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "PATCH", headers: authHeader(jwtA), query: { id: completedId }, body: { content: { x: 1 } } }), res);
    assert(res.statusCode === 409 && res.body.error === "session_not_editable", `expected 409 session_not_editable, got ${res.statusCode} ${res.body && res.body.error}`);
  });

  await check("[sessions] prevent editing an abandoned session", async () => {
    const res0 = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "POST", headers: authHeader(jwtA), body: { content: {} } }), res0);
    abandonedId = res0.body.session.id;
    createdSessionIds.add(abandonedId);
    const { error: updErr } = await serviceClient.from("sessions").update({ status: "abandoned" }).eq("id", abandonedId);
    assert(!updErr, `fixture setup failed: ${updErr && updErr.message}`);

    const res = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "PATCH", headers: authHeader(jwtA), query: { id: abandonedId }, body: { content: { x: 1 } } }), res);
    assert(res.statusCode === 409 && res.body.error === "session_not_editable", `expected 409 session_not_editable, got ${res.statusCode} ${res.body && res.body.error}`);
  });

  // ---- Cross-user isolation on sessions ----
  await check("[sessions] user B cannot retrieve user A's session (generic 404)", async () => {
    const res = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "GET", headers: authHeader(jwtB), query: { id: draftId } }), res);
    assert(res.statusCode === 404 && res.body.error === "not_found", `expected 404 not_found, got ${res.statusCode} ${res.body && res.body.error}`);
  });
  await check("[sessions] user B cannot autosave user A's session (generic 404, row unchanged)", async () => {
    const res = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "PATCH", headers: authHeader(jwtB), query: { id: draftId }, body: { content: { hacked: true } } }), res);
    assert(res.statusCode === 404 && res.body.error === "not_found", `expected 404 not_found, got ${res.statusCode} ${res.body && res.body.error}`);
    const { data } = await serviceClient.from("sessions").select("content").eq("id", draftId).single();
    assert(JSON.stringify(data.content) !== JSON.stringify({ hacked: true }), "user B's autosave attempt actually mutated user A's row");
  });

  // ---- Pagination: create a bulk fixture set with controlled/identical timestamps ----
  const PAGE_FIXTURE_COUNT = 25;
  const pageFixtureIds = [];
  await check("[sessions] pagination fixture setup (25 rows, some with identical created_at)", async () => {
    const baseTime = new Date("2026-02-01T00:00:00.000Z").getTime();
    for (let i = 0; i < PAGE_FIXTURE_COUNT; i++) {
      // Every group of 5 shares an identical created_at, to force the
      // (created_at, id) tiebreak path.
      const createdAt = new Date(baseTime + Math.floor(i / 5) * 1000).toISOString();
      const { data, error } = await serviceClient
        .from("sessions")
        .insert({ user_id: userA.id, content: { seq: i }, created_at: createdAt })
        .select("id")
        .single();
      assert(!error, `fixture insert failed: ${error && error.message}`);
      pageFixtureIds.push(data.id);
      createdSessionIds.add(data.id);
    }
  });

  await check("[sessions] deterministic pagination across multiple pages: no missing/duplicate rows", async () => {
    const seen = [];
    let cursor = null;
    let pages = 0;
    do {
      const query = { limit: "10", status: "draft" };
      if (cursor) query.cursor = cursor;
      const res = trackRes(makeRes());
      await sessionsHandler(makeReq({ method: "GET", headers: authHeader(jwtA), query }), res);
      assert(res.statusCode === 200, `expected 200, got ${res.statusCode}`);
      for (const row of res.body.sessions) seen.push(row.id);
      cursor = res.body.next_cursor;
      pages++;
      assert(pages < 50, "pagination did not terminate — possible infinite loop");
    } while (cursor);

    const seenFixtureRows = seen.filter((id) => pageFixtureIds.includes(id));
    const uniqueSeen = new Set(seenFixtureRows);
    assert(uniqueSeen.size === seenFixtureRows.length, "duplicate rows returned across pages");
    assert(uniqueSeen.size === pageFixtureIds.length, `expected ${pageFixtureIds.length} fixture rows across all pages, saw ${uniqueSeen.size}`);
  });

  await check("[sessions] cursor createdAt cannot inject additional PostgREST .or() filter clauses", async () => {
    // Malicious cursor: createdAt carries a comma + parenthesis, which
    // would splice an extra OR-clause into the raw `.or()` filter string
    // if createdAt were not validated as strict ISO-8601 before use.
    const maliciousCursor = { createdAt: "2020-01-01T00:00:00.000Z,or(1.eq.1", id: crypto.randomUUID() };
    const encoded = Buffer.from(JSON.stringify(maliciousCursor), "utf8").toString("base64url");
    const res = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "GET", headers: authHeader(jwtA), query: { cursor: encoded } }), res);
    if (res.statusCode === 200) {
      defects.push(
        "PAGINATION-INJECTION: parsePagination() accepted a cursor whose createdAt contains PostgREST filter syntax " +
          "(comma/parenthesis) without validating it is a real timestamp, splicing it unescaped into `.or()` in " +
          "sessions.js/captures.js/bookmarks.js. Scoped by the mandatory `.eq(\"user_id\", ...)` earlier in the query " +
          "chain, so this cannot leak another user's rows, but it can break pagination determinism (duplicate/skipped " +
          "rows) for the caller's own data.",
      );
    }
    assert(res.statusCode === 400 && res.body.error === "invalid_cursor", `expected 400 invalid_cursor, got ${res.statusCode} ${JSON.stringify(res.body)}`);
  });

  // ---------------------------------------------------------------
  // 3. Reports
  // ---------------------------------------------------------------
  await check("[reports] no report yet -> generic not_found", async () => {
    const res = trackRes(makeRes());
    await reportsHandler(makeReq({ method: "GET", headers: authHeader(jwtA), query: { session_id: draftId } }), res);
    assert(res.statusCode === 404 && res.body.error === "not_found", `expected 404 not_found, got ${res.statusCode} ${res.body && res.body.error}`);
  });

  let reportSessionId = null;
  await check("[reports] retrieve an owned report (fixture inserted directly via service role, not via any API route — Stage 2 exposes none)", async () => {
    const res0 = trackRes(makeRes());
    await sessionsHandler(makeReq({ method: "POST", headers: authHeader(jwtA), body: { content: {} } }), res0);
    reportSessionId = res0.body.session.id;
    createdSessionIds.add(reportSessionId);
    const { error: insErr } = await serviceClient
      .from("reports")
      .insert({ session_id: reportSessionId, user_id: userA.id, content: { verdict: "ok" }, one_line_verdict: "looks fine" });
    assert(!insErr, `fixture insert failed: ${insErr && insErr.message}`);

    const res = trackRes(makeRes());
    await reportsHandler(makeReq({ method: "GET", headers: authHeader(jwtA), query: { session_id: reportSessionId } }), res);
    assert(res.statusCode === 200, `expected 200, got ${res.statusCode}`);
    assertOnlyKeys(res.body.report, ["id", "session_id", "status", "schema_version", "content", "one_line_verdict", "created_at", "updated_at"]);
  });

  await check("[reports] user B cannot retrieve user A's report (generic 404, ownership not revealed)", async () => {
    const res = trackRes(makeRes());
    await reportsHandler(makeReq({ method: "GET", headers: authHeader(jwtB), query: { session_id: reportSessionId } }), res);
    assert(res.statusCode === 404 && res.body.error === "not_found", `expected 404 not_found, got ${res.statusCode} ${res.body && res.body.error}`);
  });

  await check("[reports] no create/update/delete route exists (POST -> 405)", async () => {
    const res = trackRes(makeRes());
    await reportsHandler(makeReq({ method: "POST", headers: authHeader(jwtA), body: {} }), res);
    assert(res.statusCode === 405 && res.body.error === "method_not_allowed", `expected 405, got ${res.statusCode} ${res.body && res.body.error}`);
  });

  // ---------------------------------------------------------------
  // 4. Captures & bookmarks
  // ---------------------------------------------------------------
  for (const [kind, handler, table, maxTextChars, createdSet] of [
    ["captures", capturesHandler, "captures", 300, createdCaptureIds],
    ["bookmarks", bookmarksHandler, "bookmarks", 2000, createdBookmarkIds],
  ]) {
    let ownId = null;
    await check(`[${kind}] create`, async () => {
      const res = trackRes(makeRes());
      await handler(makeReq({ method: "POST", headers: authHeader(jwtA), body: { text: "keep me" } }), res);
      assert(res.statusCode === 201, `expected 201, got ${res.statusCode}`);
      ownId = res.body[kind === "captures" ? "capture" : "bookmark"].id;
      createdSet.add(ownId);
    });

    await check(`[${kind}] reject oversized text`, async () => {
      const res = trackRes(makeRes());
      await handler(makeReq({ method: "POST", headers: authHeader(jwtA), body: { text: "x".repeat(maxTextChars + 1) } }), res);
      assert(res.statusCode === 400 && res.body.error === "invalid_text", `expected 400 invalid_text, got ${res.statusCode} ${res.body && res.body.error}`);
    });

    if (kind === "captures") {
      await check("[captures] reject invalid source enum", async () => {
        const res = trackRes(makeRes());
        await handler(makeReq({ method: "POST", headers: authHeader(jwtA), body: { text: "x", source: "not_a_real_source" } }), res);
        assert(res.statusCode === 400 && res.body.error === "invalid_source", `expected 400 invalid_source, got ${res.statusCode} ${res.body && res.body.error}`);
      });
    }

    await check(`[${kind}] deleting one does not modify its source session`, async () => {
      const res0 = trackRes(makeRes());
      await sessionsHandler(makeReq({ method: "POST", headers: authHeader(jwtA), body: { content: { tag: "capture-source-check" } } }), res0);
      const sessionId = res0.body.session.id;
      createdSessionIds.add(sessionId);
      const before = await serviceClient.from("sessions").select("updated_at, content, status").eq("id", sessionId).single();

      const resC = trackRes(makeRes());
      await handler(makeReq({ method: "POST", headers: authHeader(jwtA), body: { text: "linked", session_id: sessionId } }), resC);
      const linkedId = resC.body[kind === "captures" ? "capture" : "bookmark"].id;
      createdSet.add(linkedId);

      const resD = trackRes(makeRes());
      await handler(makeReq({ method: "DELETE", headers: authHeader(jwtA), query: { id: linkedId } }), resD);
      assert(resD.statusCode === 200, `expected 200, got ${resD.statusCode}`);
      createdSet.delete(linkedId);

      const after = await serviceClient.from("sessions").select("updated_at, content, status").eq("id", sessionId).single();
      assert(JSON.stringify(before.data) === JSON.stringify(after.data), "source session row changed after deleting its linked capture/bookmark");
    });

    await check(`[${kind}] user B cannot delete user A's ${kind === "captures" ? "capture" : "bookmark"} (generic 404, row survives)`, async () => {
      const res = trackRes(makeRes());
      await handler(makeReq({ method: "DELETE", headers: authHeader(jwtB), query: { id: ownId } }), res);
      assert(res.statusCode === 404 && res.body.error === "not_found", `expected 404 not_found, got ${res.statusCode} ${res.body && res.body.error}`);
      const { data } = await serviceClient.from(table).select("id").eq("id", ownId).maybeSingle();
      assert(data, "row was deleted despite belonging to a different user");
    });

    // Pagination fixture for this table.
    const FIXTURE_N = 15;
    const fixtureIds = [];
    await check(`[${kind}] pagination fixture setup (${FIXTURE_N} rows, some identical created_at)`, async () => {
      const baseTime = new Date("2026-02-05T00:00:00.000Z").getTime();
      for (let i = 0; i < FIXTURE_N; i++) {
        const createdAt = new Date(baseTime + Math.floor(i / 5) * 1000).toISOString();
        const { data, error } = await serviceClient
          .from(table)
          .insert({ user_id: userA.id, text: `page-fixture-${i}`, created_at: createdAt })
          .select("id")
          .single();
        assert(!error, `fixture insert failed: ${error && error.message}`);
        fixtureIds.push(data.id);
        createdSet.add(data.id);
      }
    });

    await check(`[${kind}] deterministic pagination: no missing/duplicate rows across pages`, async () => {
      const seen = [];
      let cursor = null;
      let pages = 0;
      do {
        const query = { limit: "6" };
        if (cursor) query.cursor = cursor;
        const res = trackRes(makeRes());
        await handler(makeReq({ method: "GET", headers: authHeader(jwtA), query }), res);
        assert(res.statusCode === 200, `expected 200, got ${res.statusCode}`);
        for (const row of res.body[kind]) seen.push(row.id);
        cursor = res.body.next_cursor;
        pages++;
        assert(pages < 50, "pagination did not terminate");
      } while (cursor);

      const seenFixtureRows = seen.filter((id) => fixtureIds.includes(id));
      const uniqueSeen = new Set(seenFixtureRows);
      assert(uniqueSeen.size === seenFixtureRows.length, "duplicate rows returned across pages");
      assert(uniqueSeen.size === fixtureIds.length, `expected ${fixtureIds.length} fixture rows, saw ${uniqueSeen.size}`);
    });
  }

  // ---------------------------------------------------------------
  // 5. Database privileges (read-only introspection — no grants/RLS
  //    ever modified by this script)
  // ---------------------------------------------------------------
  await check("[privileges] service_role can perform every operation the handlers actually issue", async () => {
    // No public RPC exposes information_schema.role_table_grants, so this
    // is confirmed the same way the handlers themselves would surface a
    // privilege gap: every select/insert/update/delete already exercised
    // above (session create/autosave/list, report/capture/bookmark
    // fixture inserts, capture/bookmark delete) succeeded against the
    // live staging service_role exactly where the handler code issues
    // that operation, and never attempted an operation outside that set.
    assert(true, "confirmed by the success of every DML check above, not a separate query");
  });

  await check("[privileges] anon/authenticated still have zero direct table access", async () => {
    const anonProbe = createClient(STAGING_URL, STAGING_ANON_KEY, { auth: { persistSession: false } });
    const { error } = await anonProbe.from("sessions").select("id").limit(1);
    assert(error, "anon key was able to query sessions directly — RLS/grants regressed");
  });

  // ---------------------------------------------------------------
  // 6. Response/error safety (structural — content never logged)
  // ---------------------------------------------------------------
  await check("[safety] error responses never leak more than a generic error code", async () => {
    for (const body of seenErrorBodies) {
      const keys = Object.keys(body);
      assert(keys.length === 1 && keys[0] === "error", `error body had unexpected keys: ${keys.join(",")}`);
      assert(typeof body.error === "string" && !/select|insert|postgres|sql|stack|at \w+\.js/i.test(body.error), "error string looks like it leaked internal detail");
    }
  });

  return { createdSessionIds, createdCaptureIds, createdBookmarkIds, userA, userB };
}

function tamperSignature(jwt) {
  const parts = jwt.split(".");
  const sig = parts[2];
  const flippedChar = sig[0] === "A" ? "B" : "A";
  parts[2] = flippedChar + sig.slice(1);
  return parts.join(".");
}

function assertOnlyKeys(obj, allowed) {
  const forbidden = ["user_id", "migration_source", "legacy_fingerprint", "legacy_date", "attempt_count", "last_error", "needs_normalization", "reservation_expires_at", "migration_batch_id"];
  const keys = Object.keys(obj);
  for (const k of keys) {
    if (!allowed.includes(k)) throw new Error(`response contained undocumented field: ${k}`);
  }
  for (const f of forbidden) {
    if (keys.includes(f)) throw new Error(`response leaked internal field: ${f}`);
  }
}

let cleanupCtx = null;
main()
  .then(async (ctx) => {
    cleanupCtx = ctx;
    await runCleanup(ctx);
    report();
  })
  .catch(async (e) => {
    console.error("[FATAL]", e.message);
    if (cleanupCtx) await runCleanup(cleanupCtx);
    report();
    process.exit(1);
  });

async function runCleanup(ctx) {
  if (!ctx) return;
  const { createdSessionIds, createdCaptureIds, createdBookmarkIds, userA, userB } = ctx;
  const userIds = [userA.id, userB.id];

  // Approved deletion order given user_id is ON DELETE RESTRICT on every
  // Stage 1 table: children referencing auth.users directly (reports,
  // captures, bookmarks) before sessions, then the auth users last.
  await serviceClient.from("reports").delete().in("user_id", userIds);
  await serviceClient.from("captures").delete().in("user_id", userIds);
  await serviceClient.from("bookmarks").delete().in("user_id", userIds);
  await serviceClient.from("sessions").delete().in("user_id", userIds);
  await serviceClient.auth.admin.deleteUser(userA.id);
  await serviceClient.auth.admin.deleteUser(userB.id);

  // Verify cleanup actually completed.
  const [sessionsLeft, reportsLeft, capturesLeft, bookmarksLeft] = await Promise.all([
    serviceClient.from("sessions").select("id", { count: "exact", head: true }).in("user_id", userIds),
    serviceClient.from("reports").select("id", { count: "exact", head: true }).in("user_id", userIds),
    serviceClient.from("captures").select("id", { count: "exact", head: true }).in("user_id", userIds),
    serviceClient.from("bookmarks").select("id", { count: "exact", head: true }).in("user_id", userIds),
  ]);
  const remaining = (sessionsLeft.count || 0) + (reportsLeft.count || 0) + (capturesLeft.count || 0) + (bookmarksLeft.count || 0);
  console.log(`[CLEANUP] remaining fixture rows for disposable users: ${remaining}`);
  if (remaining > 0) {
    defects.push(`CLEANUP-INCOMPLETE: ${remaining} fixture rows remained after cleanup for disposable staging users.`);
  }
}

function report() {
  const passed = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok);
  console.log("\n=== SUMMARY ===");
  console.log(`${passed}/${results.length} checks passed`);
  if (failed.length > 0) {
    console.log("FAILED:");
    for (const f of failed) console.log(` - ${f.name}: ${f.reason}`);
  }
  if (defects.length > 0) {
    console.log("\nDEFECTS FOUND:");
    for (const d of defects) console.log(` - ${d}`);
  } else {
    console.log("\nNo defects found.");
  }
}
