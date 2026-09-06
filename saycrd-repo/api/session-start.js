// api/session-start.js — Stage 4 (session-persistence-audit): eligibility
// check ONLY. This route MUST NEVER mutate free_sessions_used, credit_ledger,
// or session_entitlement_usage. It used to call the consume_session_credit
// RPC and spend a credit right here, before any session content existed —
// that meant abandoning, refreshing, closing the tab, or a failed pour still
// permanently cost the user a free/paid session with no refund path, and a
// lost HTTP response could cause a retry to double-spend. The single place
// an entitlement is now ever consumed is the complete_session_and_consume_
// entitlement RPC, called from session-complete.js, atomically with marking
// the session completed — so a charge can never exist without a genuinely
// completed, server-persisted session. This route now only answers "would a
// session-complete call currently succeed for this user," using the exact
// same free-then-paid precedence, so the client can show the paywall before
// the user invests time in a session it can't ultimately complete — but that
// answer is advisory only. It has no bearing on what actually gets charged.
import { getAuthedUser, getServiceClient, setCors } from "./_lib.js";

const FREE_SESSION_LIMIT = 2;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthedUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  try {
    const sb = getServiceClient();

    const { data: freeRow, error: freeErr } = await sb
      .from("free_sessions_used")
      .select("count")
      .eq("user_id", user.id)
      .maybeSingle();
    if (freeErr) throw freeErr;

    const freeUsed = freeRow ? freeRow.count : 0;
    if (freeUsed < FREE_SESSION_LIMIT) {
      return res.status(200).json({ ok: true, source: "complimentary" });
    }

    const { data: ledgerRows, error: ledgerErr } = await sb
      .from("credit_ledger")
      .select("delta")
      .eq("user_id", user.id);
    if (ledgerErr) throw ledgerErr;

    const balance = (ledgerRows || []).reduce((sum, row) => sum + row.delta, 0);
    if (balance > 0) {
      return res.status(200).json({ ok: true, source: "credit" });
    }

    return res.status(402).json({ error: "no_credits", message: "No free or paid sessions remaining" });
  } catch (err) {
    console.error("session-start error:", err.message);
    return res.status(500).json({ error: "Failed to check session eligibility" });
  }
}
