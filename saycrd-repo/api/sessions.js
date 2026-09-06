// api/sessions.js — Stage 2 (session-persistence-audit): server API for
// session create / autosave (update) / list / retrieve-one, and nothing
// else. Completion, credit consumption, reservations, guest migration,
// export, and account deletion are explicitly out of scope for this route
// (see supabase/MIGRATIONS_STATUS.md) and are owned by later stages.
//
// Every operation derives user_id ONLY from the verified Supabase JWT
// (getAuthedUser) -- never from the request body or query string -- and
// every service-role query is filtered by that verified id, so one user
// can never read or modify another user's session through this route.
import { getAuthedUser, getServiceClient, setCors } from "./_lib.js";
import {
  isValidUuid,
  SESSION_STATUSES,
  SESSION_EDITABLE_STATUSES,
  validateSessionContent,
  parsePagination,
  encodeCursor,
} from "./_validate.js";

// Fields ever returned to the client. Deliberately excludes user_id (the
// caller already knows who they are), legacy_date / legacy_fingerprint /
// migration_source / migration_batch_id / needs_normalization (internal
// migration bookkeeping, Stage 3) and reservation_expires_at (Stage 5) --
// none of that belongs on a Stage 2 response.
const SESSION_PUBLIC_FIELDS = "id, status, schema_version, content, created_at, updated_at, completed_at";

// Dependency-injected factory: the default export below wires in the real
// Supabase-backed helpers, and tests wire in an in-memory mock instead (see
// api/__tests__/sessions.test.js) so route logic — validation, ownership
// scoping, whitelisting, idempotency, pagination shape — can be exercised
// without a database or network access.
export function createSessionsHandler({ getAuthedUser, getServiceClient }) {
  return async function handler(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(200).end();

    const user = await getAuthedUser(req);
    if (!user) return res.status(401).json({ error: "authentication_required" });

    const sb = getServiceClient();

    try {
      if (req.method === "POST") return await handleCreate(req, res, sb, user);
      if (req.method === "PATCH") return await handleAutosave(req, res, sb, user);
      if (req.method === "GET") {
        const id = req.query && req.query.id;
        if (id) return await handleGetOne(req, res, sb, user, id);
        return await handleList(req, res, sb, user);
      }
      return res.status(405).json({ error: "method_not_allowed" });
    } catch (err) {
      console.error("sessions error:", err.message);
      return res.status(500).json({ error: "request_failed" });
    }
  };
}

const CREATE_ALLOWED_KEYS = new Set(["id", "content"]);

async function handleCreate(req, res, sb, user) {
  const body = req.body || {};

  // Whitelist only: status/user_id/migration_source/legacy_*/etc are never
  // accepted from the request body, even silently ignored — rejected
  // outright so a client can never coax this route into creating a
  // non-draft row or attributing a row to another user.
  const unsupported = Object.keys(body).filter((k) => !CREATE_ALLOWED_KEYS.has(k));
  if (unsupported.length > 0) return res.status(400).json({ error: "unsupported_field" });

  let id = null;
  if (body.id !== undefined) {
    if (!isValidUuid(body.id)) return res.status(400).json({ error: "invalid_id" });
    id = body.id;
  }

  const content = body.content !== undefined ? body.content : {};
  const contentCheck = validateSessionContent(content);
  if (!contentCheck.ok) return res.status(400).json({ error: contentCheck.error });

  const insertRow = { content, user_id: user.id };
  if (id) insertRow.id = id;

  const { data, error } = await sb.from("sessions").insert(insertRow).select(SESSION_PUBLIC_FIELDS).single();

  if (!error) return res.status(201).json({ session: data });

  // 23505 = unique_violation. This route never sets legacy_fingerprint, so
  // the only way to reach this branch is a client-supplied `id` that
  // already exists as another row's primary key.
  if (error.code === "23505" && id) {
    const { data: existing, error: fetchErr } = await sb
      .from("sessions")
      .select("id, user_id, status, schema_version, content, created_at, updated_at, completed_at")
      .eq("id", id)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!existing) throw new Error("id conflict but row not found");

    if (existing.user_id !== user.id) {
      // Never reveal whether the id exists for another user — identical
      // generic conflict either way.
      return res.status(409).json({ error: "conflict" });
    }
    if (existing.status !== "draft") {
      // Retrying a create call against a session that has since moved
      // past draft (processing/completed/failed/abandoned) is a conflict,
      // not a silent no-op — only a still-draft row is safe to treat as
      // already-created.
      return res.status(409).json({ error: "session_not_draft" });
    }

    const { user_id, ...publicRow } = existing;
    // Same owner, still a draft: creating the same UUID again is
    // idempotent — return the row exactly as it already is. This route
    // never overwrites content on an idempotent replay; PATCH/autosave is
    // the only path that changes content after creation.
    return res.status(200).json({ session: publicRow });
  }

  throw error;
}

