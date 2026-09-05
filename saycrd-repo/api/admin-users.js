// api/admin-users.js — read-only roster of real accounts for the admin
// panel, gated by the ADMIN_EMAILS allowlist (see admin-tiers.js header for
// why that check, not any client-side gate, is the real security boundary).
// Joins auth.users (via the service-role admin API) with free_sessions_used
// and credit_ledger so an admin can see, per account: signup date, free
// sessions used (of 2), current paid credit balance, and last activity —
// without hand-writing SQL every time someone asks "what does this person
// actually have."
import { getAuthedUser, getServiceClient, isAdminEmail, setCors } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthedUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });
  if (!isAdminEmail(user.email)) return res.status(403).json({ error: "forbidden" });

  const sb = getServiceClient();

  try {
    // auth.users isn't exposed over the normal REST/query builder — the
    // admin API is the only supported way to list it.
    const usersRes = await sb.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (usersRes.error) throw usersRes.error;
    const authUsers = usersRes.data.users || [];

    const [freeRes, ledgerRes] = await Promise.all([
      sb.from("free_sessions_used").select("user_id, count, updated_at"),
      sb.from("credit_ledger").select("user_id, delta, created_at"),
    ]);
    if (freeRes.error) throw freeRes.error;
    if (ledgerRes.error) throw ledgerRes.error;

    const freeByUser = new Map((freeRes.data || []).map(function (r) { return [r.user_id, r]; }));
    const ledgerByUser = new Map();
    (ledgerRes.data || []).forEach(function (row) {
      const existing = ledgerByUser.get(row.user_id) || { balance: 0, lastActivity: null };
      existing.balance += Number(row.delta) || 0;
      if (!existing.lastActivity || row.created_at > existing.lastActivity) existing.lastActivity = row.created_at;
      ledgerByUser.set(row.user_id, existing);
    });

    const rows = authUsers.map(function (u) {
      const free = freeByUser.get(u.id);
      const ledger = ledgerByUser.get(u.id);
      return {
        id: u.id,
        email: u.email,
        created_at: u.created_at,
        email_confirmed_at: u.email_confirmed_at || null,
        free_sessions_used: free ? free.count : 0,
        credit_balance: ledger ? ledger.balance : 0,
        last_activity_at: ledger ? ledger.lastActivity : (free ? free.updated_at : null),
      };
    });

    rows.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });

    return res.status(200).json({ users: rows });
  } catch (err) {
    console.error("admin-users error:", err.message);
    return res.status(500).json({ error: "Request failed" });
  }
}
