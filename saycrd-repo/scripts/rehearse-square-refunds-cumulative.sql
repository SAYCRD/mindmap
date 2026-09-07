-- scripts/rehearse-square-refunds-cumulative.sql — Stage 2C rehearsal.
--
-- RUN ONLY ON A DISPOSABLE SUPABASE BRANCH WITH NO REAL DATA.
-- It creates users, purchases, sessions and refunds. Never point it at
-- production.
--
-- This is where the cumulative refund policy is actually proven. The mocked
-- route tests have no tables, transactions, row locks or unique indexes, so
-- they cannot show that two 1300+2000 refunds against a 3300 purchase sum to
-- a full refund, that a redelivered instalment is counted once, or that the
-- claw-back happens exactly once when deliveries race. Only real Postgres
-- can show that.
--
-- Sessions are consumed through the REAL
-- complete_session_and_consume_entitlement RPC rather than by inserting
-- debit rows by hand, so attribution runs against ledger rows shaped exactly
-- as production writes them.
--
-- Fixture purchase is 3300 cents / 5 credits throughout, split as
-- 1300+2000, 1100+1100+1100, and 1500+1800 so no case can pass by
-- coincidence of equal halves.
--
-- Each check prints `t` in the pass column. Any `f` is a failure.
--
-- Usage:
--   psql "$BRANCH_URL" -v ON_ERROR_STOP=1 -f scripts/rehearse-square-refunds-cumulative.sql

\set ON_ERROR_STOP on
\timing off
\pset pager off

-- ===========================================================================
-- Fixtures
-- ===========================================================================
begin;

