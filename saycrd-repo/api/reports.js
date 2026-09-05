// api/reports.js — Stage 2 (session-persistence-audit): retrieve a report
// by its owning session. GET is the only method this route ever serves —
// no report-generation or completion writes belong here (Stage 5 owns
// generation), and existing reports remain immutable through this route.
import { getAuthedUser, getServiceClient, setCors } from "./_lib.js";
import { isValidUuid } from "./_validate.js";

// Deliberately excludes user_id, migration_source, needs_normalization,
// attempt_count, and last_error — those are internal bookkeeping /
// diagnostics, never a Stage 2 client-facing field.
const REPORT_PUBLIC_FIELDS = "id, session_id, status, schema_version, content, one_line_verdict, created_at, updated_at";

export function createReportsHandler({ getAuthedUser, getServiceClient }) {
  return async function handler(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "GET") return res.status(405).json({ error: "method_not_allowed" });

    const user = await getAuthedUser(req);
    if (!user) return res.status(401).json({ error: "authentication_required" });

    const sessionId = req.query && req.query.session_id;
    if (!isValidUuid(sessionId)) return res.status(400).json({ error: "invalid_session_id" });

    const sb = getServiceClient();

    try {
      // Ownership is verified through BOTH the parent session and the
      // report's own (denormalized) user_id — two independent checks
      // against the verified JWT user, not just one, per this stage's
      // requirement that report retrieval verify ownership through both
      // session and user scope.
      const { data: session, error: sessionErr } = await sb
        .from("sessions")
        .select("id, user_id")
        .eq("id", sessionId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (sessionErr) throw sessionErr;
      // Identical response whether the session doesn't exist at all or
      // belongs to another user — never reveal which.
      if (!session) return res.status(404).json({ error: "not_found" });

      const { data: report, error: reportErr } = await sb
        .from("reports")
        .select(REPORT_PUBLIC_FIELDS)
        .eq("session_id", sessionId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (reportErr) throw reportErr;
      // A session with no report yet (generation not started/finished) is
      // a plain not_found, not an error — Stage 2 never generates reports.
      if (!report) return res.status(404).json({ error: "not_found" });

      return res.status(200).json({ report });
    } catch (err) {
      console.error("reports error:", err.message);
      return res.status(500).json({ error: "request_failed" });
    }
  };
}

const handler = createReportsHandler({ getAuthedUser, getServiceClient });
export default handler;
