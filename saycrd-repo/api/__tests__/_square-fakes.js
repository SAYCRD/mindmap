// api/__tests__/_square-fakes.js — purpose-built fakes for the Stage 2A
// Square routes. Deliberately separate from _mock-supabase.js: that mock has
// no fixtures for square_payments / credit_ledger and throws on unknown RPCs,
// and extending it would risk changing behaviour the existing Stage 2 route
// tests depend on.
//
// These fakes record every table touched and every RPC called, which is what
// lets the webhook tests assert the property that actually matters: that the
// handler performs NO direct table writes and delegates the whole money
// operation to exactly one process_square_payment call.
//
// Note what these fakes cannot prove. They do not implement transactions, row
// locks or unique indexes, so they cannot demonstrate that the RPC's two
// writes commit atomically. That property is verifiable only against real
// Postgres and is covered by the disposable-branch rehearsal
// (scripts/rehearse-square-atomicity.sql), not here.

import { createHmac } from "node:crypto";

export function createSquareTestClient(opts = {}) {
  const { tiers = [], insertError = null, rpc: rpcHandlers = {} } = opts;

  const calls = { rpc: [], inserted: [], updated: [], tables: [] };

  function builder(table) {
    const state = { filters: [], mode: "select", payload: null };
    const api = {
      select() {
        return api;
      },
      eq(col, val) {
        state.filters.push([col, val]);
        return api;
      },
      insert(row) {
        state.mode = "insert";
        state.payload = row;
        return api;
      },
      update(patch) {
        state.mode = "update";
        state.payload = patch;
        return api;
      },
      async maybeSingle() {
        if (table === "session_tiers") {
          const row = tiers.find((t) => state.filters.every(([c, v]) => t[c] === v));
          return { data: row || null, error: null };
        }
        return { data: null, error: null };
      },
      async single() {
        return api.maybeSingle();
      },
      then(resolve, reject) {
        api._run().then(resolve, reject);
      },
      async _run() {
        if (state.mode === "insert") {
          calls.inserted.push({ table, row: state.payload });
          if (insertError) return { data: null, error: insertError };
          return { data: [state.payload], error: null };
        }
        if (state.mode === "update") {
          calls.updated.push({ table, patch: state.payload });
          return { data: [], error: null };
        }
        return { data: [], error: null };
      },
    };
    return api;
  }

  return {
    from(table) {
      calls.tables.push(table);
      return builder(table);
    },
    async rpc(name, params) {
      calls.rpc.push({ name, params });
      const handler = rpcHandlers[name];
      if (typeof handler === "function") return handler(params);
      if (handler) return handler;
      return { data: { ok: true, result: "recorded" }, error: null };
    },
    _calls: calls,
  };
}

export const PINNED_WEBHOOK_URL = "https://www.blindspotup.com/api/square-webhook";
export const SIGNATURE_KEY = "test-signature-key";
export const EXPECTED_LOCATION = "LG8FD2SPNNAVX";

export function signBody(rawBody, url = PINNED_WEBHOOK_URL, key = SIGNATURE_KEY) {
  return createHmac("sha256", key).update(url + rawBody).digest("base64");
}

// A realistic Square payment.updated event. Includes the buyer / card /
// billing / risk fields Square really sends, so the tests can assert those
// are NOT propagated into anything we store.
export function completedPaymentEvent(overrides = {}) {
  const {
    // Deliberately shares no substring with the card last_4 below, so the
    // redaction assertions cannot pass or fail by coincidence.
    eventId = "EVT-A7B2-C9D4-E6F8",
    orderId = "ORDER-ABC123",
    paymentId = "PAY-XYZ789",
    amount = 1200,
    currency = "USD",
    locationId = EXPECTED_LOCATION,
    status = "COMPLETED",
    omitEventId = false,
  } = overrides;

  const event = {
    merchant_id: "MERCHANT1",
    type: "payment.updated",
    event_id: eventId,
    created_at: "2026-09-07T12:00:00Z",
    data: {
      type: "payment",
      id: paymentId,
      object: {
        payment: {
          id: paymentId,
          order_id: orderId,
          status,
          location_id: locationId,
          created_at: "2026-09-07T11:59:00Z",
          updated_at: "2026-09-07T12:00:00Z",
          receipt_url: "https://squareup.com/receipt/preview/PAY-XYZ789",
          amount_money: { amount, currency },
          // Fields we must never store:
          buyer_email_address: "buyer@example.com",
          billing_address: { address_line_1: "1 Test St", postal_code: "86336" },
          card_details: {
            card: { last_4: "1111", fingerprint: "sq-fingerprint-abc", exp_month: 12, exp_year: 2030 },
          },
          risk_evaluation: { risk_level: "NORMAL" },
        },
      },
    },
  };

  if (omitEventId) delete event.event_id;
  if (overrides.mutate) overrides.mutate(event);
  return event;
}

