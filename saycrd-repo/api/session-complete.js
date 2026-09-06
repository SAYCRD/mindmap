// api/session-complete.js — Stage 3 (session-persistence-audit): the one
// write path that transitions a session from draft/processing to
// completed AND writes its report, in the same request. Stage 2's
// sessions.js/reports.js deliberately left this transition unbuilt (see
// MIGRATIONS_STATUS.md's Stage 2 section, which named it a future "Stage
// 5 completion RPC") -- this route is the minimal, additive piece Stage 3
// needs to fulfil "session and report are attached to the authenticated
// user and saved server-side." It requires no schema or privilege
// change: sessions already grants service_role UPDATE and reports
// already grants service_role INSERT+UPDATE (see the Stage 1 migration
// files) -- exactly what this route uses, nothing more.
//
// Idempotent by design, matching sessions.js's own idempotent-create
// pattern: retrying the same session_id after a successful completion is
// a safe no-op (returns the existing session+report, applies no further
// writes), and a retry that races a first attempt's report insert falls
// back to an update instead of erroring -- so a flaky network retry can
// never duplicate a session or a report row.
import { getAuthedUser, getServiceClient, setCors } from "./_lib.js";
import { isValidUuid, validateSessionContent, validateReportContent, MAX_VERDICT_CHARS } from "./_validate.js";

const SESSION_PUBLIC_FIELDS = "id, status, schema_version, content, created_at, updated_at, completed_at";
const REPORT_PUBLIC_FIELDS = "id, session_id, status, schema_version, content, one_line_verdict, created_at, updated_at";

// Whitelist only: status/user_id/id-of-report/migration_source/etc are
// never accepted from the request body, even silently ignored --
// rejected outright, same discipline as every Stage 2 route.
const ALLOWED_KEYS = new Set(["session_id", "session_content", "report_content", "one_line_verdict"]);

export function createSessionCompleteHandler({ getAuthedUser, getServiceClient }) {
  return async function handler(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "method_not_allowed" });

    const user = await getAuthedUser(req);
    if (!user) return res.status(401).json({ error: "authentication_required" });

    const sb = getServiceClient();
    const body = req.body || {};

    const unsupported = Object.keys(body).filter((k) => !ALLOWED_KEYS.has(k));
    if (unsupported.length > 0) return res.status(400).json({ error: "unsupported_field" });

    const sessionId = body.session_id;
    if (!isValidUuid(sessionId)) return res.status(400).json({ error: "invalid_session_id" });

    const sessionContent = body.session_content !== undefined ? body.session_content : {};
    const sessionCheck = validateSessionContent(sessionContent);
    if (!sessionCheck.ok) return res.status(400).json({ error: sessionCheck.error });

    const reportContent = body.report_content !== undefined ? body.report_content : {};
    const reportCheck = validateReportContent(reportContent);
    if (!reportCheck.ok) return res.status(400).json({ error: reportCheck.error });

    let verdict = null;
    if (body.one_line_verdict !== undefined && body.one_line_verdict !== null) {
      if (typeof body.one_line_verdict !== "string" || body.one_line_verdict.length > MAX_VERDICT_CHARS) {
        return res.status(400).json({ error: "invalid_verdict" });
      }
      verdict = body.one_line_verdict;
    }

    try {
      const { data: existing, error: fetchErr } = await sb
        .from("sessions")
        .select("id, user_id, status")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      // Identical response whether the session doesn't exist at all or
      // belongs to another user -- never reveal which.
      if (!existing) return res.status(404).json({ error: "not_found" });

      if (existing.status === "completed") {
        // Idempotent replay: a retry after a successful completion (the
        // client never saw the first response, a duplicate click, etc.)
        // must never re-apply writes or error -- return current state.
        return await respondWithCurrentState(sb, user, sessionId, res);
      }

      if (existing.status !== "draft" && existing.status !== "processing") {
        // failed/abandoned: never resurrect into completed through this route.
        return res.status(409).json({ error: "session_not_editable" });
      }

      const { data: session, error: updateErr } = await sb
        .from("sessions")
        .update({ content: sessionContent, status: "completed", completed_at: new Date().toISOString() })
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .select(SESSION_PUBLIC_FIELDS)
        .single();
      if (updateErr) throw updateErr;

      const report = await upsertReport(sb, user, sessionId, reportContent, verdict);
      return res.status(200).json({ session, report });
    } catch (err) {
      console.error("session-complete error:", err.message);
      return res.status(500).json({ error: "request_failed" });
    }
  };
}

async function respondWithCurrentState(sb, user, sessionId, res) {
  const { data: session, error: sErr } = await sb
    .from("sessions")
    .select(SESSION_PUBLIC_FIELDS)
    .eq("id", sessionId)
    .eq("user_id", user.id)
    .single();
  if (sErr) throw sErr;
  const { data: report, error: rErr } = await sb
    .from("reports")
    .select(REPORT_PUBLIC_FIELDS)
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (rErr) throw rErr;
  return res.status(200).json({ session, report: report || null });
}

async function upsertReport(sb, user, sessionId, content, verdict) {
  const { data: existingReport, error: findErr } = await sb
    .from("reports")
    .select("id")
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (findErr) throw findErr;

  if (!existingReport) {
    const { data, error } = await sb
      .from("reports")
      .insert({ session_id: sessionId, user_id: user.id, status: "complete", content, one_line_verdict: verdict })
      .select(REPORT_PUBLIC_FIELDS)
      .single();
    // 23505 = unique_violation on reports.session_id -- a concurrent
    // retry already inserted the row between our select and insert above.
    // Fall back to update instead of surfacing a duplicate-row error.
    if (error && error.code === "23505") return await updateExistingReport(sb, user, sessionId, content, verdict);
    if (error) throw error;
    return data;
  }

  return await updateExistingReport(sb, user, sessionId, content, verdict);
}

async function updateExistingReport(sb, user, sessionId, content, verdict) {
  const { data, error } = await sb
    .from("reports")
    .update({ content, status: "complete", one_line_verdict: verdict })
    .eq("session_id", sessionId)
    .eq("user_id", user.id)
    .select(REPORT_PUBLIC_FIELDS)
    .single();
  if (error) throw error;
  return data;
}

const handler = createSessionCompleteHandler({ getAuthedUser, getServiceClient });
export default handler;
