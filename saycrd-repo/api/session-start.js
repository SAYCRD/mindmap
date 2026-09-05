// api/session-start.js — the single gate every "start a session" entry point
// calls for a real (non-guest) account before letting them in. Delegates the
// actual free-vs-paid decision + deduction to the consume_session_credit
// Postgres RPC (SECURITY DEFINER, search_path='') so it happens atomically
// under an advisory lock — never decide free/paid in application code, a
// second concurrent request could double-spend a credit otherwise.
import { getAuthedUser, getServiceClient, setCors } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthedUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  try {
    const sb = getServiceClient();
    const { data, error } = await sb.rpc("consume_session_credit", {
      p_user_id: user.id,
      p_seed_used: 0,
    });
    if (error) throw error;

    if (!data || data.ok !== true) {
      return res.status(402).json({ error: "no_credits", message: "No free or paid sessions remaining" });
    }
    return res.status(200).json({ ok: true, source: data.source });
  } catch (err) {
    console.error("session-start error:", err.message);
    return res.status(500).json({ error: "Failed to start session" });
  }
}
