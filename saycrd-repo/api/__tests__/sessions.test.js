import test from "node:test";
import assert from "node:assert/strict";
import { createSessionsHandler } from "../sessions.js";
import { createMockSupabase, authedAs, unauthenticatedGetAuthedUser } from "./_mock-supabase.js";
import { makeReq, makeRes } from "./_http.js";

const USER_A = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const USER_B = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };

function handlerFor(sb, user) {
  return createSessionsHandler({ getAuthedUser: authedAs(user), getServiceClient: () => sb });
}

test("sessions: rejects an unauthenticated caller with 401", async () => {
  const sb = createMockSupabase();
  const handler = createSessionsHandler({ getAuthedUser: unauthenticatedGetAuthedUser, getServiceClient: () => sb });
  const res = makeRes();
  await handler(makeReq({ method: "GET" }), res);
  assert.equal(res.statusCode, 401);
  assert.equal(res.body.error, "authentication_required");
});

test("sessions: rejects an unsupported method with 405", async () => {
  const sb = createMockSupabase();
  const handler = handlerFor(sb, USER_A);
  const res = makeRes();
  await handler(makeReq({ method: "DELETE" }), res);
  assert.equal(res.statusCode, 405);
});

test("sessions: POST creates a draft session with a server-generated id when none is supplied", async () => {
  const sb = createMockSupabase();
  const handler = handlerFor(sb, USER_A);
  const res = makeRes();
  await handler(makeReq({ method: "POST", body: { content: { rawText: "hi" } } }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.session.status, "draft");
  assert.deepEqual(res.body.session.content, { rawText: "hi" });
  assert.equal(res.body.session.user_id, undefined, "user_id must never be returned to the client");
});

test("sessions: POST accepts a client-supplied UUID as the session id", async () => {
  const sb = createMockSupabase();
  const handler = handlerFor(sb, USER_A);
  const id = "11111111-1111-1111-1111-111111111111";
  const res = makeRes();
  await handler(makeReq({ method: "POST", body: { id, content: {} } }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.session.id, id);
});

test("sessions: POST rejects a payload with an unsupported field like status or user_id", async () => {
  const sb = createMockSupabase();
  const handler = handlerFor(sb, USER_A);
  const res1 = makeRes();
  await handler(makeReq({ method: "POST", body: { content: {}, status: "completed" } }), res1);
  assert.equal(res1.statusCode, 400);
  assert.equal(res1.body.error, "unsupported_field");

  const res2 = makeRes();
  await handler(makeReq({ method: "POST", body: { content: {}, user_id: USER_B.id } }), res2);
  assert.equal(res2.statusCode, 400);
  assert.equal(res2.body.error, "unsupported_field");
});

test("sessions: POST rejects oversized content", async () => {
  const sb = createMockSupabase();
  const handler = handlerFor(sb, USER_A);
  const res = makeRes();
  await handler(makeReq({ method: "POST", body: { content: { blob: "x".repeat(300000) } } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "content_too_large");
});

test("sessions: POST with the same owned draft id twice is idempotent, not a duplicate", async () => {
  const sb = createMockSupabase();
  const handler = handlerFor(sb, USER_A);
  const id = "22222222-2222-2222-2222-222222222222";

  const res1 = makeRes();
  await handler(makeReq({ method: "POST", body: { id, content: { a: 1 } } }), res1);
  assert.equal(res1.statusCode, 201);

  const res2 = makeRes();
  await handler(makeReq({ method: "POST", body: { id, content: { a: 2 } } }), res2);
  assert.equal(res2.statusCode, 200);
  // The retry never overwrites content — create is not the autosave path.
  assert.deepEqual(res2.body.session.content, { a: 1 });

  assert.equal(sb._state.sessions.filter((r) => r.id === id).length, 1, "must not create a duplicate row");
});

test("sessions: POST with an id already owned by another user returns a generic conflict", async () => {
  const sb = createMockSupabase();
  const id = "33333333-3333-3333-3333-333333333333";
  await handlerFor(sb, USER_B)(makeReq({ method: "POST", body: { id, content: {} } }), makeRes());

  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "POST", body: { id, content: {} } }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "conflict");
});

test("sessions: POST with an id that exists but is no longer draft returns session_not_draft", async () => {
  const sb = createMockSupabase({
    sessions: [
      {
        id: "44444444-4444-4444-4444-444444444444",
        user_id: USER_A.id,
        status: "completed",
        schema_version: 1,
        content: {},
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        completed_at: "2026-01-01T00:05:00.000Z",
      },
    ],
  });
  const handler = handlerFor(sb, USER_A);
  const res = makeRes();
  await handler(makeReq({ method: "POST", body: { id: "44444444-4444-4444-4444-444444444444", content: {} } }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "session_not_draft");
});

function draftSessionFixture(id, userId) {
  return {
    id,
    user_id: userId,
    status: "draft",
    schema_version: 1,
    content: { rawText: "original" },
    created_at: "2026-01-01T00:00:00.000Z",
    updated_at: "2026-01-01T00:00:00.000Z",
    completed_at: null,
  };
}

test("sessions: GET one returns the session when owned, 404 when it is not", async () => {
  const id = "55555555-5555-5555-5555-555555555555";
  const sb = createMockSupabase({ sessions: [draftSessionFixture(id, USER_A.id)] });

  const okRes = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "GET", query: { id } }), okRes);
  assert.equal(okRes.statusCode, 200);
  assert.equal(okRes.body.session.id, id);

  const forbiddenRes = makeRes();
  await handlerFor(sb, USER_B)(makeReq({ method: "GET", query: { id } }), forbiddenRes);
  assert.equal(forbiddenRes.statusCode, 404, "another user's session must 404, never 403 or 200");
});