const AUTOSAVE_ALLOWED_KEYS = new Set(["content", "schema_version"]);

async function handleAutosave(req, res, sb, user) {
  const id = req.query && req.query.id;
  if (!isValidUuid(id)) return res.status(400).json({ error: "invalid_id" });

  const body = req.body || {};
  const bodyKeys = Object.keys(body);
  // Whitelist only: any other key (status, user_id, id, migration_source,
  // legacy_*, completed_at, reservation_expires_at, ...) is rejected
  // outright rather than silently dropped, so autosave can never be used
  // to change ownership, mark a session completed, or touch
  // reservation/migration bookkeeping — by construction, not by trusting
  // the caller not to send it.
  const unsupported = bodyKeys.filter((k) => !AUTOSAVE_ALLOWED_KEYS.has(k));
  if (unsupported.length > 0) return res.status(400).json({ error: "unsupported_field" });
  if (bodyKeys.length === 0) return res.status(400).json({ error: "empty_update" });

  const { data: existing, error: fetchErr } = await sb
    .from("sessions")
    .select("id, user_id, status, schema_version")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (fetchErr) throw fetchErr;
  // Identical response whether the id doesn't exist at all or belongs to
  // another user — never reveal which case it is.
  if (!existing) return res.status(404).json({ error: "not_found" });

  if (!SESSION_EDITABLE_STATUSES.includes(existing.status)) {
    // Covers 'completed', 'failed', and 'abandoned' alike: once a session
    // has left the active draft/processing lifecycle, autosave can never
    // revert or silently overwrite it.
    return res.status(409).json({ error: "session_not_editable" });
  }

  const patch = {};
  if (body.content !== undefined) {
    const contentCheck = validateSessionContent(body.content);
    if (!contentCheck.ok) return res.status(400).json({ error: contentCheck.error });
    patch.content = body.content;
  }
  if (body.schema_version !== undefined) {
    const sv = parseInt(body.schema_version, 10);
    // schema_version may only move forward, never backward — it exists so
    // future code can interpret older rows correctly, which breaks if a
    // client can rewind it.
    if (!Number.isInteger(sv) || sv < existing.schema_version) {
      return res.status(400).json({ error: "invalid_schema_version" });
    }
    patch.schema_version = sv;
  }

  const { data, error } = await sb
    .from("sessions")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id)
    .select(SESSION_PUBLIC_FIELDS)
    .single();
  if (error) throw error;
  return res.status(200).json({ session: data });
}

async function handleGetOne(req, res, sb, user, id) {
  if (!isValidUuid(id)) return res.status(400).json({ error: "invalid_id" });

  const { data, error } = await sb
    .from("sessions")
    .select(SESSION_PUBLIC_FIELDS)
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw error;
  // Identical response whether the id doesn't exist at all or exists but
  // belongs to another user — never reveal which.
  if (!data) return res.status(404).json({ error: "not_found" });
  return res.status(200).json({ session: data });
}

async function handleList(req, res, sb, user) {
  const pagination = parsePagination(req.query);
  if (!pagination.ok) return res.status(400).json({ error: pagination.error });

  const status = req.query && req.query.status;
  if (status !== undefined && !SESSION_STATUSES.includes(status)) {
    return res.status(400).json({ error: "invalid_status" });
  }

  let queryBuilder = sb
    .from("sessions")
    .select(SESSION_PUBLIC_FIELDS)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pagination.limit);

  if (status) queryBuilder = queryBuilder.eq("status", status);

  if (pagination.cursor) {
    // Keyset pagination on (created_at, id) — deterministic even when
    // multiple rows share the same created_at, and never silently caps
    // total retrievable history: repeated calls using each response's
    // next_cursor page through the user's entire session history: only
    // the page size itself is bounded (see MAX_PAGE_SIZE in _validate.js).
    const { createdAt, id: cursorId } = pagination.cursor;
    queryBuilder = queryBuilder.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${cursorId})`);
  }

  const { data, error } = await queryBuilder;
  if (error) throw error;

  const rows = data || [];
  const nextCursor = rows.length === pagination.limit ? encodeCursor(rows[rows.length - 1]) : null;
  return res.status(200).json({ sessions: rows, next_cursor: nextCursor });
}

const handler = createSessionsHandler({ getAuthedUser, getServiceClient });
export default handler;
