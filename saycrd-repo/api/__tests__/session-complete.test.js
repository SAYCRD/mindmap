import test from "node:test";
import assert from "node:assert/strict";
import { createSessionCompleteHandler } from "../session-complete.js";
import { createMockSupabase, authedAs, unauthenticatedGetAuthedUser } from "./_mock-supabase.js";
import { makeReq, makeRes } from "./_http.js";

const USER_A = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const USER_B = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };
const SESSION_ID = "11111111-1111-1111-1111-111111111111";

function handlerFor(sb, user) {
  return createSessionCompleteHandler({ getAuthedUser: authedAs(user), getServiceClient: () => sb });
}

function draftSessionFixture(overrides) {
  return Object.assign(
    {
      id: SESSION_ID,
      user_id: USER_A.id,
      status: "draft",
      schema_version: 1,
      content: { rawText: "hi" },
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
      completed_at: null,
    },
    overrides || {}
  );
}

test("session-complete: rejects an unauthenticated caller with 401", async () => {
  const sb = createMockSupabase();
  const handler = createSessionCompleteHandler({ getAuthedUser: unauthenticatedGetAuthedUser, getServiceClient: () => sb });
  const res = makeRes();
  await handler(makeReq({ method: "POST", body: { session_id: SESSION_ID } }), res);
  assert.equal(res.statusCode, 401);
});

test("session-complete: rejects an unsupported method with 405", async () => {
  const sb = createMockSupabase();
  const handler = handlerFor(sb, USER_A);
  const res = makeRes();
  await handler(makeReq({ method: "GET" }), res);
  assert.equal(res.statusCode, 405);
});

test("session-complete: rejects a payload with an unsupported field", async () => {
  const sb = createMockSupabase({ sessions: [draftSessionFixture()] });
  const handler = handlerFor(sb, USER_A);
  const res = makeRes();
  await handler(makeReq({ method: "POST", body: { session_id: SESSION_ID, status: "completed" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "unsupported_field");
});

test("session-complete: rejects an invalid session id", async () => {
  const sb = createMockSupabase();
  const handler = handlerFor(sb, USER_A);
  const res = makeRes();
  await handler(makeReq({ method: "POST", body: { session_id: "not-a-uuid" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_session_id");
});

test("session-complete: not found or not owned returns identical generic 404", async () => {
  const sb = createMockSupabase({ sessions: [draftSessionFixture({ user_id: USER_B.id })] });
  const handler = handlerFor(sb, USER_A);
  const res = makeRes();
  await handler(makeReq({ method: "POST", body: { session_id: SESSION_ID } }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.error, "not_found");
});

test("session-complete: completes a draft session and creates its report in one call", async () => {
  const sb = createMockSupabase({ sessions: [draftSessionFixture()] });
  const handler = handlerFor(sb, USER_A);
  const res = makeRes();
  await handler(
    makeReq({
      method: "POST",
      body: {
        session_id: SESSION_ID,
        session_content: { rawText: "hi", themes: [{ label: "growth" }] },
        report_content: { sections: [{ title: "Overview" }] },
        one_line_verdict: "You're growing.",
      },
    }),
    res
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.session.status, "completed");
  assert.ok(res.body.session.completed_at);
  assert.deepEqual(res.body.session.content, { rawText: "hi", themes: [{ label: "growth" }] });
  assert.equal(res.body.report.status, "complete");
  assert.equal(res.body.report.one_line_verdict, "You're growing.");
  assert.equal(sb._state.reports.filter((r) => r.session_id === SESSION_ID).length, 1, "exactly one report row");
});

test("session-complete: retrying the same session_id after completion is idempotent, not an error, and applies no further writes", async () => {
  const sb = createMockSupabase({ sessions: [draftSessionFixture()] });
  const handler = handlerFor(sb, USER_A);

  const res1 = makeRes();
  await handler(
    makeReq({ method: "POST", body: { session_id: SESSION_ID, session_content: { a: 1 }, report_content: { verdict: "first" } } }),
    res1
  );
  assert.equal(res1.statusCode, 200);

  const res2 = makeRes();
  await handler(
    makeReq({ method: "POST", body: { session_id: SESSION_ID, session_content: { a: 2 }, report_content: { verdict: "second" } } }),
    res2
  );
  assert.equal(res2.statusCode, 200);
  // The idempotent replay never re-applies the retry's (different) content.
  assert.deepEqual(res2.body.session.content, { a: 1 });
  assert.deepEqual(res2.body.report.content, { verdict: "first" });

  assert.equal(sb._state.sessions.filter((r) => r.id === SESSION_ID).length, 1, "must not duplicate the session row");
  assert.equal(sb._state.reports.filter((r) => r.session_id === SESSION_ID).length, 1, "must not duplicate the report row");
});

test("session-complete: a session that is already failed/abandoned cannot be completed", async () => {
  const sb = createMockSupabase({ sessions: [draftSessionFixture({ status: "abandoned" })] });
  const handler = handlerFor(sb, USER_A);
  const res = makeRes();
  await handler(makeReq({ method: "POST", body: { session_id: SESSION_ID, session_content: {}, report_content: {} } }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "session_not_editable");
});

test("session-complete: rejects oversized session or report content", async () => {
  const sb = createMockSupabase({ sessions: [draftSessionFixture()] });
  const handler = handlerFor(sb, USER_A);
  const res = makeRes();
  await handler(
    makeReq({ method: "POST", body: { session_id: SESSION_ID, session_content: {}, report_content: { blob: "x".repeat(300000) } } }),
    res
  );
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "content_too_large");
});

test("session-complete: a second real user can never complete or read another user's session", async () => {
  const sb = createMockSupabase({ sessions: [draftSessionFixture()] });
  const handler = handlerFor(sb, USER_B);
  const res = makeRes();
  await handler(makeReq({ method: "POST", body: { session_id: SESSION_ID, session_content: {}, report_content: {} } }), res);
  assert.equal(res.statusCode, 404);
  assert.equal(sb._state.sessions.find((s) => s.id === SESSION_ID).status, "draft", "must not have been mutated");
});
