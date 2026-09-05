import test from "node:test";
import assert from "node:assert/strict";
import { isValidUuid, validateSessionContent, parsePagination, encodeCursor, MAX_SESSION_CONTENT_BYTES } from "../_validate.js";

test("isValidUuid accepts a well-formed UUID and rejects everything else", () => {
  assert.equal(isValidUuid("11111111-1111-1111-1111-111111111111"), true);
  assert.equal(isValidUuid("not-a-uuid"), false);
  assert.equal(isValidUuid(""), false);
  assert.equal(isValidUuid(undefined), false);
  assert.equal(isValidUuid(12345), false);
});

test("validateSessionContent rejects non-object content", () => {
  assert.equal(validateSessionContent("a string").ok, false);
  assert.equal(validateSessionContent([1, 2, 3]).ok, false);
  assert.equal(validateSessionContent(null).ok, false);
  assert.equal(validateSessionContent(42).ok, false);
});

test("validateSessionContent accepts a plain object under the size cap", () => {
  const result = validateSessionContent({ rawText: "hello", themes: ["a", "b"] });
  assert.equal(result.ok, true);
});

test("validateSessionContent rejects content over the ~200KB cap", () => {
  const bigContent = { blob: "x".repeat(MAX_SESSION_CONTENT_BYTES) };
  const result = validateSessionContent(bigContent);
  assert.equal(result.ok, false);
  assert.equal(result.error, "content_too_large");
});

test("parsePagination defaults to limit 20 with no cursor", () => {
  const result = parsePagination({});
  assert.equal(result.ok, true);
  assert.equal(result.limit, 20);
  assert.equal(result.cursor, null);
});

test("parsePagination caps an oversized limit at 100, never higher", () => {
  const result = parsePagination({ limit: "9999" });
  assert.equal(result.ok, true);
  assert.equal(result.limit, 100);
});

test("parsePagination falls back to the default for a non-positive limit", () => {
  assert.equal(parsePagination({ limit: "0" }).limit, 20);
  assert.equal(parsePagination({ limit: "-5" }).limit, 20);
  assert.equal(parsePagination({ limit: "not-a-number" }).limit, 20);
});

test("encodeCursor and parsePagination round-trip a cursor", () => {
  const row = { id: "22222222-2222-2222-2222-222222222222", created_at: "2026-01-01T00:00:00.000Z" };
  const cursor = encodeCursor(row);
  const result = parsePagination({ cursor });
  assert.equal(result.ok, true);
  assert.deepEqual(result.cursor, { createdAt: row.created_at, id: row.id });
});

test("parsePagination rejects a malformed cursor", () => {
  const result = parsePagination({ cursor: "not-valid-base64url-json" });
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_cursor");
});

test("parsePagination rejects a cursor with a non-UUID id", () => {
  const bad = Buffer.from(JSON.stringify({ createdAt: "2026-01-01T00:00:00.000Z", id: "not-a-uuid" }), "utf8").toString(
    "base64url"
  );
  const result = parsePagination({ cursor: bad });
  assert.equal(result.ok, false);
  assert.equal(result.error, "invalid_cursor");
});
