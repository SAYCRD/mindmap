-- ============================================================================
-- REVIEW ARTIFACT ONLY. NOT A MIGRATION. DO NOT APPLY / EXECUTE.
--
-- This file is intentionally NOT numbered like a migration file so no
-- tooling (supabase CLI, MCP apply_migration, etc.) picks it up as part of
-- the ordered migration sequence. It exists purely so the rollback path for
-- 20260907120000_square_payment_atomicity.sql can be reviewed alongside
-- that forward migration.
--
-- ---------------------------------------------------------------------------
-- READ THIS BEFORE RUNNING ANY OF IT
-- ---------------------------------------------------------------------------
-- Rolling this migration back restores the ORIGINAL DEFECT: crediting a
-- Square payment goes back to two non-atomic writes from application code,
-- where a failure in between leaves money collected with no entitlement and
-- no possibility of automatic recovery. It also removes the only
-- double-credit backstop. Do not run it to "clean up"; run it only to
-- deliberately return to the pre-Stage-2A behaviour.
--
-- Order matters: drop the functions before the tables they write to.
--
-- Check for data that would be destroyed first:
--
--   select count(*) from public.square_webhook_dead_letter where resolved_at is null;
--   select count(*) from public.square_orphaned_links      where resolved_at is null;
--
-- Any unresolved row in either table is an OPEN MONEY ITEM — an uncreditable
-- payment, or a payable Square link with no pending row behind it. Dropping
-- these tables discards the only record that it exists. Export both first.
--
--   select count(*) from public.credit_ledger where reason = 'purchase';
--   select count(*) from public.square_payments where session_count is null;
--
-- Dropping session_count/currency/square_location_id discards the purchase
-- terms for every completed purchase, so those payments can no longer be
-- reconciled against what the buyer was actually charged and granted.
-- ============================================================================

-- 1. Functions first (they reference the tables and columns below).
drop function if exists public.process_square_payment(text, text, integer, text, text, jsonb);
drop function if exists public.record_square_webhook_dead_letter(text, text, integer, text, text, text, integer, text, text, jsonb);
drop function if exists public.record_square_orphaned_link(text, text, text, text, uuid, uuid, integer, text, text, integer);

-- 2. The double-credit backstop.
--    After this, nothing in the database prevents a replayed or concurrent
--    webhook delivery from crediting the same Square order twice.
drop index if exists public.uq_credit_ledger_purchase_square_order;

-- 3. Investigation/reconciliation tables. EXPORT BEFORE DROPPING (see above).
drop table if exists public.square_webhook_dead_letter;
drop table if exists public.square_orphaned_links;

-- 4. The terms snapshot.
--    After this the webhook has nothing to validate a completed payment
--    against, which is why the pre-Stage-2A code re-read session_tiers and
--    could be changed underneath a purchase by an admin edit.
alter table public.square_payments drop column if exists session_count;
alter table public.square_payments drop column if exists currency;
alter table public.square_payments drop column if exists square_location_id;
