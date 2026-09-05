// api/credits.js — returns the caller's free-session + paid-credit balance.
// Read-only: does not consume anything. api/session-start.js is the only
// endpoint that actually spends a session.
import { getServiceClient, getAuthedUser, setCors } from "./_lib.js";

const FREE_LIMIT = 2;

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthedUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  try {
    const supabase = getServiceClient();

    // Seed free_sessions_used from the client's reported local guest-session
    // count on first read (never lowers an existing row — see the RPC's
    // definition in payments-schema.sql), so the balance shown reflects
    // carried-over guest usage even before the account's first session start.
    const guestUsedRaw = req.query && req.query.guestUsed;
    const guestUsed = parseInt(guestUsedRaw, 10);
    if (Number.isFinite(guestUsed) && guestUsed > 0) {
      const { error: seedError } = await supabase.rpc("ensure_free_sessions_seed", {
        p_user_id: user.id,
        p_seed_used: guestUsed,
      });
      if (seedError) console.error("[credits] seed error:", seedError);
    }

    const [{ data: freeRow, error: freeError }, { data: ledgerRows, error: ledgerError }] = await Promise.all([
      supabase.from("free_sessions_used").select("count").eq("user_id", user.id).maybeSingle(),
      supabase.from("credit_ledger").select("delta").eq("user_id", user.id),
    ]);
    if (freeError) throw freeError;
    if (ledgerError) throw ledgerError;

    const used = freeRow ? freeRow.count : 0;
    const freeRemaining = Math.max(0, FREE_LIMIT - used);
    const creditBalance = (ledgerRows || []).reduce((sum, r) => sum + r.delta, 0);

    return res.status(200).json({
      freeRemaining,
      creditBalance,
      totalAvailable: freeRemaining + creditBalance,
    });
  } catch (err) {
    console.error("[credits] error:", err);
    return res.status(500).json({ error: "Failed to load credits" });
  }
}
