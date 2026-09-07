// api/__tests__/env-resolve.test.js — Phase 1 (environment-aware Supabase):
// unit tests for api/_env.js, the single resolver both the build-time browser
// emitter and the runtime service client go through.
//
// These are the safety rails that keep Preview and local development off the
// production database, keep Production off staging, and keep a secret key out
// of a file served to browsers — so they assert the *refusals* at least as
// hard as the happy paths. No network, no filesystem, no Supabase.
import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTION_REF,
  STAGING_REF,
  extractProjectRef,
  classifyKey,
  resolveTarget,
  resolveSupabaseEnv,
  resolveBrowserConfig,
  resolveServerConfig,
} from "../_env.js";

const PROD_URL = "https://" + PRODUCTION_REF + ".supabase.co";
const STAGING_URL = "https://" + STAGING_REF + ".supabase.co";
const THIRD_REF = "abcdefghijklmnopqrst";
const THIRD_URL = "https://" + THIRD_REF + ".supabase.co";

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

// Shaped like a real Supabase key but signed with nothing — these tests only
// inspect the payload, never verify a signature.
function fakeJwt(payload) {
  return b64url({ alg: "HS256", typ: "JWT" }) + "." + b64url(payload) + ".sig";
}

const PROD_ANON = fakeJwt({ iss: "supabase", ref: PRODUCTION_REF, role: "anon" });
const STAGING_ANON = fakeJwt({ iss: "supabase", ref: STAGING_REF, role: "anon" });
const STAGING_SERVICE_JWT = fakeJwt({ iss: "supabase", ref: STAGING_REF, role: "service_role" });
const SECRET_KEY = "sb_secret_" + "x".repeat(31);
const PUBLISHABLE_KEY = "sb_publishable_" + "x".repeat(31);

// The intended configurations, used as the baseline the failure cases deviate from.
const PROD_ENV = {
  VERCEL_ENV: "production",
  SUPABASE_URL: PROD_URL,
  NEXT_PUBLIC_SUPABASE_URL: PROD_URL,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: PROD_ANON,
  SUPABASE_SERVICE_ROLE_KEY: SECRET_KEY,
};

const PREVIEW_ENV = {
  VERCEL_ENV: "preview",
  STAGING_SUPABASE_URL: STAGING_URL,
  STAGING_SUPABASE_ANON_KEY: STAGING_ANON,
  STAGING_SUPABASE_SERVICE_ROLE_KEY: SECRET_KEY,
};

/* ---------- primitives ---------- */

test("extractProjectRef reads the ref from a project URL and rejects anything else", () => {
  assert.equal(extractProjectRef(PROD_URL), PRODUCTION_REF);
  assert.equal(extractProjectRef(STAGING_URL + "/"), STAGING_REF);
  assert.equal(extractProjectRef("https://example.com"), null);
  assert.equal(extractProjectRef("https://short.supabase.co"), null);
  assert.equal(extractProjectRef("not a url"), null);
  assert.equal(extractProjectRef(""), null);
});

test("classifyKey admits only browser-safe key formats", () => {
  assert.equal(classifyKey(STAGING_ANON).browserSafe, true);
  assert.equal(classifyKey(STAGING_ANON).kind, "legacy-anon-jwt");
  assert.equal(classifyKey(STAGING_ANON).ref, STAGING_REF);
  assert.equal(classifyKey(PUBLISHABLE_KEY).browserSafe, true);
  // Publishable keys are opaque, so they carry no ref to cross-check.
  assert.equal(classifyKey(PUBLISHABLE_KEY).ref, null);

  // The four that must never reach a browser.
  assert.equal(classifyKey(SECRET_KEY).browserSafe, false);
  assert.equal(classifyKey(STAGING_SERVICE_JWT).browserSafe, false);
  assert.equal(classifyKey("eyJnot-a-real-jwt").browserSafe, false);
  assert.equal(classifyKey("some-random-token").browserSafe, false);
});

/* ---------- target selection ---------- */

test("an absent VERCEL_ENV is treated as development, and an unknown one aborts", () => {
  assert.equal(resolveTarget({}), "development");
  assert.equal(resolveTarget({ VERCEL_ENV: "" }), "development");
  assert.equal(resolveTarget({ VERCEL_ENV: "Production" }), "production");
  assert.throws(() => resolveTarget({ VERCEL_ENV: "staging" }), /Unrecognised VERCEL_ENV/);
});

test("Preview and development read STAGING_*, ignoring the production variables entirely", () => {
  // Production variables are present here and must be ignored.
  const preview = resolveSupabaseEnv({ ...PREVIEW_ENV, ...PROD_ENV, VERCEL_ENV: "preview" });
  assert.equal(preview.ref, STAGING_REF);
  assert.equal(preview.source, "staging");
  assert.equal(preview.urlVar, "STAGING_SUPABASE_URL");

  const dev = resolveSupabaseEnv({ ...PREVIEW_ENV, ...PROD_ENV, VERCEL_ENV: "development" });
  assert.equal(dev.ref, STAGING_REF);
  assert.equal(dev.source, "staging");

  // A local build with no VERCEL_ENV at all behaves like development.
  const local = resolveSupabaseEnv({ ...PREVIEW_ENV, ...PROD_ENV, VERCEL_ENV: "" });
  assert.equal(local.target, "development");
  assert.equal(local.ref, STAGING_REF);
});

test("Production reads the integration-managed variables", () => {
  const prod = resolveSupabaseEnv(PROD_ENV);
  assert.equal(prod.ref, PRODUCTION_REF);
  assert.equal(prod.source, "production");
  assert.equal(prod.urlVar, "SUPABASE_URL");
});

