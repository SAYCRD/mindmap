// api/__tests__/square-refund.test.js — Stage 2B.
//
// What these tests can and cannot prove, stated up front because the
// distinction matters for how much confidence to take from a green run.
//
// They CAN prove the routing and validation contract: that a refunded
// payment.updated is not mistaken for a purchase, that credit removal is
// never decided from an unverified signal, that every uncreditable outcome is
// dead-lettered with a status code that tells Square whether to retry, and
// that the handler delegates the whole money operation to one RPC call
// without touching a table directly.
//
// They CANNOT prove the attribution arithmetic, the atomicity of the
// claw-back, or the concurrency behaviour: the fakes implement no
// transactions, row locks or unique indexes. Those properties are only
// observable against real Postgres and are covered by
// scripts/rehearse-square-refunds.sql on a disposable branch.

import test from "node:test";
import assert from "node:assert/strict";
import { createSquareWebhookHandler } from "../square-webhook.js";
import {
  detectRefundSignal,
  refundShapeProblem,
  summarizeSquareRefund,
  fetchSquareRefund,
} from "../_square-refund.js";
import { makeRes } from "./_http.js";
import {
  EXPECTED_LOCATION,
  PINNED_WEBHOOK_URL,
  SIGNATURE_KEY,
  completedPaymentEvent,
  createRefundFetch,
  createSquareTestClient,
  makeWebhookReq,
  paymentRefundObject,
  refundUpdatedEvent,
  refundedPaymentEvent,
} from "./_square-fakes.js";

function baseEnv(over = {}) {
  return {
    SQUARE_WEBHOOK_SIGNATURE_KEY: SIGNATURE_KEY,
    SQUARE_WEBHOOK_URL: PINNED_WEBHOOK_URL,
    SQUARE_EXPECTED_LOCATION_ID: EXPECTED_LOCATION,
    SQUARE_ENVIRONMENT: "production",
    SQUARE_ACCESS_TOKEN: "test-token",
    ...over,
  };
}

function refundOk(result, extra = {}) {
  return { data: { ok: true, result, credits_removed: 0, ...extra }, error: null };
}

async function run(event, { client, env = baseEnv(), fetchRefundImpl } = {}) {
  const sb = client || createSquareTestClient({ rpc: { process_square_refund: () => refundOk("credits_removed") } });
  const handler = createSquareWebhookHandler({
    getServiceClient: () => sb,
    env,
    fetchRefundImpl: fetchRefundImpl || createRefundFetch({ refunds: { "REFUND-001": paymentRefundObject() } }),
  });
  const res = makeRes();
  await handler(makeWebhookReq(event), res);
  return { res, sb };
}

// ---------------------------------------------------------------------------
// Signal detection — the routing decision everything else depends on.
// ---------------------------------------------------------------------------

test("detectRefundSignal: a plain completed payment is not a refund", () => {
  assert.equal(detectRefundSignal(completedPaymentEvent()), null);
});

test("detectRefundSignal: refunded_money or refund_ids marks a payment event as refund-related", () => {
  const both = detectRefundSignal(refundedPaymentEvent());
  assert.equal(both.kind, "payment_signal");
  assert.deepEqual(both.refundIds, ["REFUND-001"]);

  // refunded_money present, ids not yet propagated.
  const moneyOnly = detectRefundSignal(refundedPaymentEvent({ omitRefundIds: true }));
  assert.equal(moneyOnly.kind, "payment_signal");
  assert.deepEqual(moneyOnly.refundIds, []);

  // A rejected refund can leave an id with a zero total.
  const idsOnly = detectRefundSignal(refundedPaymentEvent({ refundedAmount: 0 }));
  assert.equal(idsOnly.kind, "payment_signal");
  assert.deepEqual(idsOnly.refundIds, ["REFUND-001"]);
});

test("detectRefundSignal: a refund object is authoritative and needs no lookup", () => {
  const signal = detectRefundSignal(refundUpdatedEvent());
  assert.equal(signal.kind, "refund_object");
  assert.equal(signal.refund.status, "COMPLETED");
});

// ---------------------------------------------------------------------------
// The property that protects the purchase path.
// ---------------------------------------------------------------------------

test("a refunded payment.updated is never processed as a purchase", async () => {
  const sb = createSquareTestClient({
    rpc: {
      process_square_refund: () => refundOk("credits_removed", { credits_removed: 5, attribution_basis: "unused" }),
      process_square_payment: () => {
        throw new Error("process_square_payment must not be reached for a refund");
      },
    },
  });

  const { res } = await run(refundedPaymentEvent(), { client: sb });

  assert.equal(res.statusCode, 200);
  assert.equal(sb._calls.rpc.filter((c) => c.name === "process_square_payment").length, 0);
  assert.equal(sb._calls.rpc.filter((c) => c.name === "process_square_refund").length, 1);
});

