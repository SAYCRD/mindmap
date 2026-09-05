// api/admin-check.js — lets the client decide whether to show the
// "Admin: Session Packs" link at all, WITHOUT ever exposing the ADMIN_EMAILS
// allowlist itself. This is a UX convenience only, not a security boundary —
// admin-tiers.js re-checks the allowlist server-side on every request, which
// is the real boundary.
import { getAuthedUser, isAdminEmail, setCors } from "./_lib.js";

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthedUser(req);
  if (!user) return res.status(200).json({ isAdmin: false });

  return res.status(200).json({ isAdmin: isAdminEmail(user.email) });
}
