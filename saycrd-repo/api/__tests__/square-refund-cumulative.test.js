// api/__tests__/square-refund-cumulative.test.js — Stage 2C.
//
// Read the scope note before taking confidence from a green run.
//
// The cumulative arithmetic lives in process_square_refund, in SQL. These
// fakes have no tables, no transactions, no row locks and no unique indexes,
// so they CANNOT prove that two 1200-cent refunds against a 2400-cent
// purchase sum to a full refund, nor that the claw-back happens exactly once
// when they race. Re-implementing that arithmetic in a JS fake and asserting
// against it would only prove the fake agrees with itself.
//
// So the four requested scenarios — one partial, several partials reaching
// the full amount, duplicated partial events, and an over-refund — are proven
// against real Postgres in scripts/rehearse-square-refunds-cumulative.sql,
// executed on a disposable Supabase branch.
//
// What THIS file proves is the boundary contract, which is where a cumulative
// design can still be broken without touching SQL:
//
//   * the handler never re-derives partial-vs-full itself. It forwards each
//     refund's own reported amount and lets the RPC decide, so there is
//     exactly one place in the system that knows the policy.
//   * one RPC call per refund id, never an aggregate — the handler must not
//     "helpfully" sum an event's refunds before calling.
//   * a partial refund is a 200 that is NOT dead-lettered, so Square stops
//     retrying while the money question stays open in square_refunds.
//   * an over-refund is a 409 that IS dead-lettered, and is in neither the
//     handled nor the retryable set.
//   * replayed payment.updated and refund.updated deliveries of the same
//     refund produce byte-identical RPC arguments, which is the precondition
//     for the RPC's self-excluding sum to converge.

import test from "node:test";
import assert from "node:assert/strict";
import { createSquareWebhookHandler } from "../square-webhook.js";
import { makeRes } from "./_http.js";
import {
  EXPECTED_LOCATION,
  PINNED_WEBHOOK_URL,
  SIGNATURE_KEY,
  createRefundFetch,
  createSquareTestClient,
  makeWebhookReq,
  paymentRefundObject,
  refundUpdatedEvent,
  refundedPaymentEvent,
} from "./_square-fakes.js";

const PURCHASE_CENTS = 2400;

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

// Mirrors the RPC's return envelope for a partial: recorded, flagged for
// review, no credit change, cumulative position reported.
function partialResult({ cumulative, purchase = PURCHASE_CENTS }) {
  return {
    data: {
      ok: true,
      result: "recorded_partial",
      credits_removed: 0,
      attribution_basis: null,
      requires_review: true,
      cumulative_refunded_cents: cumulative,
      purchase_amount_cents: purchase,
      remaining_cents: Math.max(0, purchase - cumulative),
      is_full_refund: false,
    },
    error: null,
  };
}

function fullResult({ creditsRemoved = 5, purchase = PURCHASE_CENTS } = {}) {
  return {
    data: {
      ok: true,
      result: "credits_removed",
      credits_removed: creditsRemoved,
      attribution_basis: "unused",
      requires_review: false,
      cumulative_refunded_cents: purchase,
      purchase_amount_cents: purchase,
      remaining_cents: 0,
      is_full_refund: true,
    },
    error: null,
  };
}

function overRefundResult({ cumulative, purchase = PURCHASE_CENTS }) {
  return {
    data: {
      ok: false,
      result: "conflict_over_refund",
      credits_removed: 0,
      attribution_basis: null,
      requires_review: true,
      cumulative_refunded_cents: cumulative,
      purchase_amount_cents: purchase,
      remaining_cents: 0,
      is_full_refund: false,
    },
    error: null,
  };
}

function alreadyProcessed({ prior = "recorded_partial", cumulative = 1200 } = {}) {
  return {
    data: {
      ok: true,
      result: "already_processed",
      prior_result: prior,
      credits_removed: 0,
      attribution_basis: null,
      cumulative_refunded_cents: cumulative,
      purchase_amount_cents: PURCHASE_CENTS,
    },
    error: null,
  };
}

// Serves a scripted sequence of RPC replies so an event carrying several
// refunds can be driven through distinct outcomes without the fake having to
// know any arithmetic.
function scriptedClient(sequence) {
  let i = 0;
  return createSquareTestClient({
    rpc: {
      process_square_refund: () => {
        const next = sequence[Math.min(i, sequence.length - 1)];
        i += 1;
        return typeof next === "function" ? next() : next;
      },
      record_square_webhook_dead_letter: () => ({ data: { ok: true }, error: null }),
    },
  });
}

