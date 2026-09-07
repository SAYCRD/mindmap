// api/checkout-availability.js — Stage 2A: lets the client ask whether the
// paywall's buy buttons should be shown at all, so a user is told "checkout
// is unavailable" up front instead of clicking Buy and getting a 503.
//
// This is a UX convenience ONLY and is never the security boundary. The real
// boundary is enforced server-side inside api/square-checkout.js, which
// independently re-resolves the mode and re-verifies the caller's identity
// on every request. Mirrors api/admin-check.js: a caller may freely lie to
// this endpoint (or skip it entirely) and gain nothing.
import { getAuthedUser, isAdminEmail, setCors } from "./_lib.js";
import { CHECKOUT_MODE_ADMIN_ONLY, CHECKOUT_MODE_PUBLIC, resolveCheckoutMode } from "./_checkout-mode.js";

export function createCheckoutAvailabilityHandler({ getAuthedUser, env = process.env }) {
  return async function handler(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const mode = resolveCheckoutMode(env);

    if (mode === CHECKOUT_MODE_PUBLIC) {
      // Still requires an authenticated user to actually buy (square-checkout
      // enforces that), so report availability against the caller's identity.
      const user = await getAuthedUser(req);
      return res.status(200).json({ mode, available: !!user, reason: user ? null : "authentication_required" });
    }

    if (mode === CHECKOUT_MODE_ADMIN_ONLY) {
      const user = await getAuthedUser(req);
      if (!user) return res.status(200).json({ mode, available: false, reason: "authentication_required" });
      const allowed = isAdminEmail(user.email);
      return res.status(200).json({ mode, available: allowed, reason: allowed ? null : "admin_only" });
    }

    return res.status(200).json({ mode, available: false, reason: "checkout_disabled" });
  };
}

const handler = createCheckoutAvailabilityHandler({ getAuthedUser });
export default handler;
