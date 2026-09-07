import test from "node:test";
import assert from "node:assert/strict";
import { createSquareWebhookHandler, deadLetterEventId, summarizeSquarePayment } from "../square-webhook.js";
import {
  completedPaymentEvent,
  createSquareTestClient,
  EXPECTED_LOCATION,
  makeWebhookReq,
  PINNED_WEBHOOK_URL,
  SIGNATURE_KEY,
  signBody,
} from "./_square-fakes.js";
import { makeRes } from "./_http.js";

function baseEnv(overrides = {}) {
  return {
    SQUARE_WEBHOOK_SIGNATURE_KEY: SIGNATURE_KEY,
    SQUARE_WEBHOOK_URL: PINNED_WEBHOOK_URL,
    SQUARE_EXPECTED_LOCATION_ID: EXPECTED_LOCATION,
    ...overrides,
  };
}

function rpcReturning(result) {
  return { process_square_payment: () => ({ data: result, error: null }) };
}

async function run({ event = completedPaymentEvent(), env = baseEnv(), sb, reqOpts } = {}) {
  const client = sb || createSquareTestClient({ rpc: rpcReturning({ ok: true, result: "credited", credits: 1 }) });
  const handler = createSquareWebhookHandler({ getServiceClient: () => client, env });
  const res = makeRes();
  await handler(makeWebhookReq(event, reqOpts), res);
  return { res, sb: client };
}

test("square-webhook: rejects an unsupported method with 405", async () => {
  const client = createSquareTestClient();
  const handler = createSquareWebhookHandler({ getServiceClient: () => client, env: baseEnv() });
  const res = makeRes();
  await handler({ method: "GET", headers: {}, rawBody: "" }, res);
  assert.equal(res.statusCode, 405);
});

test("square-webhook: fails closed when the signing key is absent", async () => {
  const { res } = await run({ env: baseEnv({ SQUARE_WEBHOOK_SIGNATURE_KEY: undefined }) });
  assert.equal(res.statusCode, 500);
});

// Without a pinned URL the handler cannot know what Square signed over, and
// guessing from the request host is the defect being removed.
test("square-webhook: fails closed when SQUARE_WEBHOOK_URL is not pinned", async () => {
  const { res } = await run({ env: baseEnv({ SQUARE_WEBHOOK_URL: undefined }) });
  assert.equal(res.statusCode, 500);
});

test("square-webhook: rejects a bad, empty or absent signature with 401", async () => {
  const bad = await run({ reqOpts: { signature: "not-a-real-signature" } });
  assert.equal(bad.res.statusCode, 401);

  const absent = await run({ reqOpts: { omitSignature: true } });
  assert.equal(absent.res.statusCode, 401, "a missing signature header must be rejected");

  const empty = await run({ reqOpts: { signature: "" } });
  assert.equal(empty.res.statusCode, 401);

  const nulled = await run({ reqOpts: { signature: null } });
  assert.equal(nulled.res.statusCode, 401);

  // A signature valid for a different body must not validate this one.
  const otherBody = signBody(JSON.stringify({ different: true }));
  const wrongBody = await run({ reqOpts: { signature: otherBody } });
  assert.equal(wrongBody.res.statusCode, 401);

  // Correct body, wrong signing key.
  const wrongKey = await run({ reqOpts: { key: "a-different-signing-key" } });
  assert.equal(wrongKey.res.statusCode, 401);
});

// The registered subscription URL and the host actually serving the request
// differ (apex vs www, with the apex 308-redirecting), so the signature must
// be verified against the pinned value and NOT against the request host.
test("square-webhook: verifies the signature against the pinned URL, not the request host", async () => {
  const event = completedPaymentEvent();

  const signedForPinned = await run({
    event,
    reqOpts: { host: "some-other-host.vercel.app", url: PINNED_WEBHOOK_URL },
  });
  assert.equal(signedForPinned.res.statusCode, 200, "a signature over the pinned URL must be accepted");

  const rawBody = JSON.stringify(event);
  const hostDerived = await run({
    event,
    reqOpts: {
      host: "blindspotup.com",
      signature: signBody(rawBody, "https://blindspotup.com/api/square-webhook", SIGNATURE_KEY),
    },
  });
  assert.equal(hostDerived.res.statusCode, 401, "a signature over a host-derived URL must be rejected");
});

