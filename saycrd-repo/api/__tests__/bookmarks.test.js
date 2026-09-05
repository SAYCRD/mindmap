import test from "node:test";
import assert from "node:assert/strict";
import { createBookmarksHandler } from "../bookmarks.js";
import { createMockSupabase, authedAs, unauthenticatedGetAuthedUser } from "./_mock-supabase.js";
import { makeReq, makeRes } from "./_http.js";

const USER_A = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" };
const USER_B = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" };

function handlerFor(sb, user) {
  return createBookmarksHandler({ getAuthedUser: authedAs(user), getServiceClient: () => sb });
}

test("bookmarks: rejects an unauthenticated caller with 401", async () => {
  const sb = createMockSupabase();
  const handler = createBookmarksHandler({ getAuthedUser: unauthenticatedGetAuthedUser, getServiceClient: () => sb });
  const res = makeRes();
  await handler(makeReq({ method: "GET" }), res);
  assert.equal(res.statusCode, 401);
});

test("bookmarks: rejects an unsupported method with 405", async () => {
  const sb = createMockSupabase();
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "PATCH" }), res);
  assert.equal(res.statusCode, 405);
});

test("bookmarks: POST creates a bookmark with an optional label", async () => {
  const sb = createMockSupabase();
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "POST", body: { text: "worth remembering", label: "insight" } }), res);
  assert.equal(res.statusCode, 201);
  assert.equal(res.body.bookmark.text, "worth remembering");
  assert.equal(res.body.bookmark.label, "insight");
  assert.equal(res.body.bookmark.user_id, undefined);
});

test("bookmarks: POST rejects text over the 2000 char cap", async () => {
  const sb = createMockSupabase();
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "POST", body: { text: "x".repeat(2001) } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_text");
});

test("bookmarks: POST rejects a label over the app-level 500 char cap", async () => {
  const sb = createMockSupabase();
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "POST", body: { text: "ok", label: "x".repeat(501) } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "invalid_label");
});

test("bookmarks: POST rejects an unsupported field", async () => {
  const sb = createMockSupabase();
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "POST", body: { text: "ok", status: "completed" } }), res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, "unsupported_field");
});

const BOOKMARK_1 = "c1c1c1c1-c1c1-c1c1-c1c1-c1c1c1c1c1c1";
const BOOKMARK_2 = "c2c2c2c2-c2c2-c2c2-c2c2-c2c2c2c2c2c2";

test("bookmarks: DELETE removes an owned bookmark and returns 404 for someone else's", async () => {
  const sb = createMockSupabase({
    bookmarks: [
      { id: BOOKMARK_1, user_id: USER_A.id, session_id: null, text: "mine", label: null, created_at: "2026-01-02T00:00:00.000Z" },
      { id: BOOKMARK_2, user_id: USER_B.id, session_id: null, text: "not mine", label: null, created_at: "2026-01-02T00:00:00.000Z" },
    ],
  });

  const forbiddenRes = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "DELETE", query: { id: BOOKMARK_2 } }), forbiddenRes);
  assert.equal(forbiddenRes.statusCode, 404);
  assert.equal(sb._state.bookmarks.length, 2);

  const okRes = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "DELETE", query: { id: BOOKMARK_1 } }), okRes);
  assert.equal(okRes.statusCode, 200);
  assert.equal(sb._state.bookmarks.length, 1);
  assert.equal(sb._state.bookmarks[0].id, BOOKMARK_2);
});

test("bookmarks: GET list only returns the caller's own bookmarks", async () => {
  const sb = createMockSupabase({
    bookmarks: [
      { id: BOOKMARK_1, user_id: USER_A.id, session_id: null, text: "mine", label: null, created_at: "2026-01-02T00:00:00.000Z" },
      { id: BOOKMARK_2, user_id: USER_B.id, session_id: null, text: "not mine", label: null, created_at: "2026-01-02T00:00:00.000Z" },
    ],
  });
  const res = makeRes();
  await handlerFor(sb, USER_A)(makeReq({ method: "GET", query: {} }), res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.bookmarks.length, 1);
  assert.equal(res.body.bookmarks[0].id, BOOKMARK_1);
});
