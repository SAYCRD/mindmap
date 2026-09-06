-- ============================================================================
-- REVIEW ARTIFACT ONLY. NOT A MIGRATION. DO NOT APPLY / EXECUTE.
--
-- This file is intentionally NOT numbered like a migration file so no
-- tooling (supabase CLI, MCP apply_migration, etc.) picks it up as part of
-- the ordered migration sequence. It exists purely so the rollback path for
-- 20260906090000_widen_credit_ledger_reason_check.sql can be reviewed
-- alongside that forward migration.
--
-- Restores the exact constraint definition confirmed live on staging
-- (lbydmtgeojnozzhwsava) immediately before the forward migration was
-- applied:
--
--   CHECK ((reason = ANY (ARRAY['purchase'::text, 'session_start'::text, 'admin_grant'::text])))
--
-- Safe to run only if no row with reason='session_complete' has been
-- written since the forward migration was applied -- otherwise this
-- constraint will fail to attach (existing violating rows) or, if run
-- with NOT VALID / validated later, will simply forbid writing that
-- reason going forward while leaving already-written 'session_complete'
-- rows in place. Check first:
--
--   select count(*) from public.credit_ledger where reason = 'session_complete';
--
-- If that count is nonzero, rolling back also re-breaks the Stage 4 paid-
-- credit completion path this migration was written to fix -- confirm
-- that is actually intended before running this.
-- ============================================================================

alter table public.credit_ledger
  drop constraint if exists credit_ledger_reason_check;

alter table public.credit_ledger
  add constraint credit_ledger_reason_check
  check (reason = any (array['purchase'::text, 'session_start'::text, 'admin_grant'::text]));

comment on constraint credit_ledger_reason_check on public.credit_ledger is null;