async function run(event, { client, env = baseEnv(), refunds } = {}) {
  const sb = client || scriptedClient([partialResult({ cumulative: 1200 })]);
  const handler = createSquareWebhookHandler({
    getServiceClient: () => sb,
    env,
    fetchRefundImpl: createRefundFetch({
      refunds: refunds || { "REFUND-001": paymentRefundObject({ amount: 1200 }) },
    }),
  });
  const res = makeRes();
  await handler(makeWebhookReq(event), res);
  return { res, sb };
}

function refundRpcCalls(sb) {
  return sb._calls.rpc.filter((c) => c.name === "process_square_refund");
}

function deadLetterCalls(sb) {
  return sb._calls.rpc.filter((c) => c.name === "record_square_webhook_dead_letter");
}

// ---------------------------------------------------------------------------
// Scenario 1 — a single partial refund.
// ---------------------------------------------------------------------------

test("one partial refund: answered 200 so Square stops retrying", async () => {
  const { res } = await run(
    refundedPaymentEvent({ amount: PURCHASE_CENTS, refundedAmount: 1200 }),
    { client: scriptedClient([partialResult({ cumulative: 1200 })]) }
  );
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.refunds[0].result, "recorded_partial");
});

test("one partial refund: removes no credits and is flagged for review", async () => {
  const { res } = await run(
    refundedPaymentEvent({ amount: PURCHASE_CENTS, refundedAmount: 1200 }),
    { client: scriptedClient([partialResult({ cumulative: 1200 })]) }
  );
  const entry = res.body.refunds[0];
  assert.equal(entry.credits_removed, 0);
  assert.equal(entry.requires_review, true);
  assert.equal(entry.is_full_refund, false);
});

test("one partial refund: cumulative position is echoed for reconciliation", async () => {
  const { res } = await run(
    refundedPaymentEvent({ amount: PURCHASE_CENTS, refundedAmount: 1200 }),
    { client: scriptedClient([partialResult({ cumulative: 1200 })]) }
  );
  const entry = res.body.refunds[0];
  assert.equal(entry.cumulative_refunded_cents, 1200);
  assert.equal(entry.purchase_amount_cents, PURCHASE_CENTS);
  assert.equal(entry.remaining_cents, 1200);
});

test("one partial refund: NOT dead-lettered — the open question lives in square_refunds", async () => {
  const { sb } = await run(
    refundedPaymentEvent({ amount: PURCHASE_CENTS, refundedAmount: 1200 }),
    { client: scriptedClient([partialResult({ cumulative: 1200 })]) }
  );
  assert.equal(deadLetterCalls(sb).length, 0);
});

test("one partial refund: handler forwards the refund's own amount and never a cumulative total", async () => {
  // The handler must not compute or pass any running total. If it ever did,
  // there would be two places that know the policy and they would drift.
  const { sb } = await run(
    refundedPaymentEvent({ amount: PURCHASE_CENTS, refundedAmount: 1200 }),
    { client: scriptedClient([partialResult({ cumulative: 1200 })]) }
  );
  const params = refundRpcCalls(sb)[0].params;
  assert.equal(params.p_amount_cents, 1200);
  assert.equal(params.p_square_refund_id, "REFUND-001");
  const cumulativeParams = Object.keys(params).filter((k) => /cumulative|running|total/i.test(k));
  assert.deepEqual(cumulativeParams, []);
});

test("one partial refund: no direct table writes", async () => {
  const { sb } = await run(
    refundedPaymentEvent({ amount: PURCHASE_CENTS, refundedAmount: 1200 }),
    { client: scriptedClient([partialResult({ cumulative: 1200 })]) }
  );
  assert.deepEqual(sb._calls.inserted, []);
  assert.deepEqual(sb._calls.updated, []);
});

// ---------------------------------------------------------------------------
// Scenario 2 — multiple partial refunds totalling the full amount.
// ---------------------------------------------------------------------------

const TWO_REFUNDS = {
  "REFUND-001": paymentRefundObject({ refundId: "REFUND-001", amount: 1200 }),
  "REFUND-002": paymentRefundObject({ refundId: "REFUND-002", amount: 1200 }),
};

test("two partials reaching the full amount: one RPC call per refund id, never an aggregate", async () => {
  const sb = scriptedClient([partialResult({ cumulative: 1200 }), fullResult()]);
  await run(
    refundedPaymentEvent({
      amount: PURCHASE_CENTS,
      refundedAmount: PURCHASE_CENTS,
      refundIds: ["REFUND-001", "REFUND-002"],
    }),
    { client: sb, refunds: TWO_REFUNDS }
  );
  const calls = refundRpcCalls(sb);
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((c) => c.params.p_square_refund_id),
    ["REFUND-001", "REFUND-002"]
  );
  // Each call carries its own 1200, not the 2400 total.
  assert.deepEqual(calls.map((c) => c.params.p_amount_cents), [1200, 1200]);
});

