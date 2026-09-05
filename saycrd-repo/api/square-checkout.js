// api/square-checkout.js — creates a Square-hosted checkout Payment Link
// for the given tier and records a pending row in square_payments. The
// price charged always comes from the server-side tier lookup, never from
// the client, so a tampered request can't change the amount.
import crypto from "crypto";
import { getServiceClient, getAuthedUser, setCors } from "./_lib.js";

function squareBaseUrl() {
  return process.env.SQUARE_ENVIRONMENT === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const user = await getAuthedUser(req);
  if (!user) return res.status(401).json({ error: "Authentication required" });

  const accessToken = process.env.SQUARE_ACCESS_TOKEN;
  const locationId = process.env.SQUARE_LOCATION_ID;
  if (!accessToken || !locationId) {
    return res.status(500).json({ error: "Square is not configured" });
  }

  const tierId = req.body && req.body.tierId;
  if (!tierId) return res.status(400).json({ error: "Missing tierId" });

  try {
    const supabase = getServiceClient();
    const { data: tier, error: tierError } = await supabase
      .from("session_tiers")
      .select("id, name, session_count, price_cents, currency, active")
      .eq("id", tierId)
      .maybeSingle();

    if (tierError) throw tierError;
    if (!tier || !tier.active) return res.status(404).json({ error: "Session pack not found" });

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const squareRes = await fetch(`${squareBaseUrl()}/v2/online-checkout/payment-links`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": "2025-10-16",
      },
      body: JSON.stringify({
        idempotency_key: crypto.randomUUID(),
        quick_pay: {
          name: tier.name,
          price_money: { amount: tier.price_cents, currency: tier.currency || "USD" },
          location_id: locationId,
        },
        checkout_options: {
          redirect_url: `${origin}/?checkout=return`,
        },
      }),
    });

    const squareData = await squareRes.json();
    if (!squareRes.ok) {
      console.error("[square-checkout] Square API error:", squareData);
      return res.status(502).json({ error: "Payment provider error" });
    }

    const orderId = squareData.payment_link && squareData.payment_link.order_id;
    const checkoutUrl = squareData.payment_link && squareData.payment_link.url;
    if (!orderId || !checkoutUrl) {
      console.error("[square-checkout] unexpected Square response:", squareData);
      return res.status(502).json({ error: "Payment provider response missing fields" });
    }

    const { error: insertError } = await supabase.from("square_payments").insert({
      user_id: user.id,
      tier_id: tier.id,
      square_order_id: orderId,
      amount_cents: tier.price_cents,
      status: "pending",
    });
    if (insertError) throw insertError;

    return res.status(200).json({ checkoutUrl });
  } catch (err) {
    console.error("[square-checkout] error:", err);
    return res.status(500).json({ error: "Checkout failed" });
  }
}