test("refund handling writes no table directly and touches no session data", async () => {
  const sb = createSquareTestClient({ rpc: { process_square_refund: () => refundOk("credits_removed") } });
  await run(refundUpdatedEvent(), { client: sb });

  assert.deepEqual(sb._calls.inserted, [], "no direct inserts");
  assert.deepEqual(sb._calls.updated, [], "no direct updates");
  assert.deepEqual(sb._calls.tables, [], "no table touched outside the RPC");
});

// ---------------------------------------------------------------------------
// Authoritative status resolution.
// ---------------------------------------------------------------------------

test("a payment-signal refund is resolved against GET /v2/refunds and uses that status", async () => {
  // The payment says COMPLETED; the refund itself is only PENDING. The refund
  // status must win, so no credit may be removed.
  const fetchImpl = createRefundFetch({
    refunds: { "REFUND-001": paymentRefundObject({ status: "PENDING" }) },
  });
  const sb = createSquareTestClient({
    rpc: { process_square_refund: (p) => refundOk("recorded_not_completed", { _seen: p.p_refund_status }) },
  });

  const { res } = await run(refundedPaymentEvent(), { client: sb, fetchRefundImpl: fetchImpl });

  assert.equal(fetchImpl._calls.length, 1);
  assert.match(fetchImpl._calls[0].url, /\/v2\/refunds\/REFUND-001$/);
  const params = sb._calls.rpc.find((c) => c.name === "process_square_refund").params;
  assert.equal(params.p_refund_status, "PENDING", "the refund's own status, not the payment's");
  assert.equal(res.statusCode, 200);
});

test("REJECTED and FAILED refunds reach the RPC as such and remove nothing", async () => {
  for (const status of ["REJECTED", "FAILED"]) {
    const sb = createSquareTestClient({
      rpc: { process_square_refund: () => refundOk("recorded_not_completed") },
    });
    const { res } = await run(refundUpdatedEvent({ status }), { client: sb });
    const params = sb._calls.rpc.find((c) => c.name === "process_square_refund").params;
    assert.equal(params.p_refund_status, status);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.refunds[0].credits_removed, 0, `${status} must remove no credits`);
  }
});

test("an unverifiable refund status is a 503 retry, never an assumed refund", async () => {
  for (const impl of [
    createRefundFetch({ failFor: ["REFUND-001"] }),
    createRefundFetch({ throwFor: ["REFUND-001"] }),
    createRefundFetch({ refunds: {} }), // 200 with an empty body
  ]) {
    const sb = createSquareTestClient({
      rpc: {
        process_square_refund: () => {
          throw new Error("must not decide credits from an unverified signal");
        },
      },
    });
    const { res } = await run(refundedPaymentEvent(), { client: sb, fetchRefundImpl: impl });

    assert.equal(res.statusCode, 503, "Square must keep retrying");
    assert.equal(sb._calls.rpc.filter((c) => c.name === "process_square_refund").length, 0);
    const dl = sb._calls.rpc.filter((c) => c.name === "record_square_webhook_dead_letter");
    assert.equal(dl.length, 1, "the unresolvable refund is recorded");
    assert.equal(dl[0].params.p_http_status, 503);
  }
});

test("a missing Square token cannot be worked around", async () => {
  const sb = createSquareTestClient({ rpc: { process_square_refund: () => refundOk("credits_removed") } });
  const { res } = await run(refundedPaymentEvent(), {
    client: sb,
    env: baseEnv({ SQUARE_ACCESS_TOKEN: "" }),
  });

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.result, "square_not_configured");
  assert.equal(sb._calls.rpc.filter((c) => c.name === "process_square_refund").length, 0);
});

test("refunded_money with no refund_ids yet is a 503, not a guess", async () => {
  const sb = createSquareTestClient({ rpc: { process_square_refund: () => refundOk("credits_removed") } });
  const { res } = await run(refundedPaymentEvent({ omitRefundIds: true }), { client: sb });

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.result, "refund_ids_missing");
  assert.equal(sb._calls.rpc.filter((c) => c.name === "process_square_refund").length, 0);
});

// ---------------------------------------------------------------------------
// What is stored.
// ---------------------------------------------------------------------------

test("the refund summary carries reconciliation data only", () => {
  const refund = paymentRefundObject();
  const summary = summarizeSquareRefund(refundUpdatedEvent({ refund }), refund);

  assert.deepEqual(Object.keys(summary).sort(), [
    "amount_cents",
    "currency",
    "event_id",
    "event_type",
    "location_id",
    "order_id",
    "payment_id",
    "refund_created_at",
    "refund_id",
    "refund_status",
    "refund_updated_at",
  ]);

  const serialized = JSON.stringify(summary);
  assert.ok(!serialized.includes("jane.doe@example.com"), "merchant-entered reason must not be stored");
  assert.ok(!/processing_fee/.test(serialized), "fee breakdown is not reconciliation data");
  assert.equal(summary.amount_cents, 1200);
  assert.equal(summary.refund_id, "REFUND-001");
});