test("square-webhook: rejects malformed JSON with 400", async () => {
  const client = createSquareTestClient();
  const handler = createSquareWebhookHandler({ getServiceClient: () => client, env: baseEnv() });
  const res = makeRes();
  const rawBody = "{not json";
  await handler(
    {
      method: "POST",
      headers: { host: "www.blindspotup.com", "x-square-hmacsha256-signature": signBody(rawBody) },
      rawBody,
      url: "/api/square-webhook",
    },
    res
  );
  assert.equal(res.statusCode, 400);
});

// Square itself must report COMPLETED. Nothing else means money moved.
test("square-webhook: does not credit unless Square reports COMPLETED", async () => {
  for (const status of ["APPROVED", "PENDING", "CANCELED", "FAILED"]) {
    const { res, sb } = await run({ event: completedPaymentEvent({ status }) });
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ignored, true);
    assert.equal(res.body.reason, "payment_not_completed");
    assert.equal(sb._calls.rpc.length, 0, `${status} must not reach the RPC`);
  }
});

test("square-webhook: ignores events that carry no payment object", async () => {
  const event = completedPaymentEvent({ mutate: (e) => delete e.data.object.payment });
  const { res, sb } = await run({ event });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.reason, "not_a_payment_event");
  assert.equal(sb._calls.rpc.length, 0);
});

// The core atomicity property observable at this layer: the handler performs
// no table writes of its own and delegates the entire money operation to one
// RPC call.
test("square-webhook: credits through exactly one RPC call and writes no tables directly", async () => {
  const { res, sb } = await run();
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.result, "credited");
  assert.equal(res.body.credits, 1);

  const processCalls = sb._calls.rpc.filter((c) => c.name === "process_square_payment");
  assert.equal(processCalls.length, 1);
  assert.deepEqual(sb._calls.inserted, [], "no direct inserts");
  assert.deepEqual(sb._calls.updated, [], "no direct updates");
  assert.deepEqual(sb._calls.tables, [], "no table should be touched outside the RPC");
});

// session_tiers must not be consulted at credit time — that was the mutable
// source that let an admin edit change a completed purchase.
test("square-webhook: never reads session_tiers when crediting", async () => {
  const { sb } = await run();
  assert.ok(!sb._calls.tables.includes("session_tiers"));
});

test("square-webhook: passes Square's reported amount and currency to the RPC for validation", async () => {
  const { sb } = await run({ event: completedPaymentEvent({ amount: 2400, currency: "USD" }) });
  const params = sb._calls.rpc.find((c) => c.name === "process_square_payment").params;
  assert.equal(params.p_square_order_id, "ORDER-ABC123");
  assert.equal(params.p_square_payment_id, "PAY-XYZ789");
  assert.equal(params.p_amount_cents, 2400);
  assert.equal(params.p_currency, "USD");
  assert.equal(params.p_location_id, EXPECTED_LOCATION);
});

test("square-webhook: a verified replay is a no-op success", async () => {
  const sb = createSquareTestClient({
    rpc: rpcReturning({ ok: true, result: "already_processed", credits: 1, repaired: false }),
  });
  const { res } = await run({ sb });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.result, "already_processed");
  assert.equal(res.body.repaired, false);
  assert.equal(sb._calls.rpc.filter((c) => c.name === "record_square_webhook_dead_letter").length, 0);
});

test("square-webhook: reports a repaired partial payment", async () => {
  const sb = createSquareTestClient({
    rpc: rpcReturning({ ok: true, result: "already_processed", credits: 5, repaired: true }),
  });
  const { res } = await run({ sb });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.repaired, true);
  assert.equal(res.body.credits, 5);
});

// A completed payment with no pending row is real money awaiting
// correlation. Answering 200 would end Square's retries and discard it.
test("square-webhook: an unmatched payment returns 503 so Square retries, and is dead-lettered", async () => {
  const sb = createSquareTestClient({ rpc: rpcReturning({ ok: false, result: "unmatched" }) });
  const { res } = await run({ sb });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.result, "unmatched");

  const dl = sb._calls.rpc.filter((c) => c.name === "record_square_webhook_dead_letter");
  assert.equal(dl.length, 1);
  assert.equal(dl[0].params.p_result_code, "unmatched");
  assert.equal(dl[0].params.p_http_status, 503);
});

test("square-webhook: retry_needed returns 503", async () => {
  const sb = createSquareTestClient({ rpc: rpcReturning({ ok: false, result: "retry_needed" }) });
  const { res } = await run({ sb });
  assert.equal(res.statusCode, 503);
});

