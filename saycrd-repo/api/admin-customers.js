// api/admin-customers.js — admin-only read view of customers: free-session
// usage, paid credit balance, lifetime spend, and purchase count. Protected
// by the same ADMIN_EMAILS allowlist as api/admin-tiers.js, checked against
// the caller's Supabase-verified identity — the client-side "show the admin
// link" check is UX only, this server-side check is the real boundary.
import { getServiceClient, getAuthedUser, isAdminEmail, setCors } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthedUser(req);
  if (!user || !isAdminEmail(user.email)) {
    return res.status(403).json({ error: "Admin access required" });
  }

  const supabase = getServiceClient();

  try {
    const [freeRows, ledgerRows, paymentRows] = await Promise.all([
      supabase.from("free_sessions_used").select("user_id, count, updated_at"),
      supabase.from("credit_ledger").select("user_id, delta, created_at"),
      supabase.from("square_payments").select("user_id, amount_cents, status, created_at"),
    ]);
    if (freeRows.error) throw freeRows.error;
    if (ledgerRows.error) throw ledgerRows.error;
    if (paymentRows.error) throw paymentRows.error;

    const byUser = new Map();
    function ensure(id) {
      if (!byUser.has(id)) {
        byUser.set(id, {
          user_id: id,
          free_sessions_used: 0,
          paid_balance: 0,
          lifetime_spent_cents: 0,
          purchases: 0,
          last_activity: null,
        });
      }
      return byUser.get(id);
    }
    function bumpActivity(u, ts) {
      if (!ts) return;
      if (!u.last_activity || new Date(ts) > new Date(u.last_activity)) u.last_activity = ts;
    }

    (freeRows.data || []).forEach((r) => {
      const u = ensure(r.user_id);
      u.free_sessions_used = r.count;
      bumpActivity(u, r.updated_at);
    });
    (ledgerRows.data || []).forEach((r) => {
      const u = ensure(r.user_id);
      u.paid_balance += r.delta;
      bumpActivity(u, r.created_at);
    });
    (paymentRows.data || []).forEach((r) => {
      const u = ensure(r.user_id);
      if (r.status === "paid") {
        u.lifetime_spent_cents += r.amount_cents;
        u.purchases += 1;
      }
      bumpActivity(u, r.created_at);
    });

    const ids = Array.from(byUser.keys());
    const emailById = {};
    await Promise.all(
      ids.map(async (id) => {
        try {
          const { data, error } = await supabase.auth.admin.getUserById(id);
          if (!error && data && data.user) emailById[id] = data.user.email || "";
        } catch (e) {
          // If a lookup fails for one id, still show the row with a
          // placeholder rather than failing the whole list.
        }
      })
    );

    const customers = ids
      .map((id) => {
        const u = byUser.get(id);
        return {
          user_id: id,
          email: emailById[id] || "(unknown)",
          free_sessions_used: u.free_sessions_used,
          paid_balance: u.paid_balance,
          lifetime_spent_cents: u.lifetime_spent_cents,
          purchases: u.purchases,
          last_activity: u.last_activity,
        };
      })
      .sort((a, b) => new Date(b.last_activity || 0) - new Date(a.last_activity || 0));

    return res.status(200).json({ customers });
  } catch (err) {
    console.error("[admin-customers] error:", err);
    return res.status(500).json({ error: "Request failed" });
  }
}
