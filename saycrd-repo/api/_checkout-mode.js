// api/_checkout-mode.js — Stage 2A: the single source of truth for whether
// paid checkout is allowed to run at all.
//
// This resolver FAILS CLOSED. An unset, empty, misspelled, wrongly-cased or
// otherwise unrecognised CHECKOUT_MODE resolves to "disabled", never to a
// permissive value. That property is what makes deploying Stage 2A safe
// before SQUARE_LOCATION_ID is corrected (Stage 2C): with the gate closed,
// api/square-checkout.js returns 503 before it ever calls Square, so the
// known-bad location id is unreachable rather than merely unused.
//
// Modes:
//   "disabled"   — no one can create a Square payment link. The default.
//   "admin_only" — only a Supabase-verified caller whose email is in
//                  ADMIN_EMAILS may create a link (used for Stage 2E's one
//                  controlled purchase).
//   "public"     — any authenticated user may create a link (Stage 2G).
//
// Note that this gate governs LINK CREATION only. api/square-webhook.js is
// deliberately NOT gated on it: a payment that was already made must still
// be credited even if the mode is flipped to "disabled" afterwards, or real
// money would be collected with no entitlement granted.

export const CHECKOUT_MODE_DISABLED = "disabled";
export const CHECKOUT_MODE_ADMIN_ONLY = "admin_only";
export const CHECKOUT_MODE_PUBLIC = "public";

const KNOWN_MODES = new Set([CHECKOUT_MODE_DISABLED, CHECKOUT_MODE_ADMIN_ONLY, CHECKOUT_MODE_PUBLIC]);

export function resolveCheckoutMode(env) {
  const raw = env && env.CHECKOUT_MODE;
  if (typeof raw !== "string") return CHECKOUT_MODE_DISABLED;
  const normalized = raw.trim().toLowerCase();
  if (!KNOWN_MODES.has(normalized)) return CHECKOUT_MODE_DISABLED;
  return normalized;
}

export function isCheckoutEnabled(env) {
  return resolveCheckoutMode(env) !== CHECKOUT_MODE_DISABLED;
}
