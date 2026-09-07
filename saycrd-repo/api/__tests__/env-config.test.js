// api/__tests__/env-config.test.js — Phase 1 (environment-aware Supabase):
// unit tests for build/env-config.js, the build-time emitter that writes the
// browser's Supabase configuration. These are the safety rails that keep a
// Preview deployment off the production database and keep a secret key out of
// a file served to browsers, so they assert the *refusals* as much as the
// happy paths. No network, no filesystem, no Supabase.
import test from "node:test";
import assert from "node:assert/strict";
import {
  PRODUCTION_REF,
  extractProjectRef,
  classifyKey,
  resolveBrowserConfig,
  renderEnvConfig,
} from "../../build/env-config.js";

const STAGING_REF = "lbydmtgeojnozzhwsava";
const PROD_URL = "https://" + PRODUCTION_REF + ".supabase.co";
const STAGING_URL = "https://" + STAGING_REF + ".supabase.co";

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

// Shaped like a real Supabase key but signed with nothing — these tests only
// ever inspect the payload, never verify a signature.
function fakeJwt(payload) {
  return b64url({ alg: "HS256", typ: "JWT" }) + "." + b64url(payload) + ".sig";
}

const PROD_ANON = fakeJwt({ iss: "supabase", ref: PRODUCTION_REF, role: "anon" });
const STAGING_ANON = fakeJwt({ iss: "supabase", ref: STAGING_REF, role: "anon" });
const STAGING_SERVICE = fakeJwt({ iss: "supabase", ref: STAGING_REF, role: "service_role" });

test("extractProjectRef reads the ref from a project URL and rejects anything else", () => {
  assert.equal(extractProjectRef(PROD_URL), PRODUCTION_REF);
  assert.equal(extractProjectRef(STAGING_URL + "/"), STAGING_REF);
  assert.equal(extractProjectRef("https://example.com"), null);
  assert.equal(extractProjectRef("not a url"), null);
  assert.equal(extractProjectRef(""), null);
});

test("classifyKey admits only browser-safe key formats", () => {
  assert.equal(classifyKey(STAGING_ANON).browserSafe, true);
  assert.equal(classifyKey(STAGING_ANON).kind, "legacy-anon-jwt");
  assert.equal(classifyKey("sb_publishable_" + "x".repeat(31)).browserSafe, true);

  // The three that must never reach a browser.
  assert.equal(classifyKey("sb_secret_" + "x".repeat(31)).browserSafe, false);
  assert.equal(classifyKey(STAGING_SERVICE).browserSafe, false);
  assert.equal(classifyKey("some-random-token").browserSafe, false);
});

test("a missing URL or missing anon key fails the build", () => {
  assert.throws(
    () => resolveBrowserConfig({ NEXT_PUBLIC_SUPABASE_ANON_KEY: PROD_ANON }),
    /NEXT_PUBLIC_SUPABASE_URL/
  );
  assert.throws(() => resolveBrowserConfig({ NEXT_PUBLIC_SUPABASE_URL: PROD_URL }), /ANON_KEY/);
});

test("a service-role or secret key is refused instead of emitted", () => {
  assert.throws(
    () =>
      resolveBrowserConfig({
        NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: STAGING_SERVICE,
      }),
    /non-browser-safe/
  );
  assert.throws(
    () =>
      resolveBrowserConfig({
        NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_" + "x".repeat(31),
      }),
    /non-browser-safe/
  );
});

test("browser and API pointing at different projects fails the build", () => {
  // This is the split-brain the whole phase exists to prevent: the browser would
  // mint production JWTs that a staging API cannot verify.
  assert.throws(
    () =>
      resolveBrowserConfig({
        NEXT_PUBLIC_SUPABASE_URL: PROD_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: PROD_ANON,
        SUPABASE_URL: STAGING_URL,
      }),
    /project mismatch/
  );
});

test("an anon key from a different project than the URL fails the build", () => {
  assert.throws(
    () =>
      resolveBrowserConfig({
        NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: PROD_ANON,
      }),
    /must match/
  );
});

test("Preview refuses to build against the production project", () => {
  assert.throws(
    () =>
      resolveBrowserConfig({
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_SUPABASE_URL: PROD_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: PROD_ANON,
        SUPABASE_URL: PROD_URL,
      }),
    /Preview build resolved the production Supabase ref/
  );
});

test("Production refuses to build against a non-production project", () => {
  assert.throws(
    () =>
      resolveBrowserConfig({
        VERCEL_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: STAGING_ANON,
        SUPABASE_URL: STAGING_URL,
      }),
    /not the production project/
  );
});

test("the intended Production and Preview configurations both resolve", () => {
  const prod = resolveBrowserConfig({
    VERCEL_ENV: "production",
    NEXT_PUBLIC_SUPABASE_URL: PROD_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: PROD_ANON,
    SUPABASE_URL: PROD_URL,
  });
  assert.equal(prod.ref, PRODUCTION_REF);
  assert.equal(prod.target, "production");

  const preview = resolveBrowserConfig({
    VERCEL_ENV: "preview",
    NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: STAGING_ANON,
    SUPABASE_URL: STAGING_URL,
  });
  assert.equal(preview.ref, STAGING_REF);
  assert.equal(preview.target, "preview");
});

test("a local build with no VERCEL_ENV is allowed but still validated", () => {
  const local = resolveBrowserConfig({
    NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: STAGING_ANON,
  });
  assert.equal(local.target, "local");

  assert.throws(
    () =>
      resolveBrowserConfig({
        NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_secret_" + "x".repeat(31),
      }),
    /non-browser-safe/
  );
});

test("the emitted file carries only the two browser-safe values", () => {
  const out = renderEnvConfig({ url: STAGING_URL, anonKey: STAGING_ANON });
  const parsed = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  assert.deepEqual(Object.keys(parsed).sort(), ["SUPABASE_ANON_KEY", "SUPABASE_URL"]);
  assert.equal(parsed.SUPABASE_URL, STAGING_URL);
});

test("a staging build leaks no production project ref into the emitted file", () => {
  const out = renderEnvConfig(
    resolveBrowserConfig({
      VERCEL_ENV: "preview",
      NEXT_PUBLIC_SUPABASE_URL: STAGING_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: STAGING_ANON,
      SUPABASE_URL: STAGING_URL,
    })
  );
  assert.ok(!out.includes(PRODUCTION_REF), "emitted config must not mention the production ref");
  assert.ok(out.includes(STAGING_REF));
});
