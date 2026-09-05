// api/session-tiers.js — public GET of active session-pack tiers, for
// rendering the paywall's pack picker. Admin CRUD lives in admin-tiers.js.
import { getServiceClient, setCors } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const supabase = getServiceClient();
    const { data, error } = await supabase
      .from("session_tiers")
      .select("id, name, session_count, price_cents, currency, sort_order")
      .eq("active", true)
      .order("sort_order", { ascending: true });
    if (error) throw error;
    return res.status(200).json({ tiers: data || [] });
  } catch (err) {
    console.error("[session-tiers] error:", err);
    return res.status(500).json({ error: "Failed to load session packs" });
  }
}
