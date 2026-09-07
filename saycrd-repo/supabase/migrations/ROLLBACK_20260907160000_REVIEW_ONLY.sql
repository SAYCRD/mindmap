-- ---------------------------------------------------------------------------
-- REVIEW ONLY. Rollback for 20260907160000_square_refund_cumulative.sql.
--
-- Not run automatically and not registered as a migration. Read it, then run
-- it by hand against a named database with -v ON_ERROR_STOP=1
-- --single-transaction.
--
-- WHAT THIS RESTORES
--
-- Stage 2B's single-event refund function: "full refund" reverts to meaning
-- one refund whose amount equals the purchase price.
--
-- READ THIS BEFORE RUNNING IT
--
-- Rolling back re-opens the defect Stage 2C closed. After this runs,
-- instalment refunds stop being recognised: a purchase refunded as 1200 +
-- 1200 against a 2400 charge goes back to leaving the credits in place and
-- leaving square_payments.status at 'paid', which also re-opens the Stage 2A
-- replay hole (a replayed payment.updated can re-credit a purchase whose
-- money has been fully returned).
--
-- So the rollback is only safe if no order has been refunded in instalments.
-- The guard below refuses to proceed when any exists, because reverting the
-- function would strand those orders in a state the older code cannot reason
-- about. Resolve them first — or keep Stage 2C.
--
-- Credits already removed are NOT restored. A claw-back that Stage 2C
-- performed correctly is a real, correct ledger entry; reversing it would
-- hand credits back to a customer who has had their money returned. If a
-- specific claw-back was wrong, correct that order deliberately rather than
-- through a schema rollback.
--
-- The two reconciliation columns are dropped LAST, and only after the
-- function no longer references them.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Guard 1: refuse if any order was refunded in more than one completed
-- instalment. Stage 2B's function cannot represent those.
-- ---------------------------------------------------------------------------
do $$
declare
  v_orders text;
  v_count integer;
begin
  select count(*), string_agg(square_order_id, ', ')
  into v_count, v_orders
  from (
    select square_order_id
    from public.square_refunds
    where refund_status = 'COMPLETED'
    group by square_order_id
    having count(*) > 1
  ) s;

  if coalesce(v_count, 0) > 0 then
    raise exception
      'Refusing to roll back Stage 2C: % order(s) have multiple completed refunds (%). Stage 2B''s function treats each refund in isolation and would mis-handle these. Resolve them before rolling back.',
      v_count, v_orders;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Guard 2: refuse if any order's cumulative completed refunds reached the
-- purchase price WITHOUT a single refund doing so on its own. Those are
-- exactly the orders whose full-refund decision Stage 2B could not have made.
-- ---------------------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  select count(*)
  into v_count
  from (
    select r.square_order_id
    from public.square_refunds r
    join public.square_payments p on p.square_order_id = r.square_order_id
    where r.refund_status = 'COMPLETED'
    group by r.square_order_id, p.amount_cents
    having sum(r.amount_cents) >= p.amount_cents
       and max(r.amount_cents) < p.amount_cents
  ) s;

  if coalesce(v_count, 0) > 0 then
    raise exception
      'Refusing to roll back Stage 2C: % order(s) were fully refunded only in aggregate. Reverting would make the system stop recognising them as refunded.',
      v_count;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Restore Stage 2B's function body by re-running its migration.
--
-- Deliberately NOT inlined here: a second copy of a 300-line function would
-- drift from the original. Run this, then re-apply Stage 2B:
--
--   psql "$URL" -v ON_ERROR_STOP=1 --single-transaction \
--     -f supabase/migrations/20260907140000_square_refund_support.sql
--
-- That migration is CREATE OR REPLACE throughout, so re-running it restores
-- the single-event function and leaves the Stage 2B table and indexes intact.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Drop the Stage 2C-only objects.
--
-- Order matters: the index and columns are dropped only after the function
-- above has been restored to a version that does not reference them.
-- ---------------------------------------------------------------------------
drop index if exists public.ix_square_refunds_open_reconciliation;

alter table public.square_refunds drop column if exists cumulative_refunded_cents;
alter table public.square_refunds drop column if exists purchase_amount_cents;

-- Restore Stage 2B's narrower reading of the column comment.
comment on column public.square_refunds.is_full_refund is
  'Stage 2B: true when this refund''s amount equalled the purchase price.';

-- ---------------------------------------------------------------------------
-- Verification. Expect: 1 function, 0 Stage 2C columns, 0 reconciliation
-- index, and the Stage 2B table/index still present.
-- ---------------------------------------------------------------------------
select 'process_square_refund' as object, count(*)::text as value
from pg_proc where proname = 'process_square_refund'
union all
select 'stage2c columns remaining', count(*)::text
from information_schema.columns
where table_schema = 'public' and table_name = 'square_refunds'
  and column_name in ('cumulative_refunded_cents', 'purchase_amount_cents')
union all
select 'reconciliation index', count(*)::text
from pg_indexes where indexname = 'ix_square_refunds_open_reconciliation'
union all
select 'square_refunds table (kept)', coalesce(to_regclass('public.square_refunds')::text, 'ABSENT')
union all
select 'ledger refund uniq index (kept)', count(*)::text
from pg_indexes where indexname = 'uq_credit_ledger_refund_square_order';