/* ---------- the required aborts ---------- */

test("Preview aborts if it resolves the production project", () => {
  assert.throws(
    () => resolveSupabaseEnv({ VERCEL_ENV: "preview", STAGING_SUPABASE_URL: PROD_URL }),
    /must use the staging project.*resolved the PRODUCTION project/s
  );
});

test("Preview aborts if it resolves any third project", () => {
  assert.throws(
    () => resolveSupabaseEnv({ VERCEL_ENV: "preview", STAGING_SUPABASE_URL: THIRD_URL }),
    /must use the staging project.*project abcdefghijklmnopqrst/s
  );
});

test("Production aborts if it resolves the staging branch", () => {
  assert.throws(
    () => resolveSupabaseEnv({ VERCEL_ENV: "production", SUPABASE_URL: STAGING_URL }),
    /must use the production project.*resolved the STAGING branch/s
  );
});

test("development aborts if it resolves production, so local work cannot reach it", () => {
  assert.throws(
    () => resolveSupabaseEnv({ VERCEL_ENV: "development", STAGING_SUPABASE_URL: PROD_URL }),
    /must use the staging project.*resolved the PRODUCTION project/s
  );
});

test("missing staging variables fail closed instead of falling back to production", () => {
  // Every production variable is present and correct; none may be used.
  assert.throws(
    () => resolveSupabaseEnv({ ...PROD_ENV, VERCEL_ENV: "preview" }),
    /No Supabase URL for target preview.*STAGING_SUPABASE_URL/s
  );
  assert.throws(
    () => resolveBrowserConfig({ ...PROD_ENV, VERCEL_ENV: "preview", STAGING_SUPABASE_URL: STAGING_URL }),
    /No browser key for target preview.*STAGING_SUPABASE_ANON_KEY/s
  );
  assert.throws(
    () => resolveServerConfig({ ...PROD_ENV, VERCEL_ENV: "preview", STAGING_SUPABASE_URL: STAGING_URL }),
    /No Supabase service key for target preview.*STAGING_SUPABASE_SERVICE_ROLE_KEY/s
  );
});

test("an unparseable Supabase URL aborts", () => {
  assert.throws(
    () => resolveSupabaseEnv({ VERCEL_ENV: "preview", STAGING_SUPABASE_URL: "https://example.com" }),
    /not a recognisable Supabase project URL/
  );
});

/* ---------- key-slot confusion ---------- */

test("a secret or service-role key is refused for the browser instead of emitted", () => {
  for (const bad of [SECRET_KEY, STAGING_SERVICE_JWT, "totally-unknown-format"]) {
    assert.throws(
      () => resolveBrowserConfig({ ...PREVIEW_ENV, STAGING_SUPABASE_ANON_KEY: bad }),
      /non-browser-safe key/
    );
  }
});

test("a browser-safe key in the service slot is refused, since it would be subject to RLS", () => {
  assert.throws(
    () => resolveServerConfig({ ...PREVIEW_ENV, STAGING_SUPABASE_SERVICE_ROLE_KEY: STAGING_ANON }),
    /not a service key/
  );
  assert.throws(
    () => resolveServerConfig({ ...PREVIEW_ENV, STAGING_SUPABASE_SERVICE_ROLE_KEY: PUBLISHABLE_KEY }),
    /not a service key/
  );
});

test("the existing sb_secret_ staging key is accepted as a service key", () => {
  const server = resolveServerConfig(PREVIEW_ENV);
  assert.equal(server.keyKind, "secret");
  assert.equal(server.ref, STAGING_REF);
  assert.equal(server.keyVar, "STAGING_SUPABASE_SERVICE_ROLE_KEY");
});

test("a key belonging to a different project than the URL aborts on both paths", () => {
  assert.throws(
    () => resolveBrowserConfig({ ...PREVIEW_ENV, STAGING_SUPABASE_ANON_KEY: PROD_ANON }),
    /belongs to project .* These must match/s
  );
  assert.throws(
    () =>
      resolveServerConfig({
        ...PREVIEW_ENV,
        STAGING_SUPABASE_SERVICE_ROLE_KEY: fakeJwt({ ref: PRODUCTION_REF, role: "service_role" }),
      }),
    /belongs to project .* These must match/s
  );
});

/* ---------- the property that matters most ---------- */

test("the browser and the server always resolve the same project", () => {
  // Split-brain is structurally impossible: both paths derive the URL from the
  // same variable list, so they cannot disagree.
  for (const env of [PROD_ENV, PREVIEW_ENV, { ...PREVIEW_ENV, VERCEL_ENV: "development" }]) {
    const browser = resolveBrowserConfig(env);
    const server = resolveServerConfig(env);
    assert.equal(browser.url, server.url);
    assert.equal(browser.ref, server.ref);
    assert.equal(browser.target, server.target);
  }
});

test("the browser config never carries the service key", () => {
  const browser = resolveBrowserConfig(PREVIEW_ENV);
  assert.equal(browser.anonKey, STAGING_ANON);
  assert.notEqual(browser.anonKey, PREVIEW_ENV.STAGING_SUPABASE_SERVICE_ROLE_KEY);
  assert.ok(!Object.values(browser).includes(SECRET_KEY));
});

test("the intended Production and Preview configurations both resolve cleanly", () => {
  const prod = resolveBrowserConfig(PROD_ENV);
  assert.equal(prod.ref, PRODUCTION_REF);
  assert.equal(prod.target, "production");
  assert.equal(prod.source, "production");

  const preview = resolveBrowserConfig(PREVIEW_ENV);
  assert.equal(preview.ref, STAGING_REF);
  assert.equal(preview.target, "preview");
  assert.equal(preview.source, "staging");
});
