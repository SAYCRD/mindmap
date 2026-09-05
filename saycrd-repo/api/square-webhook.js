// api/square-webhook.js — Square webhook receiver (payment.updated events).
// Verifies the HMAC-SHA256 signature over (notification URL + raw body)
// before trusting anything in the payload, and is idempotent by
// square_order_id — a duplicate delivery for an already-paid order is a
// no-op, so replayed webhooks can never double-credit an account.
import crypto from "crypto";
import { getServiceClient } from "./_lib.js";

// Vercel's Node runtime auto-parses req.body as JSON by default, which
// would leave us with a re-serialized (and possibly non-identical) body —
// the signature is computed over the exact raw bytes Square sent, so we
// need the unparsed stream instead.
export const config = {
  api: {
    bodyParser: false,
  },
};

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function verifySignature(rawBody, signatureHeader, notificationUrl, signatureKey) {
  if (!signatureHeader || !signatureKey) return false;
  const hmac = crypto.createHmac("sha256", signatureKey);
  hmac.update(notificationUrl + rawBody);
  const expected = hmac.digest("base64");
  try {
    const a = Buffer.from(expected);
    const b = Buffer.from(signatureHeader);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (e) {
    return false;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  let rawBody;
  try {
    rawBody = await readRawBody(req);
  } catch (err) {
    console.error("[square-webhook] failed to read body:", err);
    return res.status(400).json({ error: "Invalid body" });
  }

  const signatureHeader = req.headers["x-square-hmacsha256-signature"];
  // Must exactly match the notification URL configured in the Square
  // dashboard for this webhook subscription.
  const notificationUrl = process.env.SQUARE_WEBHOOK_URL || `https://${req.headers.host}/api/square-webhook`;
  const signatureKey = process.env.SQUARE_WEBHOOK_SIGNATURE_KEY;

  if (!verifySignature(rawBody, signatureHeader, notificationUrl, signatureKey)) {
    console.error("[square-webhook] signature verification failed");
    return res.status(401).json({ error: "Invalid signature" });
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON" });
  }

  try {
    if (event.type === "payment.updated") {
      const payment = event.data && event.data.object && event.data.object.payment;
      if (payment && payment.status === "COMPLETED" && payment.order_id) {
        const supabase = getServiceClient();

        // Atomic claim: only proceeds if this order wasn't already marked
        // paid. A concurrent/duplicate delivery for the same order gets an
        // empty result here and skips crediting entirely.
        const { data: updatedRows, error: updateError } = await supabase
          .from("square_payments")
          .update({ status: "paid", square_payment_id: payment.id, raw_payload: event })
          .eq("square_order_id", payment.order_id)
          .neq("status", "paid")
          .select("id, user_id, tier_id");
        if (updateError) throw updateError;

        const claimed = (updatedRows || [])[0];
        if (claimed) {
          const { data: tier, error: tierError } = await supabase
            .from("session_tiers")
            .select("session_count")
            .eq("id", claimed.tier_id)
            .maybeSingle();
          if (tierError) throw tierError;

          if (tier) {
            const { error: ledgerError } = await supabase.from("credit_ledger").insert({
              user_id: claimed.user_id,
              delta: tier.session_count,
              reason: "purchase",
              tier_id: claimed.tier_id,
              square_order_id: payment.order_id,
            });
            if (ledgerError) throw ledgerError;
          }
        }
      }
    }
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("[square-webhook] processing error:", err);
    // Non-2xx so Square retries delivery — the update-then-credit above is
    // safe to retry since the "already paid" guard makes it idempotent.
    return res.status(500).json({ error: "Processing error" });
  }
}
