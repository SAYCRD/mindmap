import test from "node:test";
import assert from "node:assert/strict";
import { createReportsHandler } from "../reports.js";
import { createMockSupabase, authedAs, unauthenticatedGetAuthedUser } from "./_mock-supabase.js";
import { makeReq, makeRes } from "./_http.js";

const USER_A = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const USER_B = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };
const SESSION_ID = "11111111-1111-1111-1111-111111111111";

function baseFixtures() {
  return {
    sessions: [
      {
        id: SESSION_ID,
        user_id: USER_A.id,
        status: "completed",
        schema_version: 1,
        content: {},
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        completed_at: "2026-01-01T00:10:00.000Z",
      },
    ],
    reports: [
      {
        id: "22222222-2222-2222-2222-222222222222",
        session_id: SESSION_ID,
        user_id: USER_A.id,
        status: "complete",
        schema_version: 1,
        content: { oneLineVerdict: "ok" },
        one_line_verdict: "ok",
        migration_source: null,
        needs_normalization: false,
        attempt_count: 1,
        last_error: null,
        created_at: "2026-01-01T00:10:00.000Z",
        updated_at: "2026-01-01T00:10:00.000Z",
      },
    ],
  };
}

function handlerFor(sb, user) {
  return createReportsHandler({ getAuthedUser: authedAs(user), getServiceClient: () => sb });
}

test("reports: rejects an unauthenticated caller with 401", async () => {
  const sb = createMockSupabase(baseFixtures());
  const handler = createReportsHandler({ getAuthedUser: unauthenticatedGetAuthedUser, getServiceClient: () => sb });
  const res = makeRes();
  await handler(makeReq({ method: "GET", query: { session_id: SESSION_ID } }), res);
  assert.equal(res.statusCode, 401);
});

test("reports: rejects a non-GET method with 405", async () => {
  const sb = createMockSupabase(baseFixtures());
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "POST", query: { session_id: SESSION_ID } }), res);
  assert.equal(res.statusCode, 405);
});

test("reports: rejects a malformed session_id with 400", async () => {
  const sb = createMockSupabase(baseFixtures());
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "GET", query: { session_id: "not-a-uuid" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_session_id");
});

test("reports: 404s when the session belongs to another user, never revealing it exists", async () => {
  const sb = createMockSupabase(baseFixtures());
  const res = makeRes();
  await handlerFor(sb, USER_B)(makeReq({ method: "GET", query: { session_id: SESSION_ID } }), res);
  assert.equal(res.statusCode, 404);
});

test("reports: 404s when the owned session has no report yet", async () => {
  const fixtures = baseFixtures();
  fixtures.reports = [];
  const sb = createMockSupabase(fixtures);
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "GET", query: { session_id: SESSION_ID } }), res);
  assert.equal(res.statusCode, 404);
});

test("reports: returns the report for an owned session with only minimal public fields", async () => {
  const sb = createMockSupabase(baseFixtures());
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "GET", query: { session_id: SESSION_ID } }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.report.session_id, SESSION_ID);
  assert.equal(res.body.report.one_line_verdict, "ok");
  for (const internalField of ["user_id", "migration_source", "needs_normalization", "attempt_count", "last_error"]) {
    assert.equal(res.body.report[internalField], undefined, `${internalField} must never be returned to the client`);
  }
});
