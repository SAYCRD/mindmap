import test from "node:test";
import assert from "node:assert/strict";
import { createCapturesHandler } from "../captures.js";
import { createMockSupabase, authedAs, unauthenticatedGetAuthedUser } from "./_mock-supabase.js";
import { makeReq, makeRes } from "./_http.js";

const USER_A = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const USER_B = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };

function handlerFor(sb, user) {
  return createCapturesHandler({ getAuthedUser: authedAs(user), getServiceClient: () => sb });
}

test("captures: rejects an unauthenticated caller with 401", async () => {
  const sb = createMockSupabase();
  const handler = createCapturesHandler({ getAuthedUser: unauthenticatedGetAuthedUser, getServiceClient: () => sb });
  const res = makeRes();
  await handler(makeReq({ method: "GET" }), res);
  assert.equal(res.statusCode, 401);
});

test("captures: rejects an unsupported method with 405", async () => {
  const sb = createMockSupabase();
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "PATCH" }), res);
  assert.equal(res.statusCode, 405);
});

test("captures: POST creates a capture with default source when text is valid", async () => {
  const sb = createMockSupabase();
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "POST", body: { text: "a nice line" } }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.capture.text, "a nice line");
  assert.equal(res.body.capture.source, "report");
  assert.equal(res.body.capture.user_id, undefined);
});

test("captures: POST rejects text over the 300 char cap", async () => {
  const sb = createMockSupabase();
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "POST", body: { text: "x".repeat(301) } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_text");
});

test("captures: POST rejects an unsupported field", async () => {
  const sb = createMockSupabase();
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "POST", body: { text: "ok", user_id: USER_B.id } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "unsupported_field");
});

test("captures: POST rejects a session_id owned by another user, never revealing it exists", async () => {
  const sessionId = "11111111-1111-1111-1111-111111111111";
  const sb = createMockSupabase({
    sessions: [
      {
        id: sessionId,
        user_id: USER_B.id,
        status: "draft",
        schema_version: 1,
        content: {},
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        completed_at: null,
      },
    ],
  });
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "POST", body: { text: "ok", session_id: sessionId } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_session_id");
});

const CAPTURE_1 = "d1d1d1d1-d1d1-d1d1-d1d1-d1d1d1d1d1d1";
const CAPTURE_2 = "d2d2d2d2-d2d2-d2d2-d2d2-d2d2d2d2d2d2";

test("captures: GET list only returns the caller's own captures", async () => {
  const sb = createMockSupabase({
    captures: [
      { id: CAPTURE_1, user_id: USER_A.id, session_id: null, text: "mine", note: null, source: "report", created_at: "2026-01-02T00:00:00.000Z" },
      { id: CAPTURE_2, user_id: USER_B.id, session_id: null, text: "not mine", note: null, source: "report", created_at: "2026-01-02T00:00:00.000Z" },
    ],
  });
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "GET", query: {} }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.captures.length, 1);
  assert.equal(res.body.captures[0].id, CAPTURE_1);
});

test("captures: DELETE removes an owned capture and returns 404 for someone else's", async () => {
  const sb = createMockSupabase({
    captures: [
      { id: CAPTURE_1, user_id: USER_A.id, session_id: null, text: "mine", note: null, source: "report", created_at: "2026-01-02T00:00:00.000Z" },
      { id: CAPTURE_2, user_id: USER_B.id, session_id: null, text: "not mine", note: null, source: "report", created_at: "2026-01-02T00:00:00.000Z" },
    ],
  });

  const forbiddenRes = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "DELETE", query: { id: CAPTURE_2 } }), forbiddenRes);
  assert.equal(forbiddenRes.statusCode, 404);
  assert.equal(sb._state.captures.length, 2, "another user's capture must survive an attempted delete");

  const okRes = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "DELETE", query: { id: CAPTURE_1 } }), okRes);
  assert.equal(okRes.statusCode, 200);
  assert.equal(sb._state.captures.length, 1);
  assert.equal(sb._state.captures[0].id, CAPTURE_2);
});

test("captures: DELETE rejects a malformed id with 400", async () => {
  const sb = createMockSupabase();
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "DELETE", query: { id: "not-a-uuid" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_id");
});
