// api/square-checkout.js — creates a Square-hosted Payment Link for a
// session pack. The price is ALWAYS read server-side from session_tiers —
// never trust a client-supplied amount. Requires SQUARE_ACCESS_TOKEN,
// SQUARE_ENVIRONMENT ("production" or "sandbox"), and SQUARE_LOCATION_ID.
import { randomUUID } from "node:crypto";
import { getAuthedUser, getServiceClient, setCors } from "./_lib.js";

const SQUARE_VERSION = "2024-08-21";

function squareBaseUrl() {
  return process.env.SQUARE_ENVIRONMENT === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!accessToken || !locationId) {
    return res.status(500).json({ error: "Square is not configured (SQUARE_ACCESS_TOKEN / SQUARE_LOCATION_ID)" });
  }

  const user = await getAuthedUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  const tierId = req.body && req.body.tierId;
  if (!tierId) return res.status(400).json({ error: "tierId is required" });

  try {
    const sb = getServiceClient();

    const { data: tier, error: tierErr } = await sb
      .from("session_tiers")
      .select("id, name, session_count, price_cents, currency, active")
      .eq("id", tierId)
      .eq("active", true)
      .maybeSingle();
    if (tierErr) throw tierErr;
    if (!tier) return res.status(404).json({ error: "Session pack not found" });

    const origin = req.headers.origin || `https://${req.headers.host}`;
    const idempotencyKey = randomUUID();

    const squareRes = await fetch(`${squareBaseUrl()}/v2/online-checkout/payment-links`, {
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
          price_money: { amount: tier.price_cents, currency: (tier.currency || "usd").toUpperCase() },
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

    const paymentLink = squareData.payment_link;
    const orderId = paymentLink && paymentLink.order_id;
    if (!orderId || !paymentLink.url) {
      console.error("Square payment-link missing order_id/url:", JSON.stringify(squareData));
      return res.status(502).json({ error: "Failed to create checkout" });
    }

    // Record the pending payment now so the webhook can find it by
    // square_order_id (its idempotency key) when the payment completes.
    const { error: insertErr } = await sb.from("square_payments").insert({
      user_id: user.id,
      tier_id: tier.id,
      square_order_id: orderId,
      amount_cents: tier.price_cents,
      status: "pending",
    });
    if (insertErr) throw insertErr;

    return res.status(200).json({ url: paymentLink.url });
  } catch (err) {
    console.error("square-checkout error:", err.message);
    return res.status(500).json({ error: "Failed to start checkout" });
  }
}