insert into auth.users (id, instance_id, aud, role, email)
select
  ('c0000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000',
  'authenticated', 'authenticated',
  'c2c-' || n || '@rehearsal.test'
from generate_series(1, 14) n
on conflict (id) do nothing;

insert into public.session_tiers (id, name, session_count, price_cents, currency, active, sort_order)
values ('b0000000-0000-0000-0000-0000000000fe', 'Stage2C 5-pack', 5, 3300, 'USD', true, 98)
on conflict (id) do nothing;

-- Exhaust the complimentary sessions so completing a session consumes a
-- CREDIT rather than a free allowance.
insert into public.free_sessions_used (user_id, count)
select id, 2 from auth.users where email like 'c2c-%@rehearsal.test'
on conflict (user_id) do update set count = 2;

commit;

create or replace function public.rehearse2c_seed_purchase(
  p_user uuid, p_order text, p_payment text, p_cents integer, p_credits integer
) returns void language plpgsql as $$
begin
  insert into public.square_payments
    (user_id, tier_id, square_order_id, square_payment_id, amount_cents, status,
     currency, session_count, square_location_id)
  values
    (p_user, 'b0000000-0000-0000-0000-0000000000fe', p_order, p_payment, p_cents, 'paid',
     'USD', p_credits, 'LG8FD2SPNNAVX');

  insert into public.credit_ledger (user_id, delta, reason, tier_id, square_order_id)
  values (p_user, p_credits, 'purchase', 'b0000000-0000-0000-0000-0000000000fe', p_order);
end;
$$;

create or replace function public.rehearse2c_consume(p_user uuid, p_n integer)
returns void language plpgsql as $$
declare
  v_session uuid;
  i integer;
  v_out jsonb;
begin
  for i in 1..p_n loop
    insert into public.sessions (user_id, status) values (p_user, 'draft') returning id into v_session;
    v_out := public.complete_session_and_consume_entitlement(
      v_session, p_user, '{"rehearsal":true}'::jsonb, '{"rehearsal":true}'::jsonb, null
    );
    if not (v_out->>'ok')::boolean then
      raise exception 'rehearsal consume failed: %', v_out;
    end if;
    if v_out->>'source' is distinct from 'credit' then
      raise exception 'rehearsal expected a credit consumption, got %', v_out;
    end if;
  end loop;
end;
$$;

create or replace function public.rehearse2c_balance(p_user uuid)
returns integer language sql as $$
  select coalesce(sum(delta), 0)::integer from public.credit_ledger where user_id = p_user;
$$;

create or replace function public.rehearse2c_refund_ledger_rows(p_order text)
returns integer language sql as $$
  select count(*)::integer from public.credit_ledger
  where square_order_id = p_order and reason = 'refund';
$$;

\echo ''
\echo '=========================================================='
\echo 'SCENARIO 1 — ONE PARTIAL REFUND'
\echo 'A single 1300 of 3300. Must not remove the pack.'
\echo '=========================================================='

select public.rehearse2c_seed_purchase(
  'c0000000-0000-0000-0000-000000000001', 'ORD-1P', 'PAY-1P', 3300, 5);

select 's1_partial_recorded_no_credit_change' as test,
       public.process_square_refund('RF-1P-A', 'PAY-1P', 'COMPLETED', 1300, 'USD', 'ORD-1P', 'LG8FD2SPNNAVX')
         @> '{"ok":true,"result":"recorded_partial","credits_removed":0,"requires_review":true,"is_full_refund":false,"cumulative_refunded_cents":1300,"purchase_amount_cents":3300,"remaining_cents":2000}'::jsonb as pass;

-- The whole point: a partial must leave the entire pack intact.
select 's1_full_pack_still_intact' as test,
       public.rehearse2c_balance('c0000000-0000-0000-0000-000000000001') = 5 as pass;

select 's1_no_refund_ledger_row' as test,
       public.rehearse2c_refund_ledger_rows('ORD-1P') = 0 as pass;

-- Must stay 'paid': marking it refunded would tell Stage 2A the purchase was
-- reversed while the customer still has 2000 cents outstanding.
select 's1_payment_still_paid' as test,
       (select status from public.square_payments where square_order_id = 'ORD-1P') = 'paid' as pass;

-- Preserved for reconciliation, with the snapshots that explain the decision.
select 's1_event_preserved_with_snapshots' as test,
       (select cumulative_refunded_cents = 1300
               and purchase_amount_cents = 3300
               and is_full_refund = false
               and requires_review
               and result_code = 'recorded_partial'
               and attempt_count = 1
          from public.square_refunds where square_refund_id = 'RF-1P-A') as pass;

select 's1_evidence_records_remaining' as test,
       (select attribution_evidence @> '{"remaining_cents":2000,"prior_completed_cents":0,"over_refund":false}'::jsonb
          from public.square_refunds where square_refund_id = 'RF-1P-A') as pass;

\echo ''
\echo '=========================================================='
\echo 'SCENARIO 2 — MULTIPLE PARTIALS TOTALLING THE FULL AMOUNT'
\echo '1300 then 2000 on an unused 3300 pack.'
\echo '=========================================================='

select public.rehearse2c_seed_purchase(
  'c0000000-0000-0000-0000-000000000002', 'ORD-2P', 'PAY-2P', 3300, 5);

select 's2_first_instalment_partial' as test,
       public.process_square_refund('RF-2P-A', 'PAY-2P', 'COMPLETED', 1300, 'USD', 'ORD-2P', 'LG8FD2SPNNAVX')
         @> '{"ok":true,"result":"recorded_partial","credits_removed":0,"cumulative_refunded_cents":1300}'::jsonb as pass;

select 's2_balance_untouched_after_first' as test,
       public.rehearse2c_balance('c0000000-0000-0000-0000-000000000002') = 5 as pass;

-- The crossing event. Stage 2B returned recorded_partial here, because 2000
-- alone is less than 3300 — this assertion is the regression this stage fixes.
select 's2_second_instalment_completes_full_refund' as test,
       public.process_square_refund('RF-2P-B', 'PAY-2P', 'COMPLETED', 2000, 'USD', 'ORD-2P', 'LG8FD2SPNNAVX')
         @> '{"ok":true,"result":"credits_removed","credits_removed":5,"attribution_basis":"unused","is_full_refund":true,"cumulative_refunded_cents":3300,"remaining_cents":0}'::jsonb as pass;

select 's2_balance_now_zero' as test,
       public.rehearse2c_balance('c0000000-0000-0000-0000-000000000002') = 0 as pass;

select 's2_exactly_one_refund_ledger_row' as test,
       public.rehearse2c_refund_ledger_rows('ORD-2P') = 1 as pass;

-- Closes the Stage 2A replay hole for instalment refunds.
select 's2_payment_marked_refunded' as test,
       (select status from public.square_payments where square_order_id = 'ORD-2P') = 'refunded' as pass;

select 's2_replayed_payment_webhook_cannot_recredit' as test,
       (public.process_square_payment('ORD-2P', 'PAY-2P', 3300, 'USD', 'LG8FD2SPNNAVX', '{}'::jsonb)
         ->> 'result') = 'conflict_status' as pass;

select 's2_both_instalments_preserved' as test,
       (select count(*) from public.square_refunds where square_order_id = 'ORD-2P') = 2 as pass;

select 's2_only_crossing_event_removed_credits' as test,
       (select count(*) from public.square_refunds
         where square_order_id = 'ORD-2P' and credits_removed > 0) = 1 as pass;

\echo ''
\echo '=========================================================='
\echo 'SCENARIO 2b — THREE PARTIALS, WITH SESSIONS ALREADY USED'
\echo '1100 x 3 on a 3300 pack of which 2 were consumed.'
\echo '=========================================================='

select public.rehearse2c_seed_purchase(
  'c0000000-0000-0000-0000-000000000003', 'ORD-3P', 'PAY-3P', 3300, 5);
select public.rehearse2c_consume('c0000000-0000-0000-0000-000000000003', 2);

select 's2b_first_of_three' as test,
       public.process_square_refund('RF-3P-A', 'PAY-3P', 'COMPLETED', 1100, 'USD', 'ORD-3P', 'LG8FD2SPNNAVX')
         @> '{"result":"recorded_partial","cumulative_refunded_cents":1100,"remaining_cents":2200}'::jsonb as pass;

select 's2b_second_of_three' as test,
       public.process_square_refund('RF-3P-B', 'PAY-3P', 'COMPLETED', 1100, 'USD', 'ORD-3P', 'LG8FD2SPNNAVX')
         @> '{"result":"recorded_partial","cumulative_refunded_cents":2200,"remaining_cents":1100}'::jsonb as pass;

select 's2b_balance_still_three_before_completion' as test,
       public.rehearse2c_balance('c0000000-0000-0000-0000-000000000003') = 3 as pass;

-- Only the 3 UNUSED credits come back; the 2 already consumed do not.
select 's2b_third_removes_only_unused' as test,
       public.process_square_refund('RF-3P-C', 'PAY-3P', 'COMPLETED', 1100, 'USD', 'ORD-3P', 'LG8FD2SPNNAVX')
         @> '{"result":"credits_removed","credits_removed":3,"attribution_basis":"sole_source","cumulative_refunded_cents":3300}'::jsonb as pass;

select 's2b_balance_zero_not_negative' as test,
       public.rehearse2c_balance('c0000000-0000-0000-0000-000000000003') = 0 as pass;

select 's2b_sessions_not_reversed' as test,
       (select count(*) from public.sessions
         where user_id = 'c0000000-0000-0000-0000-000000000003' and status = 'completed') = 2 as pass;

select 's2b_entitlement_usage_untouched' as test,
       (select count(*) from public.session_entitlement_usage
         where user_id = 'c0000000-0000-0000-0000-000000000003') = 2 as pass;

\echo ''
\echo '=========================================================='
\echo 'SCENARIO 3 — DUPLICATED PARTIAL EVENTS'
\echo 'The same instalment delivered five times must count once.'
\echo '=========================================================='

select public.rehearse2c_seed_purchase(
  'c0000000-0000-0000-0000-000000000004', 'ORD-DUP', 'PAY-DUP', 3300, 5);

select 's3_first_delivery_partial' as test,
       public.process_square_refund('RF-DUP-A', 'PAY-DUP', 'COMPLETED', 1500, 'USD', 'ORD-DUP', 'LG8FD2SPNNAVX')
         @> '{"result":"recorded_partial","cumulative_refunded_cents":1500}'::jsonb as pass;

select 's3_redeliveries_are_already_processed' as test,
       bool_and(
         public.process_square_refund('RF-DUP-A', 'PAY-DUP', 'COMPLETED', 1500, 'USD', 'ORD-DUP', 'LG8FD2SPNNAVX')
           @> '{"ok":true,"result":"already_processed","prior_result":"recorded_partial"}'::jsonb
       ) as pass
from generate_series(1, 4);

-- Five deliveries, one row, one counted contribution.
select 's3_one_row_five_attempts' as test,
       (select count(*) = 1 and max(attempt_count) = 5
          from public.square_refunds where square_refund_id = 'RF-DUP-A') as pass;

select 's3_balance_untouched_by_duplicates' as test,
       public.rehearse2c_balance('c0000000-0000-0000-0000-000000000004') = 5 as pass;

-- If duplicates had been double-counted, 1500 x 5 = 7500 would have tripped
-- the over-refund guard instead of completing cleanly here.
select 's3_completing_instalment_sees_1500_not_7500' as test,
       public.process_square_refund('RF-DUP-B', 'PAY-DUP', 'COMPLETED', 1800, 'USD', 'ORD-DUP', 'LG8FD2SPNNAVX')
         @> '{"result":"credits_removed","credits_removed":5,"cumulative_refunded_cents":3300,"is_full_refund":true}'::jsonb as pass;

select 's3_balance_zero_after_completion' as test,
       public.rehearse2c_balance('c0000000-0000-0000-0000-000000000004') = 0 as pass;

-- Replay EVERY event again, in both orders, after the claw-back. Nothing may
-- move. This is the convergence property.
select 's3_replay_all_events_after_completion_converges' as test,
       bool_and(
         (public.process_square_refund('RF-DUP-A', 'PAY-DUP', 'COMPLETED', 1500, 'USD', 'ORD-DUP', 'LG8FD2SPNNAVX') ->> 'result') = 'already_processed'
         and (public.process_square_refund('RF-DUP-B', 'PAY-DUP', 'COMPLETED', 1800, 'USD', 'ORD-DUP', 'LG8FD2SPNNAVX') ->> 'result') = 'already_processed'
       ) as pass
from generate_series(1, 3);

select 's3_still_one_refund_ledger_row_after_replays' as test,
       public.rehearse2c_refund_ledger_rows('ORD-DUP') = 1 as pass;

select 's3_balance_still_zero_not_negative' as test,
       public.rehearse2c_balance('c0000000-0000-0000-0000-000000000004') = 0 as pass;

\echo ''
\echo '=========================================================='
\echo 'SCENARIO 4 — OVER-REFUND'
\echo '2000 + 2000 against a 3300 purchase.'
\echo '=========================================================='

select public.rehearse2c_seed_purchase(
  'c0000000-0000-0000-0000-000000000005', 'ORD-OVER', 'PAY-OVER', 3300, 5);

select 's4_first_instalment_ok' as test,
       public.process_square_refund('RF-OV-A', 'PAY-OVER', 'COMPLETED', 2000, 'USD', 'ORD-OVER', 'LG8FD2SPNNAVX')
         @> '{"result":"recorded_partial","cumulative_refunded_cents":2000}'::jsonb as pass;

-- Individually plausible (2000 < 3300) but the running total is impossible.
select 's4_second_instalment_flagged_as_over_refund' as test,
       public.process_square_refund('RF-OV-B', 'PAY-OVER', 'COMPLETED', 2000, 'USD', 'ORD-OVER', 'LG8FD2SPNNAVX')
         @> '{"ok":false,"result":"conflict_over_refund","credits_removed":0,"requires_review":true,"cumulative_refunded_cents":4000,"purchase_amount_cents":3300}'::jsonb as pass;

select 's4_no_credits_removed_on_over_refund' as test,
       public.rehearse2c_balance('c0000000-0000-0000-0000-000000000005') = 5 as pass;

select 's4_no_refund_ledger_row' as test,
       public.rehearse2c_refund_ledger_rows('ORD-OVER') = 0 as pass;

select 's4_payment_not_marked_refunded' as test,
       (select status from public.square_payments where square_order_id = 'ORD-OVER') = 'paid' as pass;

-- Rejected for credit purposes, but PRESERVED for reconciliation.
select 's4_over_refund_row_persisted_for_review' as test,
       (select result_code = 'conflict_over_refund'
               and requires_review
               and cumulative_refunded_cents = 4000
               and credits_removed = 0
          from public.square_refunds where square_refund_id = 'RF-OV-B') as pass;

select 's4_redelivery_gives_the_same_answer' as test,
       public.process_square_refund('RF-OV-B', 'PAY-OVER', 'COMPLETED', 2000, 'USD', 'ORD-OVER', 'LG8FD2SPNNAVX')
         @> '{"ok":false,"result":"conflict_over_refund","cumulative_refunded_cents":4000}'::jsonb as pass;

select 's4_redelivery_did_not_double_count_itself' as test,
       (select cumulative_refunded_cents = 4000 and attempt_count = 2
          from public.square_refunds where square_refund_id = 'RF-OV-B') as pass;

\echo ''
\echo '--- 4b: an extra refund arriving AFTER a completed full refund ---'

select public.rehearse2c_seed_purchase(
  'c0000000-0000-0000-0000-000000000006', 'ORD-OVER2', 'PAY-OVER2', 3300, 5);

select 's4b_full_refund_first' as test,
       public.process_square_refund('RF-O2-A', 'PAY-OVER2', 'COMPLETED', 3300, 'USD', 'ORD-OVER2', 'LG8FD2SPNNAVX')
         @> '{"result":"credits_removed","credits_removed":5}'::jsonb as pass;

select 's4b_extra_refund_is_over_refund' as test,
       public.process_square_refund('RF-O2-B', 'PAY-OVER2', 'COMPLETED', 100, 'USD', 'ORD-OVER2', 'LG8FD2SPNNAVX')
         @> '{"ok":false,"result":"conflict_over_refund","cumulative_refunded_cents":3400}'::jsonb as pass;

select 's4b_balance_not_driven_negative' as test,
       public.rehearse2c_balance('c0000000-0000-0000-0000-000000000006') = 0 as pass;

select 's4b_still_one_refund_ledger_row' as test,
       public.rehearse2c_refund_ledger_rows('ORD-OVER2') = 1 as pass;

\echo ''
\echo '--- 4c: a SINGLE refund larger than the purchase is rejected outright ---'

select public.rehearse2c_seed_purchase(
  'c0000000-0000-0000-0000-000000000007', 'ORD-BIG', 'PAY-BIG', 3300, 5);

select 's4c_single_oversized_refund_is_conflict_amount' as test,
       public.process_square_refund('RF-BIG-A', 'PAY-BIG', 'COMPLETED', 5000, 'USD', 'ORD-BIG', 'LG8FD2SPNNAVX')
         @> '{"ok":false,"result":"conflict_amount","purchase_cents":3300,"refund_cents":5000}'::jsonb as pass;

select 's4c_rejected_before_any_write' as test,
       (select count(*) from public.square_refunds where square_refund_id = 'RF-BIG-A') = 0 as pass;

select 's4c_balance_untouched' as test,
       public.rehearse2c_balance('c0000000-0000-0000-0000-000000000007') = 5 as pass;

\echo ''
\echo '=========================================================='
\echo 'SCENARIO 5 — PENDING then COMPLETED, and status monotonicity'
\echo '=========================================================='

select public.rehearse2c_seed_purchase(
  'c0000000-0000-0000-0000-000000000008', 'ORD-TRANS', 'PAY-TRANS', 3300, 5);

select 's5_pending_contributes_nothing' as test,
       public.process_square_refund('RF-TR-A', 'PAY-TRANS', 'PENDING', 3300, 'USD', 'ORD-TRANS', 'LG8FD2SPNNAVX')
         @> '{"ok":true,"result":"recorded_not_completed","credits_removed":0,"cumulative_refunded_cents":0}'::jsonb as pass;

select 's5_balance_untouched_while_pending' as test,
       public.rehearse2c_balance('c0000000-0000-0000-0000-000000000008') = 5 as pass;

select 's5_completed_transition_processed_once' as test,
       public.process_square_refund('RF-TR-A', 'PAY-TRANS', 'COMPLETED', 3300, 'USD', 'ORD-TRANS', 'LG8FD2SPNNAVX')
         @> '{"result":"credits_removed","credits_removed":5,"cumulative_refunded_cents":3300}'::jsonb as pass;

-- A stale PENDING redelivery must NOT regress the stored status: the
-- cumulative sum reads that column, so a regression could silently un-do a
-- completed full refund for any later refund on the same order.
select 's5_stale_pending_redelivery_is_absorbed' as test,
       (public.process_square_refund('RF-TR-A', 'PAY-TRANS', 'PENDING', 3300, 'USD', 'ORD-TRANS', 'LG8FD2SPNNAVX')
         ->> 'result') = 'already_processed' as pass;

select 's5_stored_status_did_not_regress' as test,
       (select refund_status = 'COMPLETED'
          from public.square_refunds where square_refund_id = 'RF-TR-A') as pass;

select 's5_one_ledger_row_and_zero_balance' as test,
       public.rehearse2c_refund_ledger_rows('ORD-TRANS') = 1
       and public.rehearse2c_balance('c0000000-0000-0000-0000-000000000008') = 0 as pass;

\echo ''
\echo '=========================================================='
\echo 'SCENARIO 6 — CONFLICTING / UNRELATED INPUTS DO NOT CORRUPT THE TOTAL'
\echo '=========================================================='

select public.rehearse2c_seed_purchase(
  'c0000000-0000-0000-0000-000000000009', 'ORD-CONF', 'PAY-CONF', 3300, 5);

select 's6_first_instalment' as test,
       public.process_square_refund('RF-CF-A', 'PAY-CONF', 'COMPLETED', 2000, 'USD', 'ORD-CONF', 'LG8FD2SPNNAVX')
         @> '{"result":"recorded_partial","cumulative_refunded_cents":2000}'::jsonb as pass;

-- Currency: rejected, and NOT counted. This guard is load-bearing — the
-- cumulative sum adds bare integers, so a foreign-currency instalment
-- slipping in would make the total meaningless.
select 's6_currency_mismatch_rejected' as test,
       public.process_square_refund('RF-CF-B', 'PAY-CONF', 'COMPLETED', 1300, 'EUR', 'ORD-CONF', 'LG8FD2SPNNAVX')
         @> '{"ok":false,"result":"currency_mismatch","expected_currency":"USD","reported_currency":"EUR"}'::jsonb as pass;

select 's6_currency_mismatch_not_counted' as test,
       (select count(*) from public.square_refunds where square_refund_id = 'RF-CF-B') = 0 as pass;

select 's6_wrong_location_rejected' as test,
       (public.process_square_refund('RF-CF-C', 'PAY-CONF', 'COMPLETED', 1300, 'USD', 'ORD-CONF', 'LWRONGLOCATION')
         ->> 'result') = 'location_mismatch' as pass;

select 's6_wrong_payment_id_rejected' as test,
       (public.process_square_refund('RF-CF-D', 'PAY-SOMEONE-ELSE', 'COMPLETED', 1300, 'USD', 'ORD-CONF', 'LG8FD2SPNNAVX')
         ->> 'result') = 'conflict_payment_id' as pass;

select 's6_unrelated_order_id_rejected' as test,
       (public.process_square_refund('RF-CF-E', 'PAY-CONF', 'COMPLETED', 1300, 'USD', 'ORD-DOES-NOT-EXIST', 'LG8FD2SPNNAVX')
         ->> 'result') = 'unmatched_payment' as pass;

-- Reusing an existing refund id against a different order: one refund id
-- must never describe two different movements of money.
select 's6_refund_id_reused_for_other_money_rejected' as test,
       (public.process_square_refund('RF-CF-A', 'PAY-2P', 'COMPLETED', 2000, 'USD', 'ORD-2P', 'LG8FD2SPNNAVX')
         ->> 'result') = 'conflict_refund_mismatch' as pass;

-- After five rejected attempts the running total is exactly where it was.
select 's6_cumulative_total_uncorrupted' as test,
       (select coalesce(sum(amount_cents), 0) from public.square_refunds
         where square_order_id = 'ORD-CONF' and refund_status = 'COMPLETED') = 2000 as pass;

select 's6_completing_instalment_still_works' as test,
       public.process_square_refund('RF-CF-Z', 'PAY-CONF', 'COMPLETED', 1300, 'USD', 'ORD-CONF', 'LG8FD2SPNNAVX')
         @> '{"result":"credits_removed","credits_removed":5,"cumulative_refunded_cents":3300}'::jsonb as pass;

select 's6_balance_zero' as test,
       public.rehearse2c_balance('c0000000-0000-0000-0000-000000000009') = 0 as pass;

\echo ''
\echo '=========================================================='
\echo 'SCENARIO 7 — AMBIGUOUS ATTRIBUTION STILL WITHHELD AT FULL'
\echo 'Reaching full cumulatively must not bypass the ambiguity rule.'
\echo '=========================================================='

select public.rehearse2c_seed_purchase(
  'c0000000-0000-0000-0000-000000000010', 'ORD-AMB-1', 'PAY-AMB-1', 3300, 5);
select public.rehearse2c_seed_purchase(
  'c0000000-0000-0000-0000-000000000010', 'ORD-AMB-2', 'PAY-AMB-2', 3300, 5);
select public.rehearse2c_consume('c0000000-0000-0000-0000-000000000010', 1);

select 's7_first_instalment' as test,
       public.process_square_refund('RF-AM-A', 'PAY-AMB-1', 'COMPLETED', 1300, 'USD', 'ORD-AMB-1', 'LG8FD2SPNNAVX')
         @> '{"result":"recorded_partial"}'::jsonb as pass;

select 's7_full_cumulative_still_ambiguous' as test,
       public.process_square_refund('RF-AM-B', 'PAY-AMB-1', 'COMPLETED', 2000, 'USD', 'ORD-AMB-1', 'LG8FD2SPNNAVX')
         @> '{"ok":true,"result":"ambiguous_attribution","credits_removed":0,"requires_review":true,"is_full_refund":true}'::jsonb as pass;

select 's7_balance_unchanged' as test,
       public.rehearse2c_balance('c0000000-0000-0000-0000-000000000010') = 9 as pass;

select 's7_no_refund_ledger_row' as test,
       public.rehearse2c_refund_ledger_rows('ORD-AMB-1') = 0 as pass;

-- Even withheld, the money IS fully returned, so the payment must be marked
-- refunded or a replayed payment webhook could re-credit it.
select 's7_payment_still_marked_refunded' as test,
       (select status from public.square_payments where square_order_id = 'ORD-AMB-1') = 'refunded' as pass;

\echo ''
\echo '=========================================================='
\echo 'CONCURRENCY SEEDS — completed by scripts/rehearse-2c-race.sh'
\echo '=========================================================='

-- Race A: the SAME crossing refund id delivered N times in parallel.
select public.rehearse2c_seed_purchase(
  'c0000000-0000-0000-0000-000000000011', 'ORD-RACE-A', 'PAY-RACE-A', 3300, 5);
select public.process_square_refund('RF-RA-SEED', 'PAY-RACE-A', 'COMPLETED', 2000, 'USD', 'ORD-RACE-A', 'LG8FD2SPNNAVX');

-- Race B: N DIFFERENT refund ids, each individually valid, all racing to be
-- the one that completes the total. Exactly one may win; the rest must be
-- caught by the cumulative guard rather than clawing back again.
select public.rehearse2c_seed_purchase(
  'c0000000-0000-0000-0000-000000000012', 'ORD-RACE-B', 'PAY-RACE-B', 3300, 5);
select public.process_square_refund('RF-RB-SEED', 'PAY-RACE-B', 'COMPLETED', 2000, 'USD', 'ORD-RACE-B', 'LG8FD2SPNNAVX');

select 'seeds_ready' as test,
       (select cumulative_refunded_cents from public.square_refunds where square_refund_id = 'RF-RA-SEED') = 2000
       and (select cumulative_refunded_cents from public.square_refunds where square_refund_id = 'RF-RB-SEED') = 2000
       and public.rehearse2c_balance('c0000000-0000-0000-0000-000000000011') = 5
       and public.rehearse2c_balance('c0000000-0000-0000-0000-000000000012') = 5 as pass;

\echo ''
\echo '=========================================================='
\echo 'GLOBAL INVARIANTS'
\echo '=========================================================='

select 'inv_no_negative_balances' as test,
       not exists (
         select 1 from public.credit_ledger
         group by user_id having sum(delta) < 0
       ) as pass;

select 'inv_at_most_one_refund_row_per_order' as test,
       not exists (
         select 1 from public.credit_ledger
         where reason = 'refund'
         group by square_order_id having count(*) > 1
       ) as pass;

select 'inv_removal_never_exceeds_grant' as test,
       not exists (
         select 1
         from public.credit_ledger r
         join public.credit_ledger p
           on p.square_order_id = r.square_order_id and p.reason = 'purchase'
         where r.reason = 'refund' and (-r.delta) > p.delta
       ) as pass;

-- The cumulative policy as a database-wide invariant: no claw-back may exist
-- for an order whose completed refunds fall SHORT of the purchase price.
--
-- Stated as `< purchase`, not `<> purchase`. An order can legitimately end up
-- summing above its purchase price, because a flagged over-refund row is
-- deliberately preserved with its real COMPLETED status (ORD-OVER2 sums to
-- 3400 after the extra 100-cent refund). The claw-back there was correct: it
-- happened when the total was exactly 3300, and the later row changed no
-- credits. What must never happen is removing credits from a customer who has
-- not yet been made whole, which is what this asserts.
select 'inv_claw_back_never_on_under_refunded_order' as test,
       not exists (
         select 1
         from public.credit_ledger l
         join public.square_payments p on p.square_order_id = l.square_order_id
         where l.reason = 'refund'
           and coalesce((
             select sum(r.amount_cents) from public.square_refunds r
             where r.square_order_id = l.square_order_id and r.refund_status = 'COMPLETED'
           ), 0) < p.amount_cents
       ) as pass;

-- And no flagged over-refund may itself have removed anything.
select 'inv_over_refunds_never_removed_credits' as test,
       not exists (
         select 1 from public.square_refunds
         where result_code = 'conflict_over_refund' and credits_removed <> 0
       ) as pass;

select 'inv_every_partial_flagged_for_review' as test,
       not exists (
         select 1 from public.square_refunds
         where result_code = 'recorded_partial' and not requires_review
       ) as pass;

select 'inv_snapshots_populated' as test,
       not exists (
         select 1 from public.square_refunds
         where cumulative_refunded_cents is null or purchase_amount_cents is null
       ) as pass;

-- Refunds must not create or destroy delivered work. Completing a session
-- DOES write a report (that is what the completion RPC is for), so the
-- assertion is that reports still correspond one-to-one with the completed
-- sessions — no refund added or removed one.
select 'inv_reports_match_completed_sessions' as test,
       (select count(*) from public.reports where user_id::text like 'c0000000-%')
       = (select count(*) from public.sessions
           where user_id::text like 'c0000000-%' and status = 'completed') as pass;

select 'inv_no_sessions_reverted_by_refunds' as test,
       not exists (
         select 1 from public.sessions
         where user_id::text like 'c0000000-%' and status not in ('completed', 'draft')
       ) as pass;

\echo ''
\echo 'Review every pass column above. Then run scripts/rehearse-2c-race.sh.'
