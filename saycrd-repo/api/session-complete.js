// api/session-complete.js — Stage 4 (session-persistence-audit): the ONLY
// write path that transitions a session from draft/processing to completed,
// writes its report, AND consumes the user's free/paid entitlement — all
// three, atomically, in a single Postgres transaction via the
// complete_session_and_consume_entitlement RPC (SECURITY DEFINER,
// search_path='', advisory-locked per user, tied to this session's UUID
// through session_entitlement_usage). This replaces the old design where
// session-start.js spent the credit up front and this route only persisted
// content — that split meant a charge could exist with no completed session
// behind it (abandon/refresh/fail) and vice versa. Now a charge cannot exist
// without a successfully completed server-side session, by construction: if
// the RPC's persistence half fails, its entitlement half rolls back with it,
// and if the entitlement half is denied (no_entitlement), no persistence
// happens either.
//
// Idempotent by design, matching sessions.js's own idempotent-create
// pattern: retrying the same session_id after a successful completion is a
// safe no-op (the RPC detects status='completed' and returns
// already_completed:true without touching the ledger or free-session count
// again), so a lost HTTP response followed by a client retry can never
// consume a second entitlement for the same session. A concurrent duplicate
// request for the same session_id is serialized by the RPC's per-user
// advisory lock plus its `for update` row lock on the session, so at most
// one of two simultaneous completion attempts ever consumes an entitlement.
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
      const { data: rpcResult, error: rpcErr } = await sb.rpc("complete_session_and_consume_entitlement", {
        p_session_id: sessionId,
        p_user_id: user.id,
        p_session_content: sessionContent,
        p_report_content: reportContent,
        p_verdict: verdict,
      });
      if (rpcErr) throw rpcErr;

      if (!rpcResult || rpcResult.ok !== true) {
        const errCode = rpcResult && rpcResult.error;
        if (errCode === "not_found") return res.status(404).json({ error: "not_found" });
        if (errCode === "session_not_editable") return res.status(409).json({ error: "session_not_editable" });
        if (errCode === "no_entitlement") {
          // Local content is never lost here -- the client keeps it and
          // shows the paywall/retry path; nothing was persisted or charged.
          return res.status(402).json({ error: "no_credits", message: "No free or paid sessions remaining" });
        }
        // "retry_needed" (a session_entitlement_usage race caught as
        // unique_violation) or any other unrecognized code: safe to retry --
        // no partial charge or partial persistence can have happened, the
        // whole RPC is one transaction. Respond 500 (not 409) so it falls
        // into session-sync.js's existing ">=500 is retryable" bucket
        // automatically, without that generic client needing to special-case
        // this reason.
        return res.status(500).json({ error: "retry_needed", message: "Please try again" });
      }

      // Whether this call just completed the session or it was already
      // completed by an earlier attempt (idempotent replay), respond with
      // the current persisted state.
      return await respondWithCurrentState(sb, user, sessionId, res);
    } catch (err) {
      console.error("session-complete error:", err.message);
      // Local content is preserved client-side regardless -- this response
      // tells the client to show Retry rather than treat the session as lost.
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

const handler = createSessionCompleteHandler({ getAuthedUser, getServiceClient });
export default handler;