// ---------------------------------------------------------------------------
// Stage 2B refund fixtures.
// ---------------------------------------------------------------------------

// A payment.updated event for a payment that has been refunded. This is the
// shape the CURRENT subscription actually delivers: note that status stays
// "COMPLETED" — Square has no REFUNDED payment status — and the only refund
// markers are refunded_money and refund_ids. A handler that checked the
// credit path first would read this as a fresh purchase.
export function refundedPaymentEvent(overrides = {}) {
  const {
    refundedAmount = 1200,
    amount = 1200,
    refundIds = ["REFUND-001"],
    currency = "USD",
    omitRefundIds = false,
  } = overrides;

  return completedPaymentEvent({
    ...overrides,
    amount,
    currency,
    mutate(event) {
      const payment = event.data.object.payment;
      payment.refunded_money = { amount: refundedAmount, currency };
      if (!omitRefundIds) payment.refund_ids = refundIds;
      if (overrides.mutatePayment) overrides.mutatePayment(payment);
    },
  });
}

// A PaymentRefund object, as returned by GET /v2/refunds/{id} and as carried
// on data.object.refund by refund.updated. Includes the fields we must never
// store, so the redaction assertions have something real to catch.
export function paymentRefundObject(overrides = {}) {
  const {
    refundId = "REFUND-001",
    paymentId = "PAY-XYZ789",
    orderId = "ORDER-ABC123",
    status = "COMPLETED",
    amount = 1200,
    currency = "USD",
    locationId = EXPECTED_LOCATION,
  } = overrides;

  const refund = {
    id: refundId,
    status,
    payment_id: paymentId,
    order_id: orderId,
    location_id: locationId,
    amount_money: { amount, currency },
    created_at: "2026-09-07T13:00:00Z",
    updated_at: "2026-09-07T13:05:00Z",
    // Must never be propagated into anything we store: the merchant-entered
    // reason is free text and the fee breakdown is not reconciliation data.
    reason: "Customer jane.doe@example.com asked for her money back",
    processing_fee: [{ amount_money: { amount: -35, currency }, type: "INITIAL" }],
  };

  if (overrides.mutate) overrides.mutate(refund);
  return refund;
}

// A refund.updated event. Not currently subscribed in Square, but supported
// so activation order does not matter.
export function refundUpdatedEvent(overrides = {}) {
  const { eventId = "EVT-REFUND-0001", refund = paymentRefundObject(overrides) } = overrides;
  const event = {
    merchant_id: "MERCHANT1",
    type: "refund.updated",
    event_id: eventId,
    created_at: "2026-09-07T13:05:00Z",
    data: { type: "refund", id: refund.id, object: { refund } },
  };
  if (overrides.omitEventId) delete event.event_id;
  return event;
}

// Stands in for GET /v2/refunds/{id}. `refunds` maps refund id -> object;
// `failFor` forces a transport/HTTP failure for specific ids.
export function createRefundFetch({ refunds = {}, failFor = [], httpStatus = 200, throwFor = [] } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    const id = decodeURIComponent(String(url).split("/v2/refunds/")[1] || "");
    if (throwFor.includes(id)) throw new Error("network down");
    if (failFor.includes(id)) {
      return { ok: false, status: httpStatus === 200 ? 500 : httpStatus, json: async () => ({ errors: [{ code: "X" }] }) };
    }
    const refund = refunds[id];
    if (!refund) return { ok: true, status: 200, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ refund }) };
  };
  fetchImpl._calls = calls;
  return fetchImpl;
}

export function makeWebhookReq(
  event,
  { url = PINNED_WEBHOOK_URL, key = SIGNATURE_KEY, host = "www.blindspotup.com", signature, omitSignature = false } = {}
) {
  const rawBody = JSON.stringify(event);
  const headers = { host };
  // omitSignature models Square's header being absent entirely, which is
  // distinct from it being present but wrong — passing `signature: undefined`
  // cannot express that, since undefined means "sign it normally".
  if (!omitSignature) {
    headers["x-square-hmacsha256-signature"] = signature !== undefined ? signature : signBody(rawBody, url, key);
  }
  return {
    method: "POST",
    headers,
    rawBody,
    url: "/api/square-webhook",
    body: event,
  };
}
