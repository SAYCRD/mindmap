// api/bookmarks.js — Stage 2 (session-persistence-audit): create / list /
// delete only. No update route exists — bookmarks are immutable once saved
// (see supabase/migrations/20260905070300_create_bookmarks_table.sql, which
// grants service_role no UPDATE privilege on this table at all).
import { getAuthedUser, getServiceClient, setCors } from "./_lib.js";
import { isValidUuid, parsePagination, encodeCursor, MAX_BOOKMARK_TEXT_CHARS, MAX_BOOKMARK_LABEL_CHARS } from "./_validate.js";

const BOOKMARK_PUBLIC_FIELDS = "id, session_id, text, label, created_at";
const CREATE_ALLOWED_KEYS = new Set(["text", "label", "session_id"]);

export function createBookmarksHandler({ getAuthedUser, getServiceClient }) {
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
      console.error("bookmarks error:", err.message);
      return res.status(500).json({ error: "request_failed" });
    }
  };
}

async function handleCreate(req, res, sb, user) {
  const body = req.body || {};
  const unsupported = Object.keys(body).filter((k) => !CREATE_ALLOWED_KEYS.has(k));
  if (unsupported.length > 0) return res.status(400).json({ error: "unsupported_field" });

  const text = typeof body.text === "string" ? body.text : "";
  if (!text || text.length > MAX_BOOKMARK_TEXT_CHARS) return res.status(400).json({ error: "invalid_text" });

  let label = null;
  if (body.label !== undefined && body.label !== null) {
    if (typeof body.label !== "string" || body.label.length > MAX_BOOKMARK_LABEL_CHARS) {
      return res.status(400).json({ error: "invalid_label" });
    }
    label = body.label;
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
    if (!session) return res.status(400).json({ error: "invalid_session_id" });
    sessionId = body.session_id;
  }

  const { data, error } = await sb
    .from("bookmarks")
    .insert({ user_id: user.id, session_id: sessionId, text, label })
    .select(BOOKMARK_PUBLIC_FIELDS)
    .single();
  if (error) throw error;
  return res.status(201).json({ bookmark: data });
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
    .from("bookmarks")
    .select(BOOKMARK_PUBLIC_FIELDS)
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
  return res.status(200).json({ bookmarks: rows, next_cursor: nextCursor });
}

async function handleDelete(req, res, sb, user) {
  const id = req.query && req.query.id;
  if (!isValidUuid(id)) return res.status(400).json({ error: "invalid_id" });

  const { data, error } = await sb.from("bookmarks").delete().eq("id", id).eq("user_id", user.id).select("id").maybeSingle();
  if (error) throw error;
  if (!data) return res.status(404).json({ error: "not_found" });
  return res.status(200).json({ ok: true });
}

const handler = createBookmarksHandler({ getAuthedUser, getServiceClient });
export default handler;
