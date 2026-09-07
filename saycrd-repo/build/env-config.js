// Generates public/env-config.js — the browser's Supabase configuration — from
// environment variables at build time, so a Preview deployment can point its
// browser at the staging Supabase project while Production points at production.
//
// Why this exists: public/index.html is a plain static asset (vercel.json sets
// framework:null + outputDirectory:public), so the browser has no access to
// environment variables. The Supabase URL and anon key were therefore hardcoded
// in index.html, which meant EVERY deployment — Preview included — signed users
// in against the production project. The server half of the app already reads
// process.env (api/_lib.js), so pointing a Preview's API at staging while its
// browser still authenticated against production would hand the API
// production-issued JWTs that its staging service client cannot verify: blanket
// 401s, and any write that did land would hit the wrong database.
//
// Only browser-safe values are ever emitted. A secret or service-role key is
// rejected rather than written, and every failure aborts the build instead of
// shipping a file that would send real users to the wrong project.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PRODUCTION_REF = "lydamoxkymwuccepeeyz";

// A Supabase project ref is 20 lowercase letters; the staging environment is a
// Supabase *branch* of production, which gets its own ref of the same shape.
const REF_PATTERN = /^[a-z]{20}$/;

export function extractProjectRef(url) {
  const match = /^https:\/\/([a-z0-9-]+)\.supabase\.co\/?$/i.exec(String(url || "").trim());
  if (!match) return null;
  const ref = match[1].toLowerCase();
  return REF_PATTERN.test(ref) ? ref : null;
}

function decodeJwtPayload(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch (e) {
    return null;
  }
}

// Decides whether a key may be handed to a browser at all. Anything we cannot
// positively identify as browser-safe is refused, so an unrecognised future key
// format fails the build rather than silently shipping.
export function classifyKey(key) {
  const value = String(key || "");
  if (value.startsWith("sb_secret_")) {
    return { browserSafe: false, kind: "secret", reason: "modern secret key" };
  }
  if (value.startsWith("sb_publishable_")) {
    return { browserSafe: true, kind: "publishable", ref: null };
  }
  if (value.startsWith("eyJ")) {
    const payload = decodeJwtPayload(value);
    if (!payload) {
      return { browserSafe: false, kind: "malformed-jwt", reason: "unreadable JWT payload" };
    }
    if (payload.role !== "anon") {
      return {
        browserSafe: false,
        kind: "privileged-jwt",
        reason: 'JWT role is "' + payload.role + '", not "anon"',
      };
    }
    return { browserSafe: true, kind: "legacy-anon-jwt", ref: payload.ref || null };
  }
  return { browserSafe: false, kind: "unrecognised", reason: "unrecognised key format" };
}

// Resolves and fully validates the browser configuration, or throws with an
// actionable message. Never includes key material in an error.
export function resolveBrowserConfig(env) {
  const browserUrl = (env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  const serverUrl = (env.SUPABASE_URL || "").trim();
  const url = browserUrl || serverUrl;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL) is not set — refusing to emit a browser config with no Supabase project."
    );
  }

  const ref = extractProjectRef(url);
  if (!ref) {
    throw new Error(
      "Supabase URL is not a recognisable project URL (expected https://<20-char-ref>.supabase.co)."
    );
  }

  // Split-brain guard: the browser and the API must agree on the project, or
  // every session token the browser mints will fail server-side verification.
  if (browserUrl && serverUrl) {
    const serverRef = extractProjectRef(serverUrl);
    if (serverRef && serverRef !== ref) {
      throw new Error(
        "Supabase project mismatch: the browser would use ref " +
          ref +
          " while the API uses ref " +
          serverRef +
          ". Point NEXT_PUBLIC_SUPABASE_URL and SUPABASE_URL at the same project."
      );
    }
  }

  const key = (env.NEXT_PUBLIC_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || "").trim();
  if (!key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) is not set — refusing to emit a browser config with no anon key."
    );
  }

  const classified = classifyKey(key);
  if (!classified.browserSafe) {
    throw new Error(
      "Refusing to write a non-browser-safe key into env-config.js (" +
        classified.reason +
        "). Use the project's anon or publishable key, never a service-role or secret key."
    );
  }

  // A legacy anon JWT carries the project ref it belongs to, so we can prove the
  // key and the URL describe the same project. Publishable keys are opaque and
  // carry no ref, so this check does not apply to them.
  if (classified.kind === "legacy-anon-jwt" && classified.ref && classified.ref !== ref) {
    throw new Error(
      "Anon key belongs to project " +
        classified.ref +
        " but the Supabase URL points at " +
        ref +
        ". These must match."
    );
  }

  // Deployment-target guards. VERCEL_ENV is set by Vercel; when it is absent
  // (local build) the ref is not asserted, but every check above still applies.
  const target = env.VERCEL_ENV || "";
  if (target === "production" && ref !== PRODUCTION_REF) {
    throw new Error(
      "Production build resolved Supabase ref " +
        ref +
        ", which is not the production project (" +
        PRODUCTION_REF +
        "). Aborting rather than shipping production against another database."
    );
  }
  if (target === "preview" && ref === PRODUCTION_REF) {
    throw new Error(
      "Preview build resolved the production Supabase ref (" +
        PRODUCTION_REF +
        "). Set Preview-scoped NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY to the staging project before deploying a Preview."
    );
  }

  return { url, anonKey: key, ref, keyKind: classified.kind, target: target || "local" };
}

export function renderEnvConfig(config) {
  // Only these two values are browser-safe and only these two are emitted.
  const payload = { SUPABASE_URL: config.url, SUPABASE_ANON_KEY: config.anonKey };
  return (
    "/* Auto-generated by build/env-config.js — do not edit and do not commit. */\n" +
    "window.SAYCRD_ENV_CONFIG = " +
    JSON.stringify(payload) +
    ";\n"
  );
}

export function emitEnvConfig(env, outDir) {
  const config = resolveBrowserConfig(env);
  const outPath = path.join(outDir, "env-config.js");
  fs.writeFileSync(outPath, renderEnvConfig(config));
  return { outPath, config };
}

function isDirectRun() {
  try {
    return process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
  } catch (e) {
    return false;
  }
}

if (isDirectRun()) {
  try {
    const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "public");
    const { config } = emitEnvConfig(process.env, outDir);
    // Ref and key *kind* are safe to log; the key itself never is.
    console.log(
      "[build] Wrote public/env-config.js — target=" +
        config.target +
        " ref=" +
        config.ref +
        " key=" +
        config.keyKind
    );
  } catch (err) {
    console.error("[build] " + err.message);
    process.exit(1);
  }
}
