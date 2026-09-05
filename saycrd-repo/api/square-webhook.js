// api/square-webhook.js — credits a session pack once Square confirms
// payment. Verifies the HMAC-SHA256 signature Square sends (over the exact
// notification URL configured in the Square dashboard + the raw request
// body) before trusting anything in the payload, and is idempotent on
// square_order_id so a replayed `payment.updated` event can never
// double-credit the same purchase.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getServiceClient, setCors } from "./_lib.js";

function getRawBody(req) {
  // The local dev-server shim buffers the body itself before this handler
  // runs and stashes the untouched text on req.rawBody — reuse it there.
  // On real Vercel Node functions the request stream is still untouched at
  // this point (nothing has read req.body yet), so read it directly.
  if (typeof req.rawBody === "string") return Promise.resolve(req.rawBody);
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function isValidSignature(rawBody, notificationUrl, signatureHeader, signatureKey) {
  if (!signatureHeader) return false;
  const hmac = createHmac("sha256", signatureKey);
  hmac.update(notificationUrl + rawBody);
  const expected = hmac.digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;
  if (!signatureKey) {
    console.error("square-webhook: SQUARE_WEBHOOK_SIGNATURE_KEY not configured");
    return res.status(500).json({ error: "Webhook not configured" });
  }

  const rawBody = await getRawBody(req);
  const notificationUrl = `https://${req.headers.host}${req.url}`;
  const signatureHeader = req.headers["x-square-hmacsha256-signature"];

  if (!isValidSignature(rawBody, notificationUrl, signatureHeader, signatureKey)) {
    console.warn("square-webhook: invalid signature");
    return res.status(401).json({ error: "Invalid signature" });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  // Only payment.updated events with a COMPLETED payment actually mean money
  // changed hands — order.created / payment.created fire before that.
  const payment = event && event.data && event.data.object && event.data.object.payment;
  if (!payment || payment.status !== "COMPLETED" || !payment.order_id) {
    return res.status(200).json({ ok: true, ignored: true });
  }

  try {
    const sb = getServiceClient();

    const { data: pendingPayment, error: findErr } = await sb
      .from("square_payments")
      .select("id, user_id, tier_id, status")
      .eq("square_order_id", payment.order_id)
      .maybeSingle();
    if (findErr) throw findErr;

    if (!pendingPayment) {
      console.warn("square-webhook: no matching square_payments row for order", payment.order_id);
      return res.status(200).json({ ok: true, unmatched: true });
    }

    // Idempotency guard: a replayed webhook for an already-credited order is
    // a no-op, not a second credit.
    if (pendingPayment.status === "completed") {
      return res.status(200).json({ ok: true, alreadyProcessed: true });
    }

    const { data: tier, error: tierErr } = await sb
      .from("session_tiers")
      .select("session_count")
      .eq("id", pendingPayment.tier_id)
      .maybeSingle();
    if (tierErr) throw tierErr;

    const sessionCount = (tier && tier.session_count) || 0;

    const { error: updateErr } = await sb
      .from("square_payments")
      .update({
        status: "completed",
        square_payment_id: payment.id,
        raw_payload: event,
        updated_at: new Date().toISOString(),
      })
      .eq("id", pendingPayment.id);
    if (updateErr) throw updateErr;

    if (sessionCount > 0) {
      const { error: creditErr } = await sb.from("credit_ledger").insert({
        user_id: pendingPayment.user_id,
        delta: sessionCount,
        reason: "square_purchase",
        tier_id: pendingPayment.tier_id,
        square_order_id: payment.order_id,
      });
      if (creditErr) throw creditErr;
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("square-webhook error:", err.message);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
}
