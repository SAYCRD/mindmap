// api/_validate.js — shared, pure request-validation helpers for Stage 2
// (session-persistence-audit) API routes. Deliberately has no Supabase
// client and does no I/O, so every route's input validation, whitelisting,
// and pagination-cursor logic can be unit-tested without a database or
// network access (see api/__tests__/validate.test.js).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

// Mirrors the sessions.status check constraint exactly.
export const SESSION_STATUSES = ["draft", "processing", "completed", "failed", "abandoned"];

// Statuses a session may still be in when autosave is allowed to touch it.
// Deliberately excludes 'completed', 'failed', and 'abandoned' -- Stage 2
// must never let autosave revert or silently overwrite a session once it
// has left the active draft/processing lifecycle. Only a later, separately
// authored Stage 5 completion RPC ever makes that transition.
export const SESSION_EDITABLE_STATUSES = ["draft", "processing"];

// Matches supabase/migrations/20260905070000_create_sessions_table.sql's
// sessions_content_size_ck (~200KB) for live (non-migrated) writes. This
// route enforces the same bound independently so an oversized request is
// rejected with a clear, generic error before ever reaching Postgres, not
// only relying on the DB constraint to reject it.
export const MAX_SESSION_CONTENT_BYTES = 200000;

// Matches the corresponding DB check constraints for live writes in
// 20260905070200_create_captures_table.sql and
// 20260905070300_create_bookmarks_table.sql.
export const MAX_CAPTURE_TEXT_CHARS = 300;
export const MAX_CAPTURE_NOTE_CHARS = 800;
export const MAX_BOOKMARK_TEXT_CHARS = 2000;

// bookmarks.label has no DB-level check constraint (unbounded by design,
// per that migration's comments). Every other live-write field in this
// schema is otherwise explicitly capped, so this is an app-level-only
// limit: it exists solely so a request body can never smuggle an
// arbitrarily large label through this route. Revisit if a future,
// separately-reviewed migration adds a matching DB-level constraint.
export const MAX_BOOKMARK_LABEL_CHARS = 500;

// captures.source has no DB-level check constraint either (plain text,
// default 'report'). This allowlist is an app-level policy reflecting the
// values the client actually produces today; extend deliberately, not by
// removing the check.
export const CAPTURE_SOURCES = ["report", "manual", "session"];

export function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

// content must be a plain JSON object -- not an array, not a primitive,
// not null -- matching how sessions.content / reports.content are modeled
// and read everywhere else in the app.
export function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateSessionContent(content) {
  if (!isPlainObject(content)) return { ok: false, error: "content_must_be_object" };
  let size;
  try {
    size = byteLength(JSON.stringify(content));
  } catch (e) {
    return { ok: false, error: "content_must_be_object" };
  }
  if (size > MAX_SESSION_CONTENT_BYTES) return { ok: false, error: "content_too_large" };
  return { ok: true };
}

const DEFAULT_PAGE_SIZE = 20;
// Bounds only the size of a single page, never the total amount of history
// a user can retrieve -- repeated calls with each response's next_cursor
// page through the user's entire history. This is what satisfies "must
// not silently cap history at 100": that cap is per-page, not a ceiling on
// total retrievable rows.
const MAX_PAGE_SIZE = 100;

export function parsePagination(query) {
  const rawLimit = parseInt(query && query.limit, 10);
  const limit = Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;

  if (!query || query.cursor === undefined || query.cursor === null || query.cursor === "") {
    return { ok: true, limit, cursor: null };
  }

  try {
    const decoded = JSON.parse(Buffer.from(String(query.cursor), "base64url").toString("utf8"));
    if (decoded && typeof decoded.createdAt === "string" && isValidUuid(decoded.id)) {
      return { ok: true, limit, cursor: decoded };
    }
    return { ok: false, error: "invalid_cursor" };
  } catch (e) {
    return { ok: false, error: "invalid_cursor" };
  }
}

// Keyset pagination cursor on (created_at, id) -- deterministic even when
// multiple rows share the same created_at timestamp (id is the tiebreak),
// and stable across concurrent inserts in a way plain offset pagination is
// not.
export function encodeCursor(row) {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id }), "utf8").toString("base64url");
}
