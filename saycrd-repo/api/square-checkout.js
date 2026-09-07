// api/square-checkout.js — creates a Square-hosted Payment Link for a
// session pack. The price is ALWAYS read server-side from session_tiers —
// never trust a client-supplied amount. Requires SQUARE_ACCESS_TOKEN,
// SQUARE_ENVIRONMENT ("production" or "sandbox"), and SQUARE_LOCATION_ID.
//
// Stage 2A adds two things:
//
// 1. A fail-closed CHECKOUT_MODE gate (api/_checkout-mode.js) evaluated
//    BEFORE any Square call and before any database read. While the mode is
//    "disabled" this route cannot create a payment link at all.
//
// 2. A terms snapshot written onto the pending square_payments row:
//    session_count, currency and square_location_id, alongside the existing
//    amount_cents. The webhook validates the completed payment against this
//    snapshot instead of re-reading session_tiers, so an admin editing a
//    tier's price or session count between purchase and webhook can no
//    longer change what a buyer receives. (That is not hypothetical: an
//    admin-panel edit is what moved the 5-pack from $33 to $24.)
//
// It also closes the orphaned-link hole. Square creates the payment link
// before we persist the pending row, so if that insert fails the link still
// exists and IS PAYABLE by anyone holding the URL — the user's browser may
// already have it, and Square will happily collect on it. Such a link is
// recorded in square_orphaned_links for reconciliation (void it in Square,
// or replay it once a pending row exists) rather than being silently lost.
import { randomUUID } from "node:crypto";
import { getAuthedUser, getServiceClient, isAdminEmail, setCors } from "./_lib.js";
import { CHECKOUT_MODE_ADMIN_ONLY, CHECKOUT_MODE_DISABLED, resolveCheckoutMode } from "./_checkout-mode.js";

const SQUARE_VERSION = "2024-08-21";