test("sessions: GET one rejects a malformed id", async () => {
  const sb = createMockSupabase();
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "GET", query: { id: "not-a-uuid" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_id");
});

test("sessions: GET list only returns the caller's own sessions", async () => {
  const sb = createMockSupabase({
    sessions: [
      draftSessionFixture("66666666-6666-6666-6666-666666666666", USER_A.id),
      draftSessionFixture("77777777-7777-7777-7777-777777777777", USER_B.id),
    ],
  });
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "GET", query: {} }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.sessions.length, 1);
  assert.equal(res.body.sessions[0].id, "66666666-6666-6666-6666-666666666666");
});

test("sessions: PATCH autosave updates content on a draft session the caller owns", async () => {
  const id = "88888888-8888-8888-8888-888888888888";
  const sb = createMockSupabase({ sessions: [draftSessionFixture(id, USER_A.id)] });
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "PATCH", query: { id }, body: { content: { rawText: "updated" } } }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.session.content, { rawText: "updated" });
});

test("sessions: PATCH autosave 404s against another user's session, never modifying it", async () => {
  const id = "99999999-9999-9999-9999-999999999999";
  const sb = createMockSupabase({ sessions: [draftSessionFixture(id, USER_A.id)] });
  const res = makeRes();
  await handlerFor(sb, USER_B)(makeReq({ method: "PATCH", query: { id }, body: { content: { hacked: true } } }), res);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(sb._state.sessions.find((r) => r.id === id).content, { rawText: "original" });
});

test("sessions: PATCH autosave rejects a completed session with 409, never reverting or overwriting it", async () => {
  const id = "aaaaaaaa-0000-0000-0000-000000000001";
  const sb = createMockSupabase({
    sessions: [
      {
        ...draftSessionFixture(id, USER_A.id),
        status: "completed",
        content: { final: true },
      },
    ],
  });
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "PATCH", query: { id }, body: { content: { tampered: true } } }), res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, "session_not_editable");
  assert.deepEqual(sb._state.sessions.find((r) => r.id === id).content, { final: true });
});

test("sessions: PATCH autosave rejects any field outside the content/schema_version whitelist", async () => {
  const id = "aaaaaaaa-0000-0000-0000-000000000002";
  const sb = createMockSupabase({ sessions: [draftSessionFixture(id, USER_A.id)] });

  for (const badBody of [{ status: "completed" }, { user_id: USER_B.id }, { id: "x" }, { completed_at: "now" }]) {
    const res = makeRes();
    await handlerFor(sb, USER_A)(makeReq({ method: "PATCH", query: { id }, body: badBody }), res);
    assert.equal(res.statusCode, 400, JSON.stringify(badBody));
    assert.equal(res.body.error, "unsupported_field");
  }
});

test("sessions: PATCH autosave rejects a schema_version that would move backward", async () => {
  const id = "aaaaaaaa-0000-0000-0000-000000000003";
  const sb = createMockSupabase({ sessions: [{ ...draftSessionFixture(id, USER_A.id), schema_version: 3 }] });
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "PATCH", query: { id }, body: { schema_version: 2 } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_schema_version");
});
