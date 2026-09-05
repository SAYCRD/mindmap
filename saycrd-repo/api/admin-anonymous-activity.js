// api/admin-anonymous-activity.js — read-only summary of guest usage from
// anonymous_session_log, gated by the ADMIN_EMAILS allowlist. Deliberately
// exposes nothing beyond device_id (an opaque, locally-generated string,
// never a person) — this answers "is anyone using the platform before
// creating an account, how many sessions, and when," not "who."
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
    const { data, error } = await sb
      .from("anonymous_session_log")
      .select("device_id, session_number, completed_at")
      .order("completed_at", { ascending: false })
      .limit(2000);
    if (error) throw error;

    const rows = data || [];
    const byDevice = new Map();
    rows.forEach(function (r) {
      const existing = byDevice.get(r.device_id) || { device_id: r.device_id, session_count: 0, first_seen: r.completed_at, last_seen: r.completed_at };
      existing.session_count += 1;
      if (r.completed_at < existing.first_seen) existing.first_seen = r.completed_at;
      if (r.completed_at > existing.last_seen) existing.last_seen = r.completed_at;
      byDevice.set(r.device_id, existing);
    });

    const devices = Array.from(byDevice.values()).sort(function (a, b) {
      return new Date(b.last_seen) - new Date(a.last_seen);
    });

    return res.status(200).json({
      total_sessions: rows.length,
      total_devices: devices.length,
      devices: devices,
    });
  } catch (err) {
    console.error("admin-anonymous-activity error:", err.message);
    return res.status(500).json({ error: "Request failed" });
  }
}
