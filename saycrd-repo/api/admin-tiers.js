// api/admin-tiers.js — admin-only CRUD for session-pack tiers.
// Protected by an email allowlist (ADMIN_EMAILS), checked against the
// caller's Supabase-verified identity. Any client-side "show the admin
// link" check is UX only — this server-side check is the real boundary.
import { getServiceClient, getAuthedUser, isAdminEmail, setCors } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const user = await getAuthedUser(req);
  if (!user || !isAdminEmail(user.email)) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const supabase = getServiceClient();

  try {
    if (req.method === "GET") {
      const { data, error } = await supabase
        .from("session_tiers")
        .select("*")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return res.status(200).json({ tiers: data || [] });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const name = String(body.name || "").trim();
      const sessionCount = parseInt(body.session_count, 10);
      const priceCents = parseInt(body.price_cents, 10);
      if (!name || !Number.isInteger(sessionCount) || sessionCount <= 0 || !Number.isInteger(priceCents) || priceCents <= 0) {
        return res.status(400).json({ error: "A tier needs a name, a positive whole session_count, and a positive whole price_cents" });
      }
      const sortOrder = Number.isInteger(parseInt(body.sort_order, 10)) ? parseInt(body.sort_order, 10) : 0;
      const { data, error } = await supabase
        .from("session_tiers")
        .insert({
          name,
          session_count: sessionCount,
          price_cents: priceCents,
          sort_order: sortOrder,
          active: body.active !== false,
        })
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ tier: data });
    }

    if (req.method === "PUT") {
      const body = req.body || {};
      const id = body.id;
      if (!id) return res.status(400).json({ error: "Missing tier id" });

      const updates = {};
      if (body.name !== undefined) {
        const name = String(body.name).trim();
        if (!name) return res.status(400).json({ error: "name cannot be empty" });
        updates.name = name;
      }
      if (body.session_count !== undefined) {
        const n = parseInt(body.session_count, 10);
        if (!Number.isInteger(n) || n <= 0) return res.status(400).json({ error: "Invalid session_count" });
        updates.session_count = n;
      }
      if (body.price_cents !== undefined) {
        const n = parseInt(body.price_cents, 10);
        if (!Number.isInteger(n) || n <= 0) return res.status(400).json({ error: "Invalid price_cents" });
        updates.price_cents = n;
      }
      if (body.sort_order !== undefined) {
        const n = parseInt(body.sort_order, 10);
        updates.sort_order = Number.isInteger(n) ? n : 0;
      }
      if (body.active !== undefined) updates.active = !!body.active;

      if (Object.keys(updates).length === 0) {
        return res.status(400).json({ error: "No fields to update" });
      }

      const { data, error } = await supabase
        .from("session_tiers")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ tier: data });
    }

    if (req.method === "DELETE") {
      const id = (req.query && req.query.id) || (req.body && req.body.id);
      if (!id) return res.status(400).json({ error: "Missing tier id" });
      // Soft-delete: deactivate rather than hard-delete, so past ledger/
      // payment rows that reference this tier_id stay valid.
      const { error } = await supabase.from("session_tiers").update({ active: false }).eq("id", id);
      if (error) throw error;
      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("[admin-tiers] error:", err);
    return res.status(500).json({ error: "Request failed" });
  }
}
