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
// Stage 2B adds the refund half. It is evaluated BEFORE the credit path,
// because Square never marks a refunded payment as anything other than
// COMPLETED — a refund arrives as a payment.updated whose payment still says
// COMPLETED and merely gains refunded_money / refund_ids. Checking the credit
// path first would therefore read a refund as a fresh purchase. See
// api/_square-refund.js for how the authoritative refund status is obtained,
// and process_square_refund for what may be clawed back.
//
// Stage 2C makes that claw-back cumulative. Refunds are measured against the
// ORDER rather than the individual event, so a purchase refunded in
// instalments removes credits once the running total reaches the purchase
// price — and exactly once, whichever delivery happens to cross the line.
// Partial refunds are answered 200 and preserved for reconciliation; a
// running total that exceeds the purchase price is answered 409 and flagged.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getServiceClient, setCors } from "./_lib.js";
import {
  detectRefundSignal,
  fetchSquareRefund,
  refundDeadLetterEventId,
  refundShapeProblem,
  summarizeSquareRefund,
} from "./_square-refund.js";

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

// Refund outcomes that mean "handled, nothing further owed". Note that
// ambiguous_attribution and recorded_partial are successes here even though
// they change no credits: the refund IS recorded, with requires_review set,
// and Square must stop retrying. The open money question lives in
// square_refunds, not in Square's retry queue.
//
// recorded_partial is emphatically not an error under Stage 2C — it is the
// correct outcome for an instalment refund. A later refund on the same order
// can push the cumulative total to the purchase price and trigger the
// claw-back then. Retrying a partial would achieve nothing, because the RPC
// counts each refund id exactly once no matter how often it is delivered.
const REFUND_HANDLED_RESULTS = new Set([
  "credits_removed",
  "no_credits_to_remove",
  "ambiguous_attribution",
  "recorded_partial",
  "recorded_not_completed",
  "already_processed",
]);

// A refund whose payment we cannot correlate yet is real money in flight;
// Square SHOULD keep retrying rather than have us discard it.
const REFUND_RETRYABLE_RESULTS = new Set(["unmatched_payment", "retry_needed"]);

// Deliberately in NEITHER set above: conflict_over_refund. The RPC has already
// persisted the event with requires_review, so it is preserved for
// reconciliation, but it is answered 409 rather than 200 — a cumulative
// refunded total above the purchase price cannot arise from Square operating
// normally, so the inputs are wrong and redelivering the same wrong inputs
// cannot fix them. Named here so the intent is explicit rather than an
// accident of set membership.
const REFUND_FLAGGED_RESULTS = new Set(["conflict_over_refund"]);

