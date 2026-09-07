import test from "node:test";
import assert from "node:assert/strict";
import { createSquareCheckoutHandler } from "../square-checkout.js";
import { createSquareTestClient, EXPECTED_LOCATION } from "./_square-fakes.js";
import { makeReq, makeRes } from "./_http.js";
import { authedAs, unauthenticatedGetAuthedUser } from "./_mock-supabase.js";

const ADMIN = { id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa", email: "antony@sedonya.org" };
const STRANGER = { id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", email: "someone@else.com" };
const TIER_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";

const TIER = {
  id: TIER_ID,
  name: "One session",
  session_count: 1,
  price_cents: 1200,
  currency: "usd",
  active: true,
};

function baseEnv(overrides = {}) {
  return {
    SQUARE_ACCESS_TOKEN: "test-token",
    SQUARE_ENVIRONMENT: "production",
    SQUARE_LOCATION_ID: EXPECTED_LOCATION,
    ...overrides,
  };
}

function okSquareFetch(calls) {
  return async function fetchImpl(url, init) {
    calls.push({ url, init });
    return {
      ok: true,
      async json() {
        return {
          payment_link: {
            id: "LINK-1",
            order_id: "ORDER-ABC123",
            url: "https://square.link/u/testlink",
          },
        };
      },
    };
  };
}

function handlerFor({ env, user, sb, fetchCalls }) {
  return createSquareCheckoutHandler({
    getAuthedUser: user ? authedAs(user) : unauthenticatedGetAuthedUser,
    getServiceClient: () => sb,
    env,
    fetchImpl: okSquareFetch(fetchCalls),
  });
}

function withAdminEmails(fn) {
  return async () => {
    const prev = process.env.ADMIN_EMAILS;
    process.env.ADMIN_EMAILS = "antony@sedonya.org";
    try {
      await fn();
    } finally {
      if (prev === undefined) delete process.env.ADMIN_EMAILS;
      else process.env.ADMIN_EMAILS = prev;
    }
  };
}

test("square-checkout: rejects an unsupported method with 405", async () => {
  const fetchCalls = [];
  const sb = createSquareTestClient({ tiers: [TIER] });
  const res = makeRes();
  await handlerFor({ env: baseEnv({ CHECKOUT_MODE: "public" }), user: ADMIN, sb, fetchCalls })(
    makeReq({ method: "GET" }),
    res
  );
  assert.equal(res.statusCode, 405);
  assert.equal(fetchCalls.length, 0);
});

// The central Stage 2A property: while the gate is closed nothing reaches
// Square, so the known-bad SQUARE_LOCATION_ID cannot be exercised.
test("square-checkout: CHECKOUT_MODE unset returns 503 and never calls Square or the database", async () => {
  const fetchCalls = [];
  const sb = createSquareTestClient({ tiers: [TIER] });
  const res = makeRes();
  await handlerFor({ env: baseEnv(), user: ADMIN, sb, fetchCalls })(
    makeReq({ method: "POST", body: { tierId: TIER_ID } }),
    res
  );
  assert.equal(res.statusCode, 503);
  assert.equal(res.body.reason, "checkout_disabled");
  assert.equal(res.body.mode, "disabled");
  assert.equal(fetchCalls.length, 0, "Square must not be called while disabled");
  assert.deepEqual(sb._calls.tables, [], "no table should be touched while disabled");
  assert.deepEqual(sb._calls.inserted, []);
});

test("square-checkout: a malformed CHECKOUT_MODE also returns 503", async () => {
  for (const mode of ["enabled", "on", "true", "publik", ""]) {
    const fetchCalls = [];
    const sb = createSquareTestClient({ tiers: [TIER] });
    const res = makeRes();
    await handlerFor({ env: baseEnv({ CHECKOUT_MODE: mode }), user: ADMIN, sb, fetchCalls })(
      makeReq({ method: "POST", body: { tierId: TIER_ID } }),
      res
    );
    assert.equal(res.statusCode, 503, `mode "${mode}" must be treated as disabled`);
    assert.equal(fetchCalls.length, 0);
  }
});

test(
  "square-checkout: admin_only rejects an unauthenticated caller with 401 before calling Square",
  withAdminEmails(async () => {
    const fetchCalls = [];
    const sb = createSquareTestClient({ tiers: [TIER] });
    const res = makeRes();
    await handlerFor({ env: baseEnv({ CHECKOUT_MODE: "admin_only" }), user: null, sb, fetchCalls })(
      makeReq({ method: "POST", body: { tierId: TIER_ID } }),
      res
    );
    assert.equal(res.statusCode, 401);
    assert.equal(fetchCalls.length, 0);
    assert.deepEqual(sb._calls.inserted, []);
  })
);

test(
  "square-checkout: admin_only rejects a non-admin with 403 before calling Square",
  withAdminEmails(async () => {
    const fetchCalls = [];
    const sb = createSquareTestClient({ tiers: [TIER] });
    const res = makeRes();
    await handlerFor({ env: baseEnv({ CHECKOUT_MODE: "admin_only" }), user: STRANGER, sb, fetchCalls })(
      makeReq({ method: "POST", body: { tierId: TIER_ID } }),
      res
    );
    assert.equal(res.statusCode, 403);
    assert.equal(res.body.reason, "admin_only");
    assert.equal(fetchCalls.length, 0);
    assert.deepEqual(sb._calls.inserted, []);
  })
);

// The identity that matters is the one from the verified JWT. A body-supplied
// email must not be able to promote a stranger into the allowlist.
test(
  "square-checkout: a client-supplied admin email in the body does not grant access",
  withAdminEmails(async () => {
    const fetchCalls = [];
    const sb = createSquareTestClient({ tiers: [TIER] });
    const res = makeRes();
    await handlerFor({ env: baseEnv({ CHECKOUT_MODE: "admin_only" }), user: STRANGER, sb, fetchCalls })(
      makeReq({
        method: "POST",
        body: { tierId: TIER_ID, email: "antony@sedonya.org", user: { email: "antony@sedonya.org" } },
        headers: { "x-user-email": "antony@sedonya.org" },
      }),
      res
    );
    assert.equal(res.statusCode, 403);
    assert.equal(fetchCalls.length, 0);
  })
);

test(
  "square-checkout: admin_only lets a verified admin through and snapshots the purchase terms",
  withAdminEmails(async () => {
    const fetchCalls = [];
    const sb = createSquareTestClient({ tiers: [TIER] });
    const res = makeRes();
    await handlerFor({ env: baseEnv({ CHECKOUT_MODE: "admin_only" }), user: ADMIN, sb, fetchCalls })(
      makeReq({ method: "POST", body: { tierId: TIER_ID }, headers: { host: "www.blindspotup.com" } }),
      res
    );
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.url, "https://square.link/u/testlink");
    assert.equal(fetchCalls.length, 1);

    assert.equal(sb._calls.inserted.length, 1);
    const { table, row } = sb._calls.inserted[0];
    assert.equal(table, "square_payments");
    assert.equal(row.status, "pending");
    assert.equal(row.user_id, ADMIN.id);
    assert.equal(row.square_order_id, "ORDER-ABC123");
    // The snapshot the webhook will validate against, so a later tier edit
    // cannot change what this buyer receives.
    assert.equal(row.amount_cents, 1200);
    assert.equal(row.session_count, 1);
    assert.equal(row.currency, "USD");
    assert.equal(row.square_location_id, EXPECTED_LOCATION);
  })
);

test("square-checkout: public mode still requires authentication", async () => {
  const fetchCalls = [];
  const sb = createSquareTestClient({ tiers: [TIER] });
  const res = makeRes();
  await handlerFor({ env: baseEnv({ CHECKOUT_MODE: "public" }), user: null, sb, fetchCalls })(
    makeReq({ method: "POST", body: { tierId: TIER_ID } }),
    res
  );
  assert.equal(res.statusCode, 401);
  assert.equal(fetchCalls.length, 0);
});

test("square-checkout: refuses to create a link when the location is misconfigured", async () => {
  const fetchCalls = [];
  const sb = createSquareTestClient({ tiers: [TIER] });
  const res = makeRes();
  await handlerFor({
    env: baseEnv({
      CHECKOUT_MODE: "public",
      SQUARE_LOCATION_ID: "sq0idp-wrong-application-id",
      SQUARE_EXPECTED_LOCATION_ID: EXPECTED_LOCATION,
    }),
    user: ADMIN,
    sb,
    fetchCalls,
  })(makeReq({ method: "POST", body: { tierId: TIER_ID } }), res);
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.reason, "location_misconfigured");
  assert.equal(fetchCalls.length, 0, "must not create a link against an unexpected location");
});

