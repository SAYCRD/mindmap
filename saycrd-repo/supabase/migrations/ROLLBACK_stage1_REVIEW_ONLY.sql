-- ============================================================================
-- REVIEW ARTIFACT ONLY. NOT A MIGRATION. DO NOT APPLY / EXECUTE.
--
-- This file is intentionally NOT numbered like a migration file so no
-- tooling (supabase CLI, MCP apply_migration, etc.) picks it up as part of
-- the ordered migration sequence. It exists purely so the rollback path for
-- Stage 1 can be reviewed alongside the forward migrations, per the
-- approved requirement to "include complete rollback SQL as a separate
-- review artifact, but do not execute it."
--
-- Safe to run only if: (a) none of the six Stage 1 tables have received
-- any real production data yet, and (b) nothing else in the database
-- (future migrations, API routes) has come to depend on them. Reverse
-- dependency order relative to the forward migrations.
-- ============================================================================

-- Reverse of 20260905070500_create_migration_runs_table.sql
drop policy if exists "migration_runs_select_own" on public.migration_runs;
drop table if exists public.migration_runs;

-- Reverse of 20260905070400_create_session_entitlement_usage_table.sql
drop policy if exists "entitlement_usage_select_own" on public.session_entitlement_usage;
drop table if exists public.session_entitlement_usage;

-- Reverse of 20260905070300_create_bookmarks_table.sql
drop policy if exists "bookmarks_select_own" on public.bookmarks;
drop table if exists public.bookmarks;

-- Reverse of 20260905070200_create_captures_table.sql
drop policy if exists "captures_select_own" on public.captures;
drop table if exists public.captures;

-- Reverse of 20260905070100_create_reports_table.sql
drop trigger if exists reports_set_updated_at on public.reports;
drop policy if exists "reports_select_own" on public.reports;
drop table if exists public.reports;

-- Reverse of 20260905070000_create_sessions_table.sql
drop trigger if exists sessions_set_updated_at on public.sessions;
drop policy if exists "sessions_select_own" on public.sessions;
drop table if exists public.sessions;

-- public.tg_set_updated_at() is shared infrastructure introduced by the
-- sessions migration and reused by reports. Only drop it once BOTH tables
-- that depend on it are gone (both are dropped above, so this is safe in
-- this full-rollback ordering). Do NOT drop this function if any other
-- future migration has also started depending on it -- check for other
-- `execute function public.tg_set_updated_at()` triggers before running
-- this line in isolation.
drop function if exists public.tg_set_updated_at();

-- Note: no ALTER on auth.users, credit_ledger, subscriptions, or
-- session_tiers is ever required to roll this batch back -- every FK in
-- Stage 1 points FROM the new tables TO those existing tables, never the
-- reverse, so dropping the six new tables above is sufficient and leaves
-- all pre-existing tables completely untouched.
