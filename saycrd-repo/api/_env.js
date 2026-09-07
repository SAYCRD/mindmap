// api/_env.js — the single source of truth for which Supabase project this
// deployment talks to.
//
// Both consumers resolve through here:
//   - build/env-config.js  (build time) -> the browser's config file
//   - api/_lib.js          (runtime)    -> the service-role client
// Because both derive the project from the same variables in the same order,
// the browser and the API cannot end up pointed at different projects. The
// split-brain failure mode is designed out rather than merely guarded against.
//
// Why the variable sets differ per target: the production Supabase variables
// are owned by the Vercel Supabase integration, which offers no per-environment
// Edit action, so they cannot be split into Production-only and Preview-only
// values. Instead the *code* chooses the variable set, and Preview and local
// development read explicit STAGING_* variables that we own.
//
// Every failure throws. Nothing here ever falls back to another environment's
// project, and no error message ever contains key material.

export const PRODUCTION_REF = "lydamoxkymwuccepeeyz";
export const STAGING_REF = "lbydmtgeojnozzhwsava";

// A Supabase project ref is 20 lowercase letters. Staging is a Supabase *branch*
// of the production project, so it has its own ref of the same shape.
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

// Decides whether a key may be handed to a browser. Anything not positively
// identified as browser-safe is refused, so an unrecognised future key format
// fails closed instead of being shipped to users.
export function classifyKey(key) {
  const value = String(key || "");
  if (value.startsWith("sb_secret_")) {
    return { browserSafe: false, kind: "secret", ref: null, reason: "modern secret key" };
  }
  if (value.startsWith("sb_publishable_")) {
    return { browserSafe: true, kind: "publishable", ref: null };
  }
  if (value.startsWith("eyJ")) {
    const payload = decodeJwtPayload(value);
    if (!payload) {
      return { browserSafe: false, kind: "malformed-jwt", ref: null, reason: "unreadable JWT payload" };
    }
    if (payload.role !== "anon") {
      return {
        browserSafe: false,
        kind: "privileged-jwt",
        ref: payload.ref || null,
        reason: 'JWT role is "' + payload.role + '", not "anon"',
      };
    }
    return { browserSafe: true, kind: "legacy-anon-jwt", ref: payload.ref || null };
  }
  return { browserSafe: false, kind: "unrecognised", ref: null, reason: "unrecognised key format" };
}

// Each source names the variables to read and the one project ref it is allowed
// to resolve to. Anything else aborts, so a mistyped URL or a third Supabase
// project can never be reached by accident.
const STAGING_SOURCE = {
  label: "staging",
  expectedRef: STAGING_REF,
  url: ["STAGING_SUPABASE_URL"],
  browserKey: ["STAGING_SUPABASE_ANON_KEY"],
  serviceKey: ["STAGING_SUPABASE_SERVICE_ROLE_KEY"],
};

const PRODUCTION_SOURCE = {
  label: "production",
  expectedRef: PRODUCTION_REF,
  // Integration-managed. Never modified by us.
  url: ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"],
  browserKey: ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY"],
  serviceKey: ["SUPABASE_SERVICE_ROLE_KEY"],
};

// Production is the only target that reads the production project. Preview and
// local development both read staging, so local work cannot touch production.
const SOURCE_BY_TARGET = {
  production: PRODUCTION_SOURCE,
  preview: STAGING_SOURCE,
  development: STAGING_SOURCE,
};

export function resolveTarget(env) {
  const raw = String(env.VERCEL_ENV || "").trim().toLowerCase();
  // No VERCEL_ENV means a local build, the dev-server shim, or the test runner.
  if (!raw) return "development";
  if (raw === "production" || raw === "preview" || raw === "development") return raw;
  throw new Error(
    'Unrecognised VERCEL_ENV "' + raw + '" — refusing to guess which Supabase project to use.'
  );
}

function firstSet(env, names) {
  for (const name of names) {
    const value = String(env[name] || "").trim();
    if (value) return { name, value };
  }
  return null;
}