test("square-webhook: every conflict returns 409 and is dead-lettered, never 200", async () => {
  const conflicts = [
    "amount_mismatch",
    "currency_mismatch",
    "location_mismatch",
    "conflict_payment_id",
    "conflict_status",
    "conflict_ledger_mismatch",
    "missing_snapshot",
    "invalid_order_id",
    "invalid_payment_id",
    "invalid_amount",
    "invalid_currency",
  ];
  for (const code of conflicts) {
    const sb = createSquareTestClient({ rpc: rpcReturning({ ok: false, result: code }) });
    const { res } = await run({ sb });
    assert.equal(res.statusCode, 409, `${code} must be 409`);
    assert.equal(res.body.result, code);
    const dl = sb._calls.rpc.filter((c) => c.name === "record_square_webhook_dead_letter");
    assert.equal(dl.length, 1, `${code} must be dead-lettered`);
    assert.equal(dl[0].params.p_result_code, code);
  }
});

test("square-webhook: an unknown result code is treated as a conflict, not a success", async () => {
  const sb = createSquareTestClient({ rpc: rpcReturning({ ok: true, result: "something_new" }) });
  const { res } = await run({ sb });
  assert.equal(res.statusCode, 409);
});

// Failure injection: the RPC itself fails. The event must be retryable and
// recorded, never reported as handled.
test("square-webhook: an RPC failure returns 503 and dead-letters as rpc_error", async () => {
  const sb = createSquareTestClient({
    rpc: {
      process_square_payment: () => {
        throw new Error("statement timeout");
      },
    },
  });
  const { res } = await run({ sb });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.result, "rpc_error");
  const dl = sb._calls.rpc.filter((c) => c.name === "record_square_webhook_dead_letter");
  assert.equal(dl.length, 1);
  assert.equal(dl[0].params.p_result_code, "rpc_error");
});

test("square-webhook: an RPC returning a Postgres error is retryable", async () => {
  const sb = createSquareTestClient({
    rpc: { process_square_payment: () => ({ data: null, error: { message: "deadlock detected" } }) },
  });
  const { res } = await run({ sb });
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.result, "rpc_error");
});

test("square-webhook: a shape problem is rejected before the RPC and dead-lettered", async () => {
  const cases = [
    ["invalid_order_id", (e) => delete e.data.object.payment.order_id],
    ["invalid_payment_id", (e) => delete e.data.object.payment.id],
    ["invalid_amount", (e) => (e.data.object.payment.amount_money.amount = 0)],
    ["invalid_amount", (e) => (e.data.object.payment.amount_money.amount = -500)],
    ["invalid_amount", (e) => delete e.data.object.payment.amount_money.amount],
    ["invalid_currency", (e) => delete e.data.object.payment.amount_money.currency],
    ["invalid_location", (e) => delete e.data.object.payment.location_id],
  ];
  for (const [expected, mutate] of cases) {
    const sb = createSquareTestClient({ rpc: rpcReturning({ ok: true, result: "credited", credits: 1 }) });
    const { res } = await run({ event: completedPaymentEvent({ mutate }), sb });
    assert.equal(res.statusCode, 409, `expected 409 for ${expected}`);
    assert.equal(res.body.result, expected);
    assert.equal(
      sb._calls.rpc.filter((c) => c.name === "process_square_payment").length,
      0,
      "a malformed event must not reach the RPC"
    );
    const dl = sb._calls.rpc.filter((c) => c.name === "record_square_webhook_dead_letter");
    assert.equal(dl.length, 1);
  }
});

test("square-webhook: a payment from an unexpected location is refused before the RPC", async () => {
  const sb = createSquareTestClient({ rpc: rpcReturning({ ok: true, result: "credited", credits: 1 }) });
  const { res } = await run({ event: completedPaymentEvent({ locationId: "LSOMEOTHERPLACE" }), sb });
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.result, "location_mismatch");
  assert.equal(sb._calls.rpc.filter((c) => c.name === "process_square_payment").length, 0);
});

// One dead-letter row per Square event id: a retried delivery must reuse it
// rather than accumulating duplicates.
test("square-webhook: dead-letter is keyed on Square's event id across retries", async () => {
  const event = completedPaymentEvent({ eventId: "EVT-STABLE-1" });
  const sb = createSquareTestClient({ rpc: rpcReturning({ ok: false, result: "unmatched" }) });
  const handler = createSquareWebhookHandler({ getServiceClient: () => sb, env: baseEnv() });

  for (let i = 0; i < 3; i++) {
    const res = makeRes();
    await handler(makeWebhookReq(event), res);
    assert.equal(res.statusCode, 503);
  }

  const dl = sb._calls.rpc.filter((c) => c.name === "record_square_webhook_dead_letter");
  assert.equal(dl.length, 3, "each delivery records once");
  const ids = new Set(dl.map((c) => c.params.p_square_event_id));
  assert.deepEqual([...ids], ["EVT-STABLE-1"], "all three must use the same key so the RPC upserts one row");
});

