// api/admin-tiers.js — CRUD for session_tiers, gated by the ADMIN_EMAILS
// allowlist. The allowlist check is the real security boundary (any
// "Admin" link/button in the UI is just a convenience — see admin-check.js).
// Tiers are soft-deleted (active:false) rather than hard-deleted, because
// credit_ledger / square_payments rows reference tier_id and must keep
// resolving to a valid row for historical order/receipt display.
import { getAuthedUser, getServiceClient, isAdminEmail, setCors } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();

  const user = await getAuthedUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (!isAdminEmail(user.email)) return res.status(403).json({ error: "forbidden" });

  const sb = getServiceClient();

  try {
    if (req.method === "GET") {
      const { data, error } = await sb
        .from("session_tiers")
        .select("id, name, session_count, price_cents, currency, active, sort_order, created_at")
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return res.status(200).json({ tiers: data || [] });
    }

    if (req.method === "POST") {
      const body = req.body || {};
      const name = String(body.name || "").trim();
      const sessionCount = parseInt(body.session_count, 10);
      const priceCents = parseInt(body.price_cents, 10);
      const sortOrder = parseInt(body.sort_order, 10) || 0;

      if (!name || !Number.isInteger(sessionCount) || sessionCount <= 0) {
        return res.status(400).json({ error: "name and a positive integer session_count are required" });
      }
      if (!Number.isInteger(priceCents) || priceCents <= 0) {
        return res.status(400).json({ error: "price_cents must be a positive integer" });
      }

      const { data, error } = await sb
        .from("session_tiers")
        .insert({ name, session_count: sessionCount, price_cents: priceCents, sort_order: sortOrder, active: true })
        .select()
        .single();
      if (error) throw error;
      return res.status(201).json({ tier: data });
    }

    if (req.method === "PATCH") {
      const body = req.body || {};
      const id = body.id;
      if (!id) return res.status(400).json({ error: "id is required" });

      const patch = {};
      if (body.name !== undefined) patch.name = String(body.name).trim();
      if (body.session_count !== undefined) {
        const sc = parseInt(body.session_count, 10);
        if (!Number.isInteger(sc) || sc <= 0) return res.status(400).json({ error: "session_count must be a positive integer" });
        patch.session_count = sc;
      }
      if (body.price_cents !== undefined) {
        const pc = parseInt(body.price_cents, 10);
        if (!Number.isInteger(pc) || pc <= 0) return res.status(400).json({ error: "price_cents must be a positive integer" });
        patch.price_cents = pc;
      }
      if (body.sort_order !== undefined) patch.sort_order = parseInt(body.sort_order, 10) || 0;
      if (body.active !== undefined) patch.active = !!body.active;
      patch.updated_at = new Date().toISOString();

      const { data, error } = await sb.from("session_tiers").update(patch).eq("id", id).select().single();
      if (error) throw error;
      return res.status(200).json({ tier: data });
    }

    if (req.method === "DELETE") {
      const id = (req.query && req.query.id) || (req.body && req.body.id);
      if (!id) return res.status(400).json({ error: "id is required" });

      // Soft-delete only — see file header.
      const { data, error } = await sb
        .from("session_tiers")
        .update({ active: false, updated_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return res.status(200).json({ tier: data });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    console.error("admin-tiers error:", err.message);
    return res.status(500).json({ error: "Request failed" });
  }
}
