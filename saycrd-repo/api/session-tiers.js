// api/session-tiers.js — public catalog of purchasable session packs.
// No auth required: session_tiers RLS already restricts this to active=true
// rows, so the anon key alone would work too, but we go through the service
// client to avoid shipping any Supabase key at all on this read-only route.
import { getServiceClient, setCors } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const sb = getServiceClient();
    const { data, error } = await sb
      .from("session_tiers")
      .select("id, name, session_count, price_cents, currency, sort_order")
      .eq("active", true)
      .order("sort_order", { ascending: true });

    if (error) throw error;
    return res.status(200).json({ tiers: data || [] });
  } catch (err) {
    console.error("session-tiers error:", err.message);
    return res.status(500).json({ error: "Failed to load session tiers" });
  }
}
