// api/square-webhook.js — credits a session pack once Square confirms
// payment.
//
// Stage 2A rewrote the money-handling half of this route. Previously it
// marked square_payments paid and inserted the credit_ledger row as two
// separate round trips, so a failure between them left real money collected
// with status='paid' and no entitlement — and the replay guard then saw
// "already handled" and skipped recovery forever. Both writes now happen
// inside one Postgres transaction via the process_square_payment RPC, which
// commits them together or not at all, and returns an explicit result code.
//
// What is verified here, before the RPC is called:
//   * the HMAC-SHA256 signature, computed over the EXACT pinned
//     SQUARE_WEBHOOK_URL + raw body. Never over req.headers.host: the
//     registered subscription URL and the host actually serving the request
//     differ (apex vs www, and the apex 308-redirects), so a host-derived
//     URL can never match the value Square signed with.
//   * that Square reports payment.status === "COMPLETED". Nothing else
//     means money changed hands.
//   * that the event carries a usable order id, payment id, positive
//     integer amount, currency and location id.
//   * that the location matches SQUARE_EXPECTED_LOCATION_ID when pinned.
//
// What the RPC verifies (against the server-created pending row, never
// against webhook metadata): amount, currency, location, payment id, user,
// tier and credit grant. See the migration for the full contract.
//
// Anything that is not a clean credit or a verified replay is recorded in
// square_webhook_dead_letter — keyed on Square's own event id, so a retried
// event updates one row instead of accumulating duplicates — and answered
// with a status code that tells Square whether to retry (503) or stop and
// wait for a human (409). It is never answered with a bare 200, which would
// silently end Square's retries and discard the event.
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
  const b = Buffer.from(String(signatureHeader));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// Only the fields needed to investigate and reconcile a payment. Square's
// payment object also carries buyer identity, card fingerprints, billing
// address and risk evaluation — none of which we need, so none of which we
// store. This summary is what goes into square_payments.raw_payload and the
// dead-letter row, in place of the whole event.
export function summarizeSquarePayment(event, payment) {
  const amountMoney = (payment && payment.amount_money) || {};
  return {
    event_id: (event && event.event_id) || null,
    event_type: (event && event.type) || null,
    payment_id: (payment && payment.id) || null,
    order_id: (payment && payment.order_id) || null,
    payment_status: (payment && payment.status) || null,
    amount_cents: typeof amountMoney.amount === "number" ? amountMoney.amount : null,
    currency: amountMoney.currency || null,
    location_id: (payment && payment.location_id) || null,
    payment_created_at: (payment && payment.created_at) || null,
    payment_updated_at: (payment && payment.updated_at) || null,
    receipt_url: (payment && payment.receipt_url) || null,
  };
}

// Square supplies event_id on every webhook. If it is ever absent we derive
// a stable key from the event's own identifiers so retries of that same
// event still collapse onto one dead-letter row rather than inserting a new
// row per delivery.
export function deadLetterEventId(event, payment) {
  const explicit = event && event.event_id;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  const type = (event && event.type) || "unknown";
  const order = (payment && payment.order_id) || "no-order";
  const pay = (payment && payment.id) || "no-payment";
  return `derived:${type}:${order}:${pay}`;
}

// Result codes the RPC can return, and how each is answered.
//   503 → transient or awaiting-correlation; Square SHOULD retry.
//   409 → a genuine conflict a human must look at; retrying cannot fix it.
const RETRYABLE_RESULTS = new Set(["unmatched", "retry_needed"]);

