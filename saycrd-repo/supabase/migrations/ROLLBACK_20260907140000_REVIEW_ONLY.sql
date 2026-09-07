-- ============================================================================
-- REVIEW ARTIFACT ONLY. NOT A MIGRATION. DO NOT APPLY / EXECUTE.
--
-- This file is intentionally NOT numbered like a migration file so no tooling
-- (supabase CLI, MCP apply_migration, etc.) picks it up as part of the ordered
-- migration sequence. It exists purely so the rollback path for
-- 20260907140000_square_refund_support.sql can be reviewed alongside that
-- forward migration.
--
-- ---------------------------------------------------------------------------
-- READ THIS BEFORE RUNNING ANY OF IT
-- ---------------------------------------------------------------------------
-- Rolling Stage 2B back removes the ONLY mechanism that reconciles a Square
-- refund against the credit ledger. After this runs, a completed refund
-- leaves the buyer holding every credit they were refunded for, silently.
--
-- It is also destructive in a way Stage 2A's rollback is not: narrowing the
-- two CHECK constraints back down is IMPOSSIBLE while any row uses the new
-- vocabulary, and dropping square_refunds discards the audit trail for money
-- that has already been returned to buyers.
--
-- Check for data that would be destroyed or that would block the rollback:
--
--   -- rows that make the CHECK narrowing fail outright
--   select count(*) from public.credit_ledger   where reason = 'refund';
--   select count(*) from public.square_payments where status = 'refunded';
--
--   -- open reconciliation items: ambiguous attribution, partial refunds,
--   -- refunds of uncredited payments. Each one is an unanswered money question.
--   select count(*) from public.square_refunds
--    where requires_review and resolved_at is null;
--
--   -- the full refund history about to be dropped
--   select count(*) from public.square_refunds;
--
-- If any of those are non-zero, EXPORT square_refunds and every
-- credit_ledger row with reason = 'refund' before continuing. Once the table
-- is dropped there is no record that a refund was ever processed, and once the
-- refund ledger rows are deleted every affected buyer's balance silently
-- increases by the amount that was clawed back.
--
-- Order matters: drop the function before the table it writes to, and reverse
-- the credit removals before narrowing the constraint that permits them.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. The RPC. Drop first so nothing can write refund rows mid-rollback.
-- ---------------------------------------------------------------------------
drop function if exists public.process_square_refund(text, text, text, integer, text, text, text, jsonb);

-- ---------------------------------------------------------------------------
-- 2. Reverse the claw-backs, if the intent is to restore pre-Stage-2B
--    balances.
--
-- DELIBERATELY COMMENTED OUT. Deleting these rows GIVES CREDITS BACK to users
-- whose money was already returned to them — it does not "clean up", it hands
-- out free sessions. Uncomment only with an explicit decision to do that, and
-- only after exporting the rows.
--
--   delete from public.credit_ledger where reason = 'refund';
--
-- Equally deliberate: there is no statement here to walk square_payments back
-- from 'refunded' to 'paid'. Those payments WERE refunded; rewriting that is
-- falsifying the record. Step 4 keeps the status legal instead.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 3. The refund audit table and its indexes.
--
-- Indexes go with the table; listed for completeness, not run separately.
--   idx_square_refunds_open_review
--   idx_square_refunds_order
-- ---------------------------------------------------------------------------
drop table if exists public.square_refunds;

-- ---------------------------------------------------------------------------
-- 4. The idempotency backstop and the two widened CHECKs.
--
-- Both ALTERs below FAIL if any row still uses the Stage 2B vocabulary. That
-- failure is a feature: it stops a rollback that would otherwise have to
-- either delete real money records or leave the table in violation of its own
-- constraint. Resolve the data question first (step 2), then re-run.
--
-- 'refunded' is kept in the square_payments status list on purpose. Stage 2A's
-- process_square_payment already branches on it, and any payment legitimately
-- refunded while Stage 2B was live must remain representable.
-- ---------------------------------------------------------------------------
drop index if exists public.uq_credit_ledger_refund_square_order;

alter table public.credit_ledger drop constraint if exists credit_ledger_reason_check;
alter table public.credit_ledger add constraint credit_ledger_reason_check
  check (reason in ('purchase', 'admin_grant', 'session_start', 'session_complete'));

-- Verification after running the above:
--
--   select conname, pg_get_constraintdef(oid) from pg_constraint
--    where conrelid = 'public.credit_ledger'::regclass and contype = 'c';
--   select to_regclass('public.square_refunds');            -- expect null
--   select count(*) from pg_proc where proname = 'process_square_refund';  -- expect 0
