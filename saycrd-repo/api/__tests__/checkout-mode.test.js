import test from "node:test";
import assert from "node:assert/strict";
import {
  CHECKOUT_MODE_ADMIN_ONLY,
  CHECKOUT_MODE_DISABLED,
  CHECKOUT_MODE_PUBLIC,
  isCheckoutEnabled,
  resolveCheckoutMode,
} from "../_checkout-mode.js";
import { createCheckoutAvailabilityHandler } from "../checkout-availability.js";
import { makeReq, makeRes } from "./_http.js";
import { authedAs, unauthenticatedGetAuthedUser } from "./_mock-supabase.js";

// The whole safety argument for deploying Stage 2A before SQUARE_LOCATION_ID
// is corrected rests on this resolver never returning a permissive value for
// anything it does not explicitly recognise.
test("checkout mode: every unrecognised or absent value fails closed to disabled", () => {
  const shouldBeDisabled = [
    undefined,
    {},
    { CHECKOUT_MODE: undefined },
    { CHECKOUT_MODE: "" },
    { CHECKOUT_MODE: "   " },
    { CHECKOUT_MODE: "enabled" },
    { CHECKOUT_MODE: "on" },
    { CHECKOUT_MODE: "true" },
    { CHECKOUT_MODE: "1" },
    { CHECKOUT_MODE: "adminonly" },
    { CHECKOUT_MODE: "admin only" },
    { CHECKOUT_MODE: "publik" },
    { CHECKOUT_MODE: "PUBLIC_" },
    { CHECKOUT_MODE: null },
    { CHECKOUT_MODE: 1 },
    { CHECKOUT_MODE: true },
    { CHECKOUT_MODE: ["public"] },
  ];
  for (const env of shouldBeDisabled) {
    assert.equal(
      resolveCheckoutMode(env),
      CHECKOUT_MODE_DISABLED,
      `expected disabled for ${JSON.stringify(env)}`
    );
    assert.equal(isCheckoutEnabled(env), false);
  }
});

test("checkout mode: recognises the three real modes, case- and whitespace-insensitively", () => {
  assert.equal(resolveCheckoutMode({ CHECKOUT_MODE: "disabled" }), CHECKOUT_MODE_DISABLED);
  assert.equal(resolveCheckoutMode({ CHECKOUT_MODE: "admin_only" }), CHECKOUT_MODE_ADMIN_ONLY);
  assert.equal(resolveCheckoutMode({ CHECKOUT_MODE: "public" }), CHECKOUT_MODE_PUBLIC);
  assert.equal(resolveCheckoutMode({ CHECKOUT_MODE: "  ADMIN_ONLY  " }), CHECKOUT_MODE_ADMIN_ONLY);
  assert.equal(resolveCheckoutMode({ CHECKOUT_MODE: "Public" }), CHECKOUT_MODE_PUBLIC);
  assert.equal(isCheckoutEnabled({ CHECKOUT_MODE: "public" }), true);
  assert.equal(isCheckoutEnabled({ CHECKOUT_MODE: "admin_only" }), true);
  assert.equal(isCheckoutEnabled({ CHECKOUT_MODE: "disabled" }), false);
});

test("checkout-availability: reports unavailable while disabled", async () => {
  const handler = createCheckoutAvailabilityHandler({
    getAuthedUser: authedAs({ id: "u1", email: "antony@sedonya.org" }),
    env: { CHECKOUT_MODE: "disabled" },
  });
  const res = makeRes();
  await handler(makeReq({ method: "GET" }), res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { mode: "disabled", available: false, reason: "checkout_disabled" });
});

test("checkout-availability: admin_only is available only to an admin", async () => {
  const prev = process.env.ADMIN_EMAILS;
  process.env.ADMIN_EMAILS = "antony@sedonya.org";
  try {
    const adminRes = makeRes();
    await createCheckoutAvailabilityHandler({
      getAuthedUser: authedAs({ id: "u1", email: "antony@sedonya.org" }),
      env: { CHECKOUT_MODE: "admin_only" },
    })(makeReq({ method: "GET" }), adminRes);
    assert.deepEqual(adminRes.body, { mode: "admin_only", available: true, reason: null });

    const strangerRes = makeRes();
    await createCheckoutAvailabilityHandler({
      getAuthedUser: authedAs({ id: "u2", email: "someone@else.com" }),
      env: { CHECKOUT_MODE: "admin_only" },
    })(makeReq({ method: "GET" }), strangerRes);
    assert.deepEqual(strangerRes.body, { mode: "admin_only", available: false, reason: "admin_only" });

    const anonRes = makeRes();
    await createCheckoutAvailabilityHandler({
      getAuthedUser: unauthenticatedGetAuthedUser,
      env: { CHECKOUT_MODE: "admin_only" },
    })(makeReq({ method: "GET" }), anonRes);
    assert.deepEqual(anonRes.body, {
      mode: "admin_only",
      available: false,
      reason: "authentication_required",
    });
  } finally {
    if (prev === undefined) delete process.env.ADMIN_EMAILS;
    else process.env.ADMIN_EMAILS = prev;
  }
});

test("checkout-availability: rejects non-GET", async () => {
  const handler = createCheckoutAvailabilityHandler({
    getAuthedUser: unauthenticatedGetAuthedUser,
    env: { CHECKOUT_MODE: "public" },
  });
  const res = makeRes();
  await handler(makeReq({ method: "POST" }), res);
  assert.equal(res.statusCode, 405);
});