// Resolves the project for this deployment. Never returns key material.
export function resolveSupabaseEnv(env) {
  const target = resolveTarget(env);
  const source = SOURCE_BY_TARGET[target];

  const urlHit = firstSet(env, source.url);
  if (!urlHit) {
    throw new Error(
      "No Supabase URL for target " +
        target +
        " — set " +
        source.url.join(" or ") +
        " to the " +
        source.label +
        " project. Refusing to fall back to another environment."
    );
  }

  const ref = extractProjectRef(urlHit.value);
  if (!ref) {
    throw new Error(
      urlHit.name +
        " is not a recognisable Supabase project URL (expected https://<20-char-ref>.supabase.co)."
    );
  }

  if (ref !== source.expectedRef) {
    const found =
      ref === PRODUCTION_REF
        ? "the PRODUCTION project (" + PRODUCTION_REF + ")"
        : ref === STAGING_REF
          ? "the STAGING branch (" + STAGING_REF + ")"
          : "project " + ref;
    throw new Error(
      "Target " +
        target +
        " must use the " +
        source.label +
        " project (" +
        source.expectedRef +
        ") but " +
        urlHit.name +
        " resolved " +
        found +
        ". Aborting rather than using the wrong database."
    );
  }

  return {
    target,
    source: source.label,
    sourceKeys: source,
    url: urlHit.value,
    urlVar: urlHit.name,
    ref,
  };
}

// Build time. Only ever touches the browser-safe key; the service key is not
// read on this path at all.
export function resolveBrowserConfig(env) {
  const base = resolveSupabaseEnv(env);
  const hit = firstSet(env, base.sourceKeys.browserKey);
  if (!hit) {
    throw new Error(
      "No browser key for target " +
        base.target +
        " — set " +
        base.sourceKeys.browserKey.join(" or ") +
        " to the " +
        base.source +
        " project's anon key."
    );
  }

  const classified = classifyKey(hit.value);
  if (!classified.browserSafe) {
    throw new Error(
      "Refusing to put a non-browser-safe key in env-config.js (" +
        hit.name +
        ": " +
        classified.reason +
        "). Use the project's anon or publishable key, never a service-role or secret key."
    );
  }

  // A legacy anon JWT names the project it belongs to, so we can prove the key
  // and the URL describe the same project. Publishable keys are opaque and
  // carry no ref, so this cross-check does not apply to them.
  if (classified.ref && classified.ref !== base.ref) {
    throw new Error(
      hit.name +
        " belongs to project " +
        classified.ref +
        " but " +
        base.urlVar +
        " points at " +
        base.ref +
        ". These must match."
    );
  }

  return {
    url: base.url,
    anonKey: hit.value,
    ref: base.ref,
    keyKind: classified.kind,
    target: base.target,
    source: base.source,
    keyVar: hit.name,
  };
}

// Runtime. Asserts the key is NOT browser-safe: an anon key in the service slot
// would leave every service query silently subject to RLS, which surfaces as
// mysteriously missing data rather than as an error.
export function resolveServerConfig(env) {
  const base = resolveSupabaseEnv(env);
  const hit = firstSet(env, base.sourceKeys.serviceKey);
  if (!hit) {
    throw new Error(
      "No Supabase service key for target " +
        base.target +
        " — set " +
        base.sourceKeys.serviceKey.join(" or ") +
        " to the " +
        base.source +
        " project's service key."
    );
  }

  const classified = classifyKey(hit.value);
  if (classified.browserSafe) {
    throw new Error(
      hit.name +
        " holds a browser-safe " +
        classified.kind +
        " key, not a service key. Refusing to build a service client that would be subject to RLS."
    );
  }

  if (classified.ref && classified.ref !== base.ref) {
    throw new Error(
      hit.name +
        " belongs to project " +
        classified.ref +
        " but " +
        base.urlVar +
        " points at " +
        base.ref +
        ". These must match."
    );
  }

  return {
    url: base.url,
    serviceRoleKey: hit.value,
    ref: base.ref,
    keyKind: classified.kind,
    target: base.target,
    source: base.source,
    keyVar: hit.name,
  };
}
