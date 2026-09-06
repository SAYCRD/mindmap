// TEMPORARY, DISPOSABLE. Same isolation guard pattern as
// .tmp-live-test-server.mjs. Deletes one disposable staging user by id via
// the Auth Admin API.
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

const id = process.argv[2];
if (!id) { console.error("usage: node .tmp-delete-staging-user.mjs <user-id>"); process.exit(1); }

const { error } = await sb.auth.admin.deleteUser(id);
if (error) { console.error("delete failed:", error.message); process.exit(1); }
console.log("deleted:", id);