test("two partials reaching the full amount: the crossing refund reports the claw-back", async () => {
  const sb = scriptedClient([partialResult({ cumulative: 1200 }), fullResult({ creditsRemoved: 5 })]);
  const { res } = await run(
    refundedPaymentEvent({
      amount: PURCHASE_CENTS,
      refundedAmount: PURCHASE_CENTS,
      refundIds: ["REFUND-001", "REFUND-002"],
    }),
    { client: sb, refunds: TWO_REFUNDS }
  );
  assert.equal(res.statusCode, 200);
  const [first, second] = res.body.refunds;
  assert.equal(first.result, "recorded_partial");
  assert.equal(first.credits_removed, 0);
  assert.equal(second.result, "credits_removed");
  assert.equal(second.credits_removed, 5);
  assert.equal(second.is_full_refund, true);
  assert.equal(second.remaining_cents, 0);
});

test("two partials reaching the full amount: exactly one of the two removes credits", async () => {
  const sb = scriptedClient([partialResult({ cumulative: 1200 }), fullResult({ creditsRemoved: 5 })]);
  const { res } = await run(
    refundedPaymentEvent({
      amount: PURCHASE_CENTS,
      refundedAmount: PURCHASE_CENTS,
      refundIds: ["REFUND-001", "REFUND-002"],
    }),
    { client: sb, refunds: TWO_REFUNDS }
  );
  const removing = res.body.refunds.filter((r) => r.credits_removed > 0);
  assert.equal(removing.length, 1);
  const total = res.body.refunds.reduce((n, r) => n + (r.credits_removed || 0), 0);
  assert.equal(total, 5);
});

// ---------------------------------------------------------------------------
// Scenario 3 — duplicated partial events.
// ---------------------------------------------------------------------------

test("duplicated partial event: a redelivery is answered 200 as already_processed", async () => {
  const event = refundedPaymentEvent({ amount: PURCHASE_CENTS, refundedAmount: 1200 });
  const sb = scriptedClient([partialResult({ cumulative: 1200 }), alreadyProcessed()]);

  const first = await run(event, { client: sb });
  const second = await run(event, { client: sb });

  assert.equal(first.res.statusCode, 200);
  assert.equal(second.res.statusCode, 200);
  assert.equal(first.res.body.refunds[0].result, "recorded_partial");
  assert.equal(second.res.body.refunds[0].result, "already_processed");
});

test("duplicated partial event: neither delivery removes credits or dead-letters", async () => {
  const event = refundedPaymentEvent({ amount: PURCHASE_CENTS, refundedAmount: 1200 });
  const sb = scriptedClient([partialResult({ cumulative: 1200 }), alreadyProcessed()]);

  await run(event, { client: sb });
  await run(event, { client: sb });

  assert.equal(deadLetterCalls(sb).length, 0);
  const removed = sb._calls.rpc
    .filter((c) => c.name === "process_square_refund")
    .length;
  assert.equal(removed, 2);
});

test("duplicated partial event: both deliveries send byte-identical RPC arguments", async () => {
  // This is the precondition for the RPC's self-excluding cumulative sum to
  // converge: if the handler varied any argument between deliveries, the
  // recomputed total could differ and idempotence would rest on nothing.
  const event = refundedPaymentEvent({ amount: PURCHASE_CENTS, refundedAmount: 1200 });
  const sb = scriptedClient([partialResult({ cumulative: 1200 }), alreadyProcessed()]);

  await run(event, { client: sb });
  await run(event, { client: sb });

  const [a, b] = refundRpcCalls(sb).map((c) => c.params);
  assert.deepEqual(a, b);
});