test("square-checkout: a tier with a non-positive session_count cannot be sold", async () => {
  const fetchCalls = [];
  const sb = createSquareTestClient({ tiers: [{ ...TIER, session_count: 0 }] });
  const res = makeRes();
  await handlerFor({ env: baseEnv({ CHECKOUT_MODE: "public" }), user: ADMIN, sb, fetchCalls })(
    makeReq({ method: "POST", body: { tierId: TIER_ID } }),
    res
  );
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.reason, "invalid_tier");
  assert.equal(fetchCalls.length, 0);
});

test("square-checkout: requires a tierId", async () => {
  const fetchCalls = [];
  const sb = createSquareTestClient({ tiers: [TIER] });
  const res = makeRes();
  await handlerFor({ env: baseEnv({ CHECKOUT_MODE: "public" }), user: ADMIN, sb, fetchCalls })(
    makeReq({ method: "POST", body: {} }),
    res
  );
  assert.equal(res.statusCode, 400);
  assert.equal(fetchCalls.length, 0);
});

// Failure injection: Square created a payable link, then the pending-row
// insert failed. The link is NOT inert — it must be recorded, with its URL,
// so it can be voided or reconciled.
test("square-checkout: records an orphaned payable link when the pending insert fails", async () => {
  const fetchCalls = [];
  const sb = createSquareTestClient({
    tiers: [TIER],
    insertError: { code: "08006", message: "connection failure" },
    rpc: { record_square_orphaned_link: () => ({ data: { ok: true, result: "recorded" }, error: null }) },
  });
  const res = makeRes();
  await handlerFor({ env: baseEnv({ CHECKOUT_MODE: "public" }), user: ADMIN, sb, fetchCalls })(
    makeReq({ method: "POST", body: { tierId: TIER_ID } }),
    res
  );

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.reason, "pending_insert_failed");
  assert.ok(!res.body.url, "a checkout URL must not be returned when the pending row is missing");

  const orphanCalls = sb._calls.rpc.filter((c) => c.name === "record_square_orphaned_link");
  assert.equal(orphanCalls.length, 1, "the orphaned link must be recorded exactly once");
  const p = orphanCalls[0].params;
  assert.equal(p.p_square_order_id, "ORDER-ABC123");
  assert.equal(p.p_checkout_url, "https://square.link/u/testlink", "the payable URL must be retained");
  assert.equal(p.p_square_payment_link_id, "LINK-1");
  assert.equal(p.p_user_id, ADMIN.id);
  assert.equal(p.p_amount_cents, 1200);
  assert.equal(p.p_currency, "USD");
  assert.equal(p.p_session_count, 1);
  assert.equal(p.p_failure_code, "pending_insert_failed");
});