test("the RPC receives the refund identity, not the payment's numbers", async () => {
  const sb = createSquareTestClient({ rpc: { process_square_refund: () => refundOk("credits_removed") } });
  await run(refundUpdatedEvent({ amount: 1200, refundId: "REFUND-777", orderId: "ORDER-ABC123" }), { client: sb });

  const params = sb._calls.rpc.find((c) => c.name === "process_square_refund").params;
  assert.equal(params.p_square_refund_id, "REFUND-777");
  assert.equal(params.p_square_payment_id, "PAY-XYZ789");
  assert.equal(params.p_square_order_id, "ORDER-ABC123");
  assert.equal(params.p_amount_cents, 1200);
  assert.equal(params.p_currency, "USD");
  assert.equal(params.p_location_id, EXPECTED_LOCATION);
});

// ---------------------------------------------------------------------------
// Shape and location validation.
// ---------------------------------------------------------------------------

test("refundShapeProblem names the first missing field", () => {
  const good = summarizeSquareRefund(refundUpdatedEvent(), paymentRefundObject());
  assert.equal(refundShapeProblem(good), null);

  assert.equal(refundShapeProblem({ ...good, refund_id: null }), "invalid_refund_id");
  assert.equal(refundShapeProblem({ ...good, payment_id: null }), "invalid_payment_id");
  assert.equal(refundShapeProblem({ ...good, refund_status: null }), "invalid_refund_status");
  assert.equal(refundShapeProblem({ ...good, amount_cents: 0 }), "invalid_amount");
  assert.equal(refundShapeProblem({ ...good, amount_cents: -5 }), "invalid_amount");
  assert.equal(refundShapeProblem({ ...good, amount_cents: 12.5 }), "invalid_amount");
  assert.equal(refundShapeProblem({ ...good, currency: null }), "invalid_currency");
});

test("a malformed refund is a 409 for review, never a retry", async () => {
  const sb = createSquareTestClient({ rpc: { process_square_refund: () => refundOk("credits_removed") } });
  const { res } = await run(refundUpdatedEvent({ mutate: (r) => delete r.payment_id }), { client: sb });

  assert.equal(res.statusCode, 409);
  assert.equal(sb._calls.rpc.filter((c) => c.name === "process_square_refund").length, 0);
  const dl = sb._calls.rpc.filter((c) => c.name === "record_square_webhook_dead_letter");
  assert.equal(dl[0].params.p_result_code, "invalid_payment_id");
  assert.equal(dl[0].params.p_http_status, 409);
});

test("a refund from an unexpected location is refused before the RPC", async () => {
  const sb = createSquareTestClient({ rpc: { process_square_refund: () => refundOk("credits_removed") } });
  const { res } = await run(refundUpdatedEvent({ locationId: "LSOMEOTHERPLACE" }), { client: sb });

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.refunds[0].result, "location_mismatch");
  assert.equal(sb._calls.rpc.filter((c) => c.name === "process_square_refund").length, 0);
});

test("refund events are signature-verified against the pinned URL like any other", async () => {
  const sb = createSquareTestClient({ rpc: { process_square_refund: () => refundOk("credits_removed") } });
  const handler = createSquareWebhookHandler({ getServiceClient: () => sb, env: baseEnv() });
  const res = makeRes();

  // Signed for the host actually serving the request instead of the
  // registered subscription URL.
  await handler(makeWebhookReq(refundUpdatedEvent(), { url: "https://blindspotup.com/api/square-webhook" }), res);

  assert.equal(res.statusCode, 401);
  assert.equal(sb._calls.rpc.length, 0);
});

// ---------------------------------------------------------------------------
// Outcome routing.
// ---------------------------------------------------------------------------

test("an ambiguous attribution is recorded for review, changes no credits, and stops retries", async () => {
  const sb = createSquareTestClient({
    rpc: {
      process_square_refund: () =>
        refundOk("ambiguous_attribution", {
          credits_removed: 0,
          attribution_basis: "ambiguous",
          requires_review: true,
        }),
    },
  });
  const { res } = await run(refundUpdatedEvent(), { client: sb });

  assert.equal(res.statusCode, 200, "Square must stop retrying; the item lives in square_refunds");
  assert.equal(res.body.refunds[0].credits_removed, 0);
  assert.equal(res.body.refunds[0].requires_review, true);
  assert.equal(
    sb._calls.rpc.filter((c) => c.name === "record_square_webhook_dead_letter").length,
    0,
    "square_refunds is the review record, not the dead-letter table"
  );
});

