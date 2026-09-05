// api/credits.js — returns the authed user's current credit balance and
// free-session usage. Used by PaywallModal to poll for a successful
// purchase after returning from Square Checkout, and could back a
// "sessions remaining" indicator later.
import { getAuthedUser, getServiceClient, setCors } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthedUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  try {
    const sb = getServiceClient();

    const [{ data: ledgerRows, error: ledgerErr }, { data: freeRow, error: freeErr }] = await Promise.all([
      sb.from("credit_ledger").select("delta").eq("user_id", user.id),
      sb.from("free_sessions_used").select("count").eq("user_id", user.id).maybeSingle(),
    ]);

    if (ledgerErr) throw ledgerErr;
    if (freeErr) throw freeErr;

    const balance = (ledgerRows || []).reduce(function (sum, row) {
      return sum + (row.delta || 0);
    }, 0);
    const freeUsed = (freeRow && freeRow.count) || 0;
    const freeRemaining = Math.max(0, 2 - freeUsed);

    return res.status(200).json({ balance, freeUsed, freeRemaining });
  } catch (err) {
    console.error("credits error:", err.message);
    return res.status(500).json({ error: "Failed to load credits" });
  }
}
