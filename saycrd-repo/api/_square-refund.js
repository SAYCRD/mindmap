// api/_square-refund.js — Stage 2B. Pure helpers for turning a Square webhook
// event into the refund facts process_square_refund needs.
//
// Two shapes have to be understood here, because Square expresses a refund in
// two different places and only one of them is authoritative.
//
// 1. refund.updated / refund.created — data.object.refund is a PaymentRefund,
//    and it carries its OWN status: PENDING | COMPLETED | REJECTED | FAILED.
//    This is authoritative and needs no follow-up call.
//
// 2. payment.updated — data.object.payment. Square never sets a "REFUNDED"
//    payment status: a refunded payment stays COMPLETED and merely gains
//    refunded_money and refund_ids. So this event can tell us a refund
//    EXISTS, but it cannot tell us whether that refund actually completed —
//    a PENDING, REJECTED or FAILED refund produces the same signal shape.
//    Removing credits on that basis would mean clawing back for a refund
//    Square later rejected, so the ids are resolved against
//    GET /v2/refunds/{id} to obtain the real status.
//
// The subscription is currently payment.updated-only, which makes (2) the
// live path and (1) the one that becomes live if refund.updated is ever added.
// Both are supported so activation order does not matter.

// Only what is needed to reconcile a claw-back. Square's refund object also
// carries processing_fee breakdowns and a merchant-entered `reason` free-text
// field (which can contain anything, including customer details), and the
// payment object carries buyer identity, card fingerprints and billing
// address. None of that is needed here, so none of it is stored.
export function summarizeSquareRefund(event, refund) {
  const amountMoney = (refund && refund.amount_money) || {};
  return {
    event_id: (event && event.event_id) || null,
    event_type: (event && event.type) || null,
    refund_id: (refund && refund.id) || null,
    payment_id: (refund && refund.payment_id) || null,
    order_id: (refund && refund.order_id) || null,
    refund_status: (refund && refund.status) || null,
    amount_cents: typeof amountMoney.amount === "number" ? amountMoney.amount : null,
    currency: amountMoney.currency || null,
    location_id: (refund && refund.location_id) || null,
    refund_created_at: (refund && refund.created_at) || null,
    refund_updated_at: (refund && refund.updated_at) || null,
  };
}

// Does this event concern a refund at all, and if so how do we learn the
// authoritative status?
//
//   { kind: "refund_object", refund }        -> status is already in hand
//   { kind: "payment_signal", refundIds }    -> must be resolved via the API
//   null                                     -> not refund-related
export function detectRefundSignal(event) {
  const object = (event && event.data && event.data.object) || {};

  if (object.refund) {
    return { kind: "refund_object", refund: object.refund, refundIds: [] };
  }

  const payment = object.payment;
  if (!payment) return null;

  const refundedMoney = payment.refunded_money || {};
  const refundedCents = typeof refundedMoney.amount === "number" ? refundedMoney.amount : 0;
  const refundIds = Array.isArray(payment.refund_ids)
    ? payment.refund_ids.filter((id) => typeof id === "string" && id.trim())
    : [];

  // Either marker alone is enough to treat the event as refund-related.
  // refunded_money can be present before refund_ids propagates, and a
  // rejected refund can leave an id with a zero total.
  if (refundedCents > 0 || refundIds.length > 0) {
    return { kind: "payment_signal", refund: null, refundIds, refundedCents };
  }

  return null;
}

// Stable dead-letter key for a refund event, mirroring deadLetterEventId for
// payments: prefer Square's own event id, and fall back to the refund's
// identifiers so retries of one event still collapse onto one row.
export function refundDeadLetterEventId(event, summary) {
  const explicit = event && event.event_id;
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  const type = (event && event.type) || "unknown";
  const refund = (summary && summary.refund_id) || "no-refund";
  const payment = (summary && summary.payment_id) || "no-payment";
  return `derived:${type}:${refund}:${payment}`;
}

// A malformed refund cannot be reconciled and will not become valid on retry.
export function refundShapeProblem(summary) {
  if (!summary.refund_id) return "invalid_refund_id";
  if (!summary.payment_id) return "invalid_payment_id";
  if (!summary.refund_status) return "invalid_refund_status";
  if (!Number.isInteger(summary.amount_cents) || summary.amount_cents <= 0) return "invalid_amount";
  if (!summary.currency) return "invalid_currency";
  return null;
}

export const SQUARE_REFUND_VERSION = "2024-08-21";

export function squareRefundBaseUrl(env) {
  return env.SQUARE_ENVIRONMENT === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

// Resolves one refund id to its authoritative PaymentRefund.
//
// Returns { ok: true, refund } or { ok: false, reason }. A failure is never
// treated as "no refund": the caller answers 503 so Square retries, because
// the alternative is deciding a money question from an unverified signal.
export async function fetchSquareRefund(refundId, { env, fetchImpl = fetch }) {
  const accessToken = env.SQUARE_ACCESS_TOKEN;
  if (!accessToken) return { ok: false, reason: "square_not_configured" };

  let res;
  try {
    res = await fetchImpl(`${squareRefundBaseUrl(env)}/v2/refunds/${encodeURIComponent(refundId)}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": SQUARE_REFUND_VERSION,
      },
    });
  } catch (err) {
    console.error(`square-webhook: refund lookup failed for ${refundId}: ${err.message}`);
    return { ok: false, reason: "refund_lookup_failed" };
  }

  let body;
  try {
    body = await res.json();
  } catch (err) {
    return { ok: false, reason: "refund_lookup_unparseable" };
  }

  if (!res.ok) {
    console.error(`square-webhook: refund lookup ${res.status} for ${refundId}`);
    return { ok: false, reason: "refund_lookup_failed" };
  }

  const refund = body && body.refund;
  if (!refund || !refund.id) return { ok: false, reason: "refund_lookup_empty" };

  return { ok: true, refund };
}