test("duplicated partial event: payment.updated and refund.updated converge on the same RPC arguments", async () => {
  // The same refund can arrive by either subscription. Both must reduce to
  // the same call, or the same money would be counted under two identities.
  const viaPayment = scriptedClient([partialResult({ cumulative: 1200 })]);
  const viaRefund = scriptedClient([partialResult({ cumulative: 1200 })]);

  await run(refundedPaymentEvent({ amount: PURCHASE_CENTS, refundedAmount: 1200 }), { client: viaPayment });

  const handler = createSquareWebhookHandler({
    getServiceClient: () => viaRefund,
    env: baseEnv(),
    fetchRefundImpl: createRefundFetch({ refunds: {} }),
  });
  const res = makeRes();
  await handler(makeWebhookReq(refundUpdatedEvent({ amount: 1200 })), res);

  const fromPayment = refundRpcCalls(viaPayment)[0].params;
  const fromRefund = refundRpcCalls(viaRefund)[0].params;

  for (const key of [
    "p_square_refund_id",
    "p_square_payment_id",
    "p_square_order_id",
    "p_amount_cents",
    "p_currency",
    "p_refund_status",
    "p_location_id",
  ]) {
    assert.equal(fromRefund[key], fromPayment[key], `${key} diverged between event shapes`);
  }
});

// ---------------------------------------------------------------------------
// Scenario 4 — an over-refund.
// ---------------------------------------------------------------------------

test("over-refund: answered 409, not 200 and not 503", async () => {
  const { res } = await run(
    refundedPaymentEvent({ amount: PURCHASE_CENTS, refundedAmount: 1500 }),
    { client: scriptedClient([overRefundResult({ cumulative: 2700 })]) }
  );
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.ok, false);
  assert.equal(res.body.refunds[0].result, "conflict_over_refund");
});

test("over-refund: dead-lettered at 409 so a human sees it", async () => {
  const sb = scriptedClient([overRefundResult({ cumulative: 2700 })]);
  await run(refundedPaymentEvent({ amount: PURCHASE_CENTS, refundedAmount: 1500 }), { client: sb });

  const dl = deadLetterCalls(sb);
  assert.equal(dl.length, 1);
  assert.equal(dl[0].params.p_result_code, "conflict_over_refund");
  assert.equal(dl[0].params.p_http_status, 409);
});

test("over-refund: the cumulative total that triggered it is reported", async () => {
  const { res } = await run(
    refundedPaymentEvent({ amount: PURCHASE_CENTS, refundedAmount: 1500 }),
    { client: scriptedClient([overRefundResult({ cumulative: 2700 })]) }
  );
  const entry = res.body.refunds[0];
  assert.equal(entry.cumulative_refunded_cents, 2700);
  assert.equal(entry.purchase_amount_cents, PURCHASE_CENTS);
});

test("over-refund: no credits are removed and no table is written directly", async () => {
  const sb = scriptedClient([overRefundResult({ cumulative: 2700 })]);
  const { res } = await run(refundedPaymentEvent({ amount: PURCHASE_CENTS, refundedAmount: 1500 }), { client: sb });
  assert.ok(!res.body.refunds[0].credits_removed);
  assert.deepEqual(sb._calls.inserted, []);
  assert.deepEqual(sb._calls.updated, []);
});

test("over-refund alongside a good partial: the partial still reaches the RPC", async () => {
  // A 409 for one refund must not abandon the others in the same event.
  const sb = scriptedClient([partialResult({ cumulative: 1200 }), overRefundResult({ cumulative: 2700 })]);
  const { res } = await run(
    refundedPaymentEvent({
      amount: PURCHASE_CENTS,
      refundedAmount: 2700,
      refundIds: ["REFUND-001", "REFUND-002"],
    }),
    { client: sb, refunds: TWO_REFUNDS }
  );
  assert.equal(refundRpcCalls(sb).length, 2);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.refunds[0].result, "recorded_partial");
  assert.equal(res.body.refunds[1].result, "conflict_over_refund");
});

test("over-refund alongside a retryable refund: 503 wins so the retryable one is not lost", async () => {
  const sb = scriptedClient([
    overRefundResult({ cumulative: 2700 }),
    { data: { ok: false, result: "unmatched_payment" }, error: null },
  ]);
  const { res } = await run(
    refundedPaymentEvent({
      amount: PURCHASE_CENTS,
      refundedAmount: 2700,
      refundIds: ["REFUND-001", "REFUND-002"],
    }),
    { client: sb, refunds: TWO_REFUNDS }
  );
  assert.equal(res.statusCode, 503);
});

test("over-refund: a redelivery is answered identically rather than escalating", async () => {
  const event = refundedPaymentEvent({ amount: PURCHASE_CENTS, refundedAmount: 1500 });
  const sb = scriptedClient([overRefundResult({ cumulative: 2700 }), overRefundResult({ cumulative: 2700 })]);

  const first = await run(event, { client: sb });
  const second = await run(event, { client: sb });

  assert.equal(first.res.statusCode, 409);
  assert.equal(second.res.statusCode, 409);
  assert.deepEqual(first.res.body.refunds[0], second.res.body.refunds[0]);
});
