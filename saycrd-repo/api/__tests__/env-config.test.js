// api/__tests__/env-config.test.js — Phase 1 (environment-aware Supabase):
// tests for build/env-config.js, the build-time emitter that writes the
// browser's Supabase configuration.
//
// Project resolution itself is tested in env-resolve.test.js; this file covers
// what the emitter adds on top: the rendered payload, the secret-leak
// assertion, and actually writing the file. No network, no Supabase.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  PRODUCTION_REF,
  STAGING_REF,
  renderEnvConfig,
  assertNoSecrets,
  emitEnvConfig,
} from "../../build/env-config.js";

const STAGING_URL = "https://" + STAGING_REF + ".supabase.co";

function b64url(obj) {
  return Buffer.from(JSON.stringify(obj)).toString("base64url");
}

function fakeJwt(payload) {
  return b64url({ alg: "HS256", typ: "JWT" }) + "." + b64url(payload) + ".sig";
}

const STAGING_ANON = fakeJwt({ iss: "supabase", ref: STAGING_REF, role: "anon" });
const SECRET_KEY = "sb_secret_" + "x".repeat(31);

const PREVIEW_ENV = {
  VERCEL_ENV: "preview",
  STAGING_SUPABASE_URL: STAGING_URL,
  STAGING_SUPABASE_ANON_KEY: STAGING_ANON,
  STAGING_SUPABASE_SERVICE_ROLE_KEY: SECRET_KEY,
};

test("the emitted file carries only the two browser-safe values", () => {
  const out = renderEnvConfig({ url: STAGING_URL, anonKey: STAGING_ANON });
  const parsed = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1));
  assert.deepEqual(Object.keys(parsed).sort(), ["SUPABASE_ANON_KEY", "SUPABASE_URL"]);
  assert.equal(parsed.SUPABASE_URL, STAGING_URL);
  assert.equal(parsed.SUPABASE_ANON_KEY, STAGING_ANON);
});

test("the emitted file assigns the global the browser bootstrap reads", () => {
  // index.html reads window.SAYCRD_ENV_CONFIG synchronously, so the shape of
  // this assignment is a contract with the browser, not an implementation detail.
  const out = renderEnvConfig({ url: STAGING_URL, anonKey: STAGING_ANON });
  assert.match(out, /^window\.SAYCRD_ENV_CONFIG = \{/m);
  assert.match(out, /do not commit/);
});

test("assertNoSecrets rejects secret markers in the rendered output", () => {
  assert.throws(() => assertNoSecrets('window.X = "' + SECRET_KEY + '";', {}), /sb_secret_/);
});

test("assertNoSecrets decodes JWTs, catching a service_role token the marker scan cannot see", () => {
  // A privileged JWT's payload is base64-encoded, so the literal string
  // "service_role" never appears in the token. Only decoding catches it.
  const serviceJwt = fakeJwt({ ref: STAGING_REF, role: "service_role" });
  assert.ok(!serviceJwt.includes("service_role"), "precondition: the marker is not visible in the token");
  assert.throws(() => assertNoSecrets('window.X = "' + serviceJwt + '";', {}), /non-browser-safe JWT/);

  // An anon JWT is legitimate and must still pass.
  assert.equal(assertNoSecrets('window.X = "' + STAGING_ANON + '";', {}), true);
});

test("assertNoSecrets rejects the literal value of any known secret variable", () => {
  // Catches a leak even when the value carries no recognisable marker.
  const opaque = "opaque-secret-value-with-no-marker";
  assert.throws(
    () => assertNoSecrets('window.X = "' + opaque + '";', { POSTGRES_PASSWORD: opaque }),
    /contains the value of POSTGRES_PASSWORD/
  );
  assert.throws(
    () => assertNoSecrets('window.X = "' + opaque + '";', { SUPABASE_JWT_SECRET: opaque }),
    /contains the value of SUPABASE_JWT_SECRET/
  );
});

test("assertNoSecrets passes a legitimate browser config", () => {
  const out = renderEnvConfig({ url: STAGING_URL, anonKey: STAGING_ANON });
  assert.equal(assertNoSecrets(out, PREVIEW_ENV), true);
});

test("emitEnvConfig writes a staging config that leaks nothing", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "saycrd-env-"));
  try {
    const { outPath, config } = emitEnvConfig(PREVIEW_ENV, dir);
    assert.equal(path.basename(outPath), "env-config.js");
    assert.equal(config.ref, STAGING_REF);
    assert.equal(config.target, "preview");

    const written = fs.readFileSync(outPath, "utf8");
    assert.ok(written.includes(STAGING_REF), "must point at staging");
    assert.ok(!written.includes(PRODUCTION_REF), "must not mention the production ref");
    assert.ok(!written.includes(SECRET_KEY), "must not contain the service key");
    assert.ok(!written.includes("sb_secret_"));
    assert.ok(!written.includes("service_role"));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("emitEnvConfig writes nothing when resolution fails", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "saycrd-env-"));
  try {
    // Preview with production variables only: must abort, not write a file.
    assert.throws(
      () =>
        emitEnvConfig(
          { VERCEL_ENV: "preview", SUPABASE_URL: "https://" + PRODUCTION_REF + ".supabase.co" },
          dir
        ),
      /STAGING_SUPABASE_URL/
    );
    assert.equal(fs.existsSync(path.join(dir, "env-config.js")), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