test("square-webhook: derives a stable dead-letter key when Square omits event_id", async () => {
  const event = completedPaymentEvent({ omitEventId: true });
  const sb = createSquareTestClient({ rpc: rpcReturning({ ok: false, result: "unmatched" }) });
  const handler = createSquareWebhookHandler({ getServiceClient: () => sb, env: baseEnv() });

  for (let i = 0; i < 2; i++) {
    await handler(makeWebhookReq(event), makeRes());
  }
  const dl = sb._calls.rpc.filter((c) => c.name === "record_square_webhook_dead_letter");
  const ids = new Set(dl.map((c) => c.params.p_square_event_id));
  assert.equal(ids.size, 1, "the derived key must be stable across deliveries");
  assert.equal([...ids][0], "derived:payment.updated:ORDER-ABC123:PAY-XYZ789");
  assert.ok(deadLetterEventId({}, { order_id: "O", id: "P" }).startsWith("derived:"));
});

// Only what is needed to investigate and reconcile. Square also sends buyer
// email, billing address, card fingerprint and risk evaluation.
test("square-webhook: stores only reconciliation fields, never buyer or card data", async () => {
  const event = completedPaymentEvent();
  const summary = summarizeSquarePayment(event, event.data.object.payment);

  assert.deepEqual(Object.keys(summary).sort(), [
    "amount_cents",
    "currency",
    "event_id",
    "event_type",
    "location_id",
    "order_id",
    "payment_created_at",
    "payment_id",
    "payment_status",
    "payment_updated_at",
    "receipt_url",
  ]);

  // Structural: every retained field is a flat scalar, so no nested Square
  // object (card_details, billing_address, risk_evaluation) can ride along.
  for (const [key, value] of Object.entries(summary)) {
    assert.ok(
      value === null || ["string", "number", "boolean"].includes(typeof value),
      `${key} must be a flat scalar, got ${typeof value}`
    );
  }

  const serialized = JSON.stringify(summary);
  for (const leak of [
    "buyer@example.com",
    "1 Test St",
    "86336",
    "1111",
    "sq-fingerprint-abc",
    "risk_level",
    "card_details",
    "billing_address",
  ]) {
    assert.ok(!serialized.includes(leak), `summary must not contain ${leak}`);
  }

  const { sb } = await run({ event });
  const params = sb._calls.rpc.find((c) => c.name === "process_square_payment").params;
  const sent = JSON.stringify(params.p_payment_summary);
  for (const leak of ["buyer@example.com", "sq-fingerprint-abc", "billing_address", "card_details"]) {
    assert.ok(!sent.includes(leak), `payload sent to the database must not contain ${leak}`);
  }
});

// Two concurrent deliveries of the same event: the handler must call the RPC
// once per delivery and let the database serialize them. It must never try to
// resolve the race itself.
test("square-webhook: concurrent duplicate deliveries each delegate to the RPC", async () => {
  const event = completedPaymentEvent();
  let callCount = 0;
  const sb = createSquareTestClient({
    rpc: {
      process_square_payment: () => {
        callCount += 1;
        // First caller credits; the serialized second observes the committed
        // result, exactly as the row lock and unique index guarantee.
        return callCount === 1
          ? { data: { ok: true, result: "credited", credits: 1 }, error: null }
          : { data: { ok: true, result: "already_processed", credits: 1, repaired: false }, error: null };
      },
    },
  });
  const handler = createSquareWebhookHandler({ getServiceClient: () => sb, env: baseEnv() });

  const resA = makeRes();
  const resB = makeRes();
  await Promise.all([handler(makeWebhookReq(event), resA), handler(makeWebhookReq(event), resB)]);

  assert.equal(resA.statusCode, 200);
  assert.equal(resB.statusCode, 200);
  const results = [resA.body.result, resB.body.result].sort();
  assert.deepEqual(results, ["already_processed", "credited"], "exactly one credit, one verified replay");
  assert.equal(callCount, 2);
  assert.deepEqual(sb._calls.inserted, [], "neither delivery may write a table directly");
});