export function createSquareWebhookHandler({ getServiceClient, env = process.env, readRawBody = getRawBody }) {
  return async function handler(req, res) {
    setCors(res);
    if (req.method === "OPTIONS") return res.status(200).end();
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const signatureKey = env.SQUARE_WEBHOOK_SIGNATURE_KEY;
    if (!signatureKey) {
      console.error("square-webhook: SQUARE_WEBHOOK_SIGNATURE_KEY not configured");
      return res.status(500).json({ error: "Webhook not configured" });
    }

    // Pinned, never derived from the request. Fail closed if unset: guessing
    // the URL would mean either rejecting every real event or, worse,
    // accepting one signed for a different endpoint.
    const notificationUrl = env.SQUARE_WEBHOOK_URL;
    if (!notificationUrl) {
      console.error("square-webhook: SQUARE_WEBHOOK_URL not configured");
      return res.status(500).json({ error: "Webhook not configured" });
    }

    const rawBody = await readRawBody(req);
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

    const payment = event && event.data && event.data.object && event.data.object.payment;

    // Not a payment event at all (order.created, payment.created, refunds,
    // and the ~150 other subscribed types). Nothing owed, nothing to record.
    if (!payment) {
      return res.status(200).json({ ok: true, ignored: true, reason: "not_a_payment_event" });
    }

    // Square must itself report the payment as COMPLETED. Any other status
    // (APPROVED, PENDING, CANCELED, FAILED) means money has not changed
    // hands, so no credit may be granted.
    if (payment.status !== "COMPLETED") {
      return res.status(200).json({ ok: true, ignored: true, reason: "payment_not_completed" });
    }

    const summary = summarizeSquarePayment(event, payment);
    const eventId = deadLetterEventId(event, payment);

    let sb;
    try {
      sb = getServiceClient();
    } catch (err) {
      console.error("square-webhook: service client unavailable:", err.message);
      return res.status(500).json({ error: "Webhook processing failed" });
    }

    async function deadLetter(resultCode, httpStatus) {
      try {
        const { error } = await sb.rpc("record_square_webhook_dead_letter", {
          p_square_event_id: eventId,
          p_event_type: summary.event_type,
          p_result_code: resultCode,
          p_http_status: httpStatus,
          p_square_order_id: summary.order_id,
          p_square_payment_id: summary.payment_id,
          p_amount_cents: summary.amount_cents,
          p_currency: summary.currency,
          p_square_location_id: summary.location_id,
          p_payment_summary: summary,
        });
        if (error) console.error("square-webhook: dead-letter write failed:", error.message);
      } catch (err) {
        console.error("square-webhook: dead-letter write failed:", err.message);
      }
    }

    // Shape validation. A malformed completed payment cannot be credited and
    // will not become valid on retry, so it is a 409 for human review.
    const shapeProblem =
      !summary.order_id
        ? "invalid_order_id"
        : !summary.payment_id
          ? "invalid_payment_id"
          : !Number.isInteger(summary.amount_cents) || summary.amount_cents <= 0
            ? "invalid_amount"
            : !summary.currency
              ? "invalid_currency"
              : !summary.location_id
                ? "invalid_location"
                : null;

    if (shapeProblem) {
      console.error(`square-webhook: ${shapeProblem} for event ${eventId}`);
      await deadLetter(shapeProblem, 409);
      return res.status(409).json({ ok: false, result: shapeProblem });
    }

    // Pinned production location, when configured.
    const expectedLocationId = env.SQUARE_EXPECTED_LOCATION_ID;
    if (expectedLocationId && summary.location_id !== expectedLocationId) {
      console.error(`square-webhook: location_mismatch for event ${eventId}`);
      await deadLetter("location_mismatch", 409);
      return res.status(409).json({ ok: false, result: "location_mismatch" });
    }

    let result;
    try {
      const { data, error } = await sb.rpc("process_square_payment", {
        p_square_order_id: summary.order_id,
        p_square_payment_id: summary.payment_id,
        p_amount_cents: summary.amount_cents,
        p_currency: summary.currency,
        p_location_id: summary.location_id,
        p_payment_summary: summary,
      });
      if (error) throw error;
      result = data;
    } catch (err) {
      console.error("square-webhook: process_square_payment failed:", err.message);
      await deadLetter("rpc_error", 503);
      return res.status(503).json({ ok: false, result: "rpc_error" });
    }

    const code = (result && result.result) || "unknown";

    if (code === "credited" || code === "already_processed") {
      if (result.repaired) {
        console.warn(
          `square-webhook: repaired a previously partial payment for order ${summary.order_id} (credits already granted, status corrected)`
        );
      }
      return res.status(200).json({
        ok: true,
        result: code,
        credits: typeof result.credits === "number" ? result.credits : null,
        repaired: !!result.repaired,
      });
    }

    if (RETRYABLE_RESULTS.has(code)) {
      // "unmatched" is the case where Square has a completed payment but no
      // pending row exists yet (an orphaned link that was paid, or a write
      // that has not landed). Answering 200 here would permanently discard a
      // real payment, so answer 503 and let Square keep retrying.
      console.error(`square-webhook: ${code} for order ${summary.order_id}`);
      await deadLetter(code, 503);
      return res.status(503).json({ ok: false, result: code });
    }

    console.error(`square-webhook: ${code} for order ${summary.order_id}`);
    await deadLetter(code, 409);
    return res.status(409).json({ ok: false, result: code });
  };
}

const handler = createSquareWebhookHandler({ getServiceClient });
export default handler;
