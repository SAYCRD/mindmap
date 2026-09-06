// TEMPORARY, DISPOSABLE. Same isolation guard pattern as
// .tmp-live-test-server.mjs. Creates one confirmed disposable staging user
// via the Auth Admin API (never inserts into auth.users directly), and
// prints back the exact email+password used so the caller has ground truth
// (never re-derive credentials from separate shell substitutions).
const PROD_REF = "lydamoxkymwuccepeeyz";
const STAGING_REF = "lbydmtgeojnozzhwsava";
const STAGING_URL = `https://${STAGING_REF}.supabase.co`;

if (!process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY) {
  console.error("[isolation-guard] STAGING_SUPABASE_SERVICE_ROLE_KEY is not set. Aborting.");
  process.exit(1);
}
if (STAGING_URL.includes(PROD_REF)) { console.error("[isolation-guard] ABORT"); process.exit(1); }

const { createClient } = await import("@supabase/supabase-js");
const sb = createClient(STAGING_URL, process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
if (!sb.supabaseUrl.includes(STAGING_REF) || sb.supabaseUrl.includes(PROD_REF)) {
  console.error("[isolation-guard] ABORT: client not pinned to staging"); process.exit(1);
}

const suffix = process.argv[2] || String(Date.now());
const email = `stage3-live-test-${suffix}@example.com`;
const password = `Test-Pw-${suffix}-Xz9!`;

const { data, error } = await sb.auth.admin.createUser({ email, password, email_confirm: true });
if (error) { console.error("create failed:", error.message); process.exit(1); }
console.log(JSON.stringify({ id: data.user.id, email, password }));