test("partial, fully-used and replayed outcomes are all terminal 200s", async () => {
  for (const [result, extra] of [
    ["recorded_partial", { requires_review: true }],
    ["no_credits_to_remove", { attribution_basis: "sole_source" }],
    ["already_processed", { credits_removed: 5 }],
    ["recorded_not_completed", {}],
  ]) {
    const sb = createSquareTestClient({ rpc: { process_square_refund: () => refundOk(result, extra) } });
    const { res } = await run(refundUpdatedEvent(), { client: sb });
    assert.equal(res.statusCode, 200, `${result} must be terminal`);
    assert.equal(res.body.refunds[0].result, result);
  }
});

test("an uncorrelated refund keeps Square retrying instead of being discarded", async () => {
  const sb = createSquareTestClient({
    rpc: { process_square_refund: () => refundOk("unmatched_payment") },
  });
  const { res } = await run(refundUpdatedEvent(), { client: sb });

  assert.equal(res.statusCode, 503);
  const dl = sb._calls.rpc.filter((c) => c.name === "record_square_webhook_dead_letter");
  assert.equal(dl[0].params.p_result_code, "unmatched_payment");
  assert.equal(dl[0].params.p_http_status, 503);
});

test("conflicts are 409 and a failing RPC is 503", async () => {
  for (const [result, expected] of [
    ["conflict_payment_id", 409],
    ["conflict_not_credited", 409],
    ["conflict_amount", 409],
    ["currency_mismatch", 409],
    ["location_mismatch", 409],
    ["conflict_refund_mismatch", 409],
    ["retry_needed", 503],
  ]) {
    const sb = createSquareTestClient({
      rpc: { process_square_refund: () => ({ data: { ok: false, result }, error: null }) },
    });
    const { res } = await run(refundUpdatedEvent(), { client: sb });
    assert.equal(res.statusCode, expected, `${result} -> ${expected}`);
  }

  const broken = createSquareTestClient({
    rpc: {
      process_square_refund: () => {
        throw new Error("connection reset");
      },
    },
  });
  const { res } = await run(refundUpdatedEvent(), { client: broken });
  assert.equal(res.statusCode, 503);
  const dl = broken._calls.rpc.filter((c) => c.name === "record_square_webhook_dead_letter");
  assert.equal(dl[0].params.p_result_code, "refund_rpc_error");
});

test("every refund on a multi-refund event is processed, and a retryable one wins the status", async () => {
  const fetchImpl = createRefundFetch({
    refunds: {
      "REFUND-A": paymentRefundObject({ refundId: "REFUND-A", amount: 600 }),
      "REFUND-B": paymentRefundObject({ refundId: "REFUND-B", amount: 600 }),
    },
  });
  const sb = createSquareTestClient({
    rpc: {
      process_square_refund: (p) =>
        p.p_square_refund_id === "REFUND-B"
          ? refundOk("unmatched_payment")
          : refundOk("recorded_partial", { requires_review: true }),
    },
  });

  const { res } = await run(refundedPaymentEvent({ refundIds: ["REFUND-A", "REFUND-B"] }), {
    client: sb,
    fetchRefundImpl: fetchImpl,
  });

  assert.equal(sb._calls.rpc.filter((c) => c.name === "process_square_refund").length, 2);
  assert.equal(res.statusCode, 503, "a retryable outcome must beat a terminal one");
  assert.equal(res.body.refunds.length, 2);
});

// ---------------------------------------------------------------------------
// The lookup helper in isolation.
// ---------------------------------------------------------------------------

test("fetchSquareRefund targets the right host per environment and sends no cookies", async () => {
  for (const [environment, host] of [
    ["production", "https://connect.squareup.com"],
    ["sandbox", "https://connect.squareupsandbox.com"],
  ]) {
    const fetchImpl = createRefundFetch({ refunds: { "REFUND-001": paymentRefundObject() } });
    const out = await fetchSquareRefund("REFUND-001", {
      env: { SQUARE_ENVIRONMENT: environment, SQUARE_ACCESS_TOKEN: "tok" },
      fetchImpl,
    });
    assert.equal(out.ok, true);
    assert.equal(fetchImpl._calls[0].url, `${host}/v2/refunds/REFUND-001`);
    assert.equal(fetchImpl._calls[0].init.method, "GET");
    assert.equal(fetchImpl._calls[0].init.headers.Authorization, "Bearer tok");
  }
});

test("fetchSquareRefund url-encodes the id it was given", async () => {
  const fetchImpl = createRefundFetch({ refunds: {} });
  await fetchSquareRefund("a/../b", { env: { SQUARE_ACCESS_TOKEN: "tok" }, fetchImpl });
  assert.ok(!fetchImpl._calls[0].url.includes("/../"), "path traversal must not survive into the URL");
});