function squareBaseUrl(env) {
  return env.SQUARE_ENVIRONMENT === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

export function createSquareCheckoutHandler({
  getAuthedUser,
  getServiceClient,
  env = process.env,
  fetchImpl = fetch,
}) {
  return async function handler(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    // ---- Gate first: no Square call, no DB read, no token use while closed.
    const mode = resolveCheckoutMode(env);
    if (mode === CHECKOUT_MODE_DISABLED) {
      return res.status(503).json({ error: "Checkout is currently unavailable", mode, reason: "checkout_disabled" });
    }

    // ---- Then identity, from the verified Supabase JWT only. The caller's
    // email is never read from the request body or headers.
    const user = await getAuthedUser(req);
    if (!user) return res.status(401).json({ error: "Authentication required" });

    if (mode === CHECKOUT_MODE_ADMIN_ONLY && !isAdminEmail(user.email)) {
      return res.status(403).json({ error: "Checkout is limited to administrators", reason: "admin_only" });
    }

    const accessToken = env.SQUARE_ACCESS_TOKEN;
    const locationId = env.SQUARE_LOCATION_ID;
    if (!accessToken || !locationId) {
      return res.status(500).json({ error: "Square is not configured (SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID)" });
    }

    // Defence in depth: when an expected location is pinned, refuse to create
    // a link against anything else. SQUARE_LOCATION_ID currently holds a
    // Square *application* id (sq0idp-…), not a location id — Stage 2C fixes
    // that. Until then this comparison keeps a mismatch loud rather than
    // letting Square reject the call with an opaque 502.
    const expectedLocationId = env.SQUARE_EXPECTED_LOCATION_ID;
    if (expectedLocationId && expectedLocationId !== locationId) {
      console.error(
        "square-checkout: SQUARE_LOCATION_ID does not match SQUARE_EXPECTED_LOCATION_ID; refusing to create a link"
      );
      return res.status(500).json({ error: "Square location is misconfigured", reason: "location_misconfigured" });
    }

    const tierId = req.body && req.body.tierId;
    if (!tierId) return res.status(400).json({ error: "tierId is required" });

    let sb;
    let tier;
    try {
      sb = getServiceClient();

      const { data: tierRow, error: tierErr } = await sb
        .from("session_tiers")
        .select("id, name, session_count, price_cents, currency, active")
        .eq("id", tierId)
        .eq("active", true)
        .maybeSingle();
      if (tierErr) throw tierErr;
      if (!tierRow) return res.status(404).json({ error: "Session pack not found" });
      tier = tierRow;

      if (!Number.isInteger(tier.session_count) || tier.session_count <= 0) {
        console.error("square-checkout: tier has a non-positive session_count", tier.id);
        return res.status(500).json({ error: "Session pack is misconfigured", reason: "invalid_tier" });
      }
      if (!Number.isInteger(tier.price_cents) || tier.price_cents <= 0) {
        console.error("square-checkout: tier has a non-positive price_cents", tier.id);
        return res.status(500).json({ error: "Session pack is misconfigured", reason: "invalid_tier" });
      }
    } catch (err) {
      console.error("square-checkout error (tier lookup):", err.message);
      return res.status(500).json({ error: "Failed to start checkout" });
    }

    const currency = (tier.currency || "usd").toUpperCase();
    const idempotencyKey = randomUUID();
    const origin = req.headers.origin || `https://${req.headers.host}`;

    let paymentLink;
    try {
      const squareRes = await fetchImpl(`${squareBaseUrl(env)}/v2/online-checkout/payment-links`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
          "Square-Version": SQUARE_VERSION,
        },
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          quick_pay: {
            name: tier.name,
            price_money: { amount: tier.price_cents, currency },
            location_id: locationId,
          },
          checkout_options: {
            redirect_url: `${origin}/?checkout_return=1`,
          },
        }),
      });

      const squareData = await squareRes.json();
      if (!squareRes.ok) {
        console.error("Square payment-link error:", JSON.stringify(squareData));
        return res.status(502).json({ error: "Failed to create checkout" });
      }

      paymentLink = squareData.payment_link;
      if (!paymentLink || !paymentLink.order_id || !paymentLink.url) {
        console.error("Square payment-link missing order_id/url:", JSON.stringify(squareData));
        return res.status(502).json({ error: "Failed to create checkout" });
      }
    } catch (err) {
      console.error("square-checkout error (Square call):", err.message);
      return res.status(502).json({ error: "Failed to create checkout" });
    }

    // From here on a payable link EXISTS in Square. Any failure below must be
    // recorded, never swallowed.
    const orderId = paymentLink.order_id;

    try {
      const { error: insertErr } = await sb.from("square_payments").insert({
        user_id: user.id,
        tier_id: tier.id,
        square_order_id: orderId,
        square_payment_id: null,
        amount_cents: tier.price_cents,
        currency,
        session_count: tier.session_count,
        square_location_id: locationId,
        status: "pending",
      });
      if (insertErr) throw insertErr;
    } catch (err) {
      console.error(
        `square-checkout: ORPHANED PAYABLE LINK — pending row insert failed for square_order_id=${orderId}: ${err.message}`
      );
      try {
        const { error: orphanErr } = await sb.rpc("record_square_orphaned_link", {
          p_square_order_id: orderId,
          p_square_payment_link_id: paymentLink.id || null,
          p_checkout_url: paymentLink.url,
          p_user_id: user.id,
          p_tier_id: tier.id,
          p_amount_cents: tier.price_cents,
          p_currency: currency,
          p_square_location_id: locationId,
          p_session_count: tier.session_count,
          p_failure_code: "pending_insert_failed",
        });
        if (orphanErr) {
          console.error("square-checkout: failed to record orphaned link:", orphanErr.message);
        }
      } catch (recordErr) {
        console.error("square-checkout: failed to record orphaned link:", recordErr.message);
      }
      return res.status(500).json({ error: "Failed to start checkout", reason: "pending_insert_failed" });
    }

    return res.status(200).json({ url: paymentLink.url });
  };
}

const handler = createSquareCheckoutHandler({ getAuthedUser, getServiceClient });
export default handler;
