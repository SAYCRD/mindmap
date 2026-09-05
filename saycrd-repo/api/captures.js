// api/captures.js — Stage 2 (session-persistence-audit): create / list /
// delete only. No update route exists — captures are immutable once saved
// (see supabase/migrations/20260905070200_create_captures_table.sql, which
// grants service_role no UPDATE privilege on this table at all).
import { getAuthedUser, getServiceClient, setCors } from "./_lib.js";
import {
  isValidUuid,
  parsePagination,
  encodeCursor,
  MAX_CAPTURE_TEXT_CHARS,
  MAX_CAPTURE_NOTE_CHARS,
  CAPTURE_SOURCES,
} from "./_validate.js";

const CAPTURE_PUBLIC_FIELDS = "id, session_id, text, note, source, created_at";
const CREATE_ALLOWED_KEYS = new Set(["text", "note", "source", "session_id"]);

export function createCapturesHandler({ getAuthedUser, getServiceClient }) {
  return async function handler(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(200).end();

    const user = await getAuthedUser(req);
    if (!user) return res.status(401).json({ error: "authentication_required" });

    const sb = getServiceClient();

    try {
      if (req.method === "POST") return await handleCreate(req, res, sb, user);
      if (req.method === "GET") return await handleList(req, res, sb, user);
      if (req.method === "DELETE") return await handleDelete(req, res, sb, user);
      return res.status(405).json({ error: "method_not_allowed" });
    } catch (err) {
      console.error("captures error:", err.message);
      return res.status(500).json({ error: "request_failed" });
    }
  };
}

async function handleCreate(req, res, sb, user) {
  const body = req.body || {};
  const unsupported = Object.keys(body).filter((k) => !CREATE_ALLOWED_KEYS.has(k));
  if (unsupported.length > 0) return res.status(400).json({ error: "unsupported_field" });

  const text = typeof body.text === "string" ? body.text : "";
  if (!text || text.length > MAX_CAPTURE_TEXT_CHARS) return res.status(400).json({ error: "invalid_text" });

  let note = null;
  if (body.note !== undefined && body.note !== null) {
    if (typeof body.note !== "string" || body.note.length > MAX_CAPTURE_NOTE_CHARS) {
      return res.status(400).json({ error: "invalid_note" });
    }
    note = body.note;
  }

  let source = "report";
  if (body.source !== undefined) {
    if (typeof body.source !== "string" || !CAPTURE_SOURCES.includes(body.source)) {
      return res.status(400).json({ error: "invalid_source" });
    }
    source = body.source;
  }

  let sessionId = null;
  if (body.session_id !== undefined && body.session_id !== null) {
    if (!isValidUuid(body.session_id)) return res.status(400).json({ error: "invalid_session_id" });
    const { data: session, error: sessionErr } = await sb
      .from("sessions")
      .select("id")
      .eq("id", body.session_id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (sessionErr) throw sessionErr;
    // Never reveal whether a session id exists for another user — same
    // generic error either way.
    if (!session) return res.status(400).json({ error: "invalid_session_id" });
    sessionId = body.session_id;
  }

  const { data, error } = await sb
    .from("captures")
    .insert({ user_id: user.id, session_id: sessionId, text, note, source })
    .select(CAPTURE_PUBLIC_FIELDS)
    .single();
  if (error) throw error;
  return res.status(201).json({ capture: data });
}

async function handleList(req, res, sb, user) {
  const pagination = parsePagination(req.query);
  if (!pagination.ok) return res.status(400).json({ error: pagination.error });

  let sessionId = null;
  if (req.query && req.query.session_id !== undefined) {
    if (!isValidUuid(req.query.session_id)) return res.status(400).json({ error: "invalid_session_id" });
    sessionId = req.query.session_id;
  }

  let queryBuilder = sb
    .from("captures")
    .select(CAPTURE_PUBLIC_FIELDS)
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(pagination.limit);

  if (sessionId) queryBuilder = queryBuilder.eq("session_id", sessionId);

  if (pagination.cursor) {
    const { createdAt, id: cursorId } = pagination.cursor;
    queryBuilder = queryBuilder.or(`created_at.lt.${createdAt},and(created_at.eq.${createdAt},id.lt.${cursorId})`);
  }

  const { data, error } = await queryBuilder;
  if (error) throw error;

  const rows = data || [];
  const nextCursor = rows.length === pagination.limit ? encodeCursor(rows[rows.length - 1]) : null;
  return res.status(200).json({ captures: rows, next_cursor: nextCursor });
}

async function handleDelete(req, res, sb, user) {
  const id = req.query && req.query.id;
  if (!isValidUuid(id)) return res.status(400).json({ error: "invalid_id" });

  // Delete requires both the record id AND the verified owner scope in the
  // same statement — never a separate existence check followed by an
  // unscoped delete. Deleting a capture never writes to its source
  // session (session_id on the session row is never touched on this
  // path).
  const { data, error } = await sb.from("captures").delete().eq("id", id).eq("user_id", user.id).select("id").maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: "not_found" });
  return res.status(200).json({ ok: true });
}

const handler = createCapturesHandler({ getAuthedUser, getServiceClient });
export default handler;
