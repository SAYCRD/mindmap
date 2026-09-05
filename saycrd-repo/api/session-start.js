// api/session-start.js — server-authoritative "spend one session" endpoint.
// The client never self-reports having credits; this RPC call is the only
// place a free session or a paid credit is actually consumed, and it is
// atomic (see consume_session_credit in payments-schema.sql), so it can't
// be tampered with from devtools or raced by a double click.
import { getServiceClient, getAuthedUser, setCors } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthedUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  const guestUsedRaw = req.body && req.body.guestUsed;
  const guestUsed = parseInt(guestUsedRaw, 10);

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase.rpc("consume_session_credit", {
      p_user_id: user.id,
      p_seed_used: Number.isFinite(guestUsed) ? guestUsed : 0,
    });
    if (error) throw error;

    if (data && data.ok) {
      return res.status(200).json({ ok: true, source: data.source });
    }
    return res.status(402).json({ ok: false, error: "No sessions available" });
  } catch (err) {
    console.error("[session-start] error:", err);
    return res.status(500).json({ error: "Failed to start session" });
  }
}