// Processes every refund carried by one event. Each refund id is independent
// and separately idempotent, so a 503 that makes Square redeliver the whole
// event cannot double-process the ones that already succeeded.
async function handleRefundEvent({ res, sb, env, event, refundSignal, makeDeadLetter, fetchRefundImpl }) {
  const refunds = [];

  if (refundSignal.kind === "refund_object") {
    refunds.push(refundSignal.refund);
  } else {
    // payment.updated proves a refund exists but not that it completed, so
    // each id is resolved to its authoritative PaymentRefund.
    if (refundSignal.refundIds.length === 0) {
      // refunded_money is set but Square has not propagated refund_ids yet.
      // There is nothing to look up, and guessing is not an option.
      const summary = summarizeSquareRefund(event, null);
      const eventId = refundDeadLetterEventId(event, summary);
      await makeDeadLetter(eventId, summary)("refund_ids_missing", 503);
      return res.status(503).json({ ok: false, result: "refund_ids_missing" });
    }

    for (const refundId of refundSignal.refundIds) {
      const looked = await fetchSquareRefund(refundId, { env, fetchImpl: fetchRefundImpl });
      if (!looked.ok) {
        // Unverifiable status. Answer 503 so Square redelivers rather than
        // deciding a money question from an unconfirmed signal.
        const summary = { ...summarizeSquareRefund(event, null), refund_id: refundId };
        const eventId = refundDeadLetterEventId(event, summary);
        await makeDeadLetter(eventId, summary)(looked.reason, 503);
        return res.status(503).json({ ok: false, result: looked.reason });
      }
      refunds.push(looked.refund);
    }
  }

  const results = [];

  for (const refund of refunds) {
    const summary = summarizeSquareRefund(event, refund);
    const eventId = refundDeadLetterEventId(event, summary);
    const deadLetter = makeDeadLetter(eventId, summary);

    const shape = refundShapeProblem(summary);
    if (shape) {
      console.error(`square-webhook: refund ${shape} for event ${eventId}`);
      await deadLetter(shape, 409);
      results.push({ refund_id: summary.refund_id, result: shape, status: 409 });
      continue;
    }

    const expectedLocationId = env.SQUARE_EXPECTED_LOCATION_ID;
    if (expectedLocationId && summary.location_id && summary.location_id !== expectedLocationId) {
      console.error(`square-webhook: refund location_mismatch for event ${eventId}`);
      await deadLetter("location_mismatch", 409);
      results.push({ refund_id: summary.refund_id, result: "location_mismatch", status: 409 });
      continue;
    }

    let data;
    try {
      const rpc = await sb.rpc("process_square_refund", {
        p_square_refund_id: summary.refund_id,
        p_square_payment_id: summary.payment_id,
        p_refund_status: summary.refund_status,
        p_amount_cents: summary.amount_cents,
        p_currency: summary.currency,
        p_square_order_id: summary.order_id,
        p_location_id: summary.location_id,
        p_refund_summary: summary,
      });
      if (rpc.error) throw rpc.error;
      data = rpc.data;
    } catch (err) {
      console.error("square-webhook: process_square_refund failed:", err.message);
      await deadLetter("refund_rpc_error", 503);
      results.push({ refund_id: summary.refund_id, result: "refund_rpc_error", status: 503 });
      continue;
    }

    const code = (data && data.result) || "unknown";

    // Cumulative position of the order after this event, as decided by the
    // RPC under its lock. Logged and echoed because "why was this partial?"
    // is otherwise unanswerable from the outside.
    const cumulative = data && typeof data.cumulative_refunded_cents === "number"
      ? data.cumulative_refunded_cents
      : null;
    const purchaseCents = data && typeof data.purchase_amount_cents === "number"
      ? data.purchase_amount_cents
      : null;
    const remaining = data && typeof data.remaining_cents === "number" ? data.remaining_cents : null;

    if (REFUND_HANDLED_RESULTS.has(code)) {
      if (code === "credits_removed") {
        console.warn(
          `square-webhook: refund ${summary.refund_id} completed the full refund of order ${summary.order_id} (${cumulative}/${purchaseCents} cents) and removed ${data.credits_removed} unused credit(s) (basis ${data.attribution_basis})`
        );
      } else if (code === "recorded_partial") {
        // Expected, non-alarming path. Logged at info so instalment refunds
        // are traceable without polluting the warning stream.
        console.log(
          `square-webhook: refund ${summary.refund_id} is a partial refund of order ${summary.order_id} (${cumulative}/${purchaseCents} cents refunded, ${remaining} remaining); credits unchanged pending full refund`
        );
      }
      if (data && data.requires_review && code !== "recorded_partial") {
        console.warn(
          `square-webhook: refund ${summary.refund_id} needs manual review (${code}); no credits changed`
        );
      }
      results.push({
        refund_id: summary.refund_id,
        result: code,
        status: 200,
        credits_removed: typeof data.credits_removed === "number" ? data.credits_removed : null,
        attribution_basis: (data && data.attribution_basis) || null,
        requires_review: !!(data && data.requires_review),
        cumulative_refunded_cents: cumulative,
        purchase_amount_cents: purchaseCents,
        remaining_cents: remaining,
        is_full_refund: !!(data && data.is_full_refund),
      });
      continue;
    }

    const status = REFUND_RETRYABLE_RESULTS.has(code) ? 503 : 409;
    if (REFUND_FLAGGED_RESULTS.has(code)) {
      console.error(
        `square-webhook: refund ${summary.refund_id} would take order ${summary.order_id} to ${cumulative} cents refunded against a ${purchaseCents} cent purchase; recorded for review, no credits changed`
      );
    } else {
      console.error(`square-webhook: refund ${code} for order ${summary.order_id}`);
    }
    await deadLetter(code, status);
    results.push({
      refund_id: summary.refund_id,
      result: code,
      status,
      cumulative_refunded_cents: cumulative,
      purchase_amount_cents: purchaseCents,
    });
  }

  // Retry beats conflict: a redelivery re-runs the conflicting refunds
  // harmlessly, whereas swallowing a retryable one loses it.
  const httpStatus = results.some((r) => r.status === 503)
    ? 503
    : results.some((r) => r.status === 409)
      ? 409
      : 200;

  return res.status(httpStatus).json({ ok: httpStatus === 200, refunds: results });
}

export function createSquareWebhookHandler({
  getServiceClient,
  env = process.env,
  readRawBody = getRawBody,
  fetchRefundImpl = fetch,
}) {
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

    let sb;
    try {
      sb = getServiceClient();
    } catch (err) {
      console.error("square-webhook: service client unavailable:", err.message);
      return res.status(500).json({ error: "Webhook processing failed" });
    }

    // Bound to one event id and summary. Both the credit and the refund path
    // record through this, so an event that cannot be handled is never
    // answered with a bare 200 that would end Square's retries.
    function makeDeadLetter(eventId, summary) {
      return async function deadLetter(resultCode, httpStatus) {
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
      };
    }

    // ---- Refund path, evaluated before the credit path. A refunded payment
    // still reports status COMPLETED, so the order of these two branches is
    // what stops a refund being processed as a purchase.
    const refundSignal = detectRefundSignal(event);
    if (refundSignal) {
      return await handleRefundEvent({ res, sb, env, event, refundSignal, makeDeadLetter, fetchRefundImpl });
    }

    const payment = event && event.data && event.data.object && event.data.object.payment;

    // Not a payment event at all (order.created, payment.created, and the
    // ~150 other subscribed types). Nothing owed, nothing to record.
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
    const deadLetter = makeDeadLetter(eventId, summary);

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