test("square-checkout: still fails safely if recording the orphaned link also fails", async () => {
  const fetchCalls = [];
  const sb = createSquareTestClient({
    tiers: [TIER],
    insertError: { code: "08006", message: "connection failure" },
    rpc: {
      record_square_orphaned_link: () => {
        throw new Error("database unreachable");
      },
    },
  });
  const res = makeRes();
  await handlerFor({ env: baseEnv({ CHECKOUT_MODE: "public" }), user: ADMIN, sb, fetchCalls })(
    makeReq({ method: "POST", body: { tierId: TIER_ID } }),
    res
  );
  assert.equal(res.statusCode, 500);
  assert.equal(res.body.reason, "pending_insert_failed");
  assert.ok(!res.body.url);
});

test("square-checkout: a Square error is reported as 502 and writes nothing", async () => {
  const sb = createSquareTestClient({ tiers: [TIER] });
  const handler = createSquareCheckoutHandler({
    getAuthedUser: authedAs(ADMIN),
    getServiceClient: () => sb,
    env: baseEnv({ CHECKOUT_MODE: "public" }),
    fetchImpl: async () => ({
      ok: false,
      async json() {
        return { errors: [{ code: "INVALID_LOCATION", detail: "Location not found" }] };
      },
    }),
  });
  const res = makeRes();
  await handler(makeReq({ method: "POST", body: { tierId: TIER_ID } }), res);
  assert.equal(res.statusCode, 502);
  assert.deepEqual(sb._calls.inserted, []);
});
