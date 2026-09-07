-- scripts/rehearse-square-refunds.sql — Stage 2B rehearsal.
--
-- RUN ONLY ON A DISPOSABLE SUPABASE BRANCH WITH NO REAL DATA.
-- It creates users, purchases, sessions and refunds, and deletes them at the
-- end. Never point it at production.
--
-- This exists because the mocked route tests structurally cannot prove the
-- properties that matter most about a claw-back. They have no transactions,
-- no row locks and no unique indexes, so they cannot demonstrate that the
-- refund record, the ledger removal and the payment status change commit
-- together, nor that two concurrent deliveries remove credits once.
--
-- Sessions are consumed through the REAL
-- complete_session_and_consume_entitlement RPC rather than by inserting
-- debit rows by hand, so the attribution arithmetic is exercised against
-- ledger rows shaped exactly as production writes them.
--
-- Each check prints `t` in the pass column. Any `f` is a failure.
--
-- Usage:
--   psql "$BRANCH_URL" -v ON_ERROR_STOP=1 -f scripts/rehearse-square-refunds.sql

\set ON_ERROR_STOP on
\timing off

-- ===========================================================================
-- Fixtures
-- ===========================================================================
begin;

insert into auth.users (id, instance_id, aud, role, email)
values
  ('a0000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'unused@rehearsal.test'),
  ('a0000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'partial@rehearsal.test'),
  ('a0000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'fullyused@rehearsal.test'),
  ('a0000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ambiguous@rehearsal.test'),
  ('a0000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'concurrent@rehearsal.test'),
  ('a0000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'inject@rehearsal.test'),
  ('a0000000-0000-0000-0000-000000000007', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conflicts@rehearsal.test')
on conflict (id) do nothing;

insert into public.session_tiers (id, name, session_count, price_cents, currency, active, sort_order)
values ('b0000000-0000-0000-0000-0000000000ff', 'Rehearsal 5-pack', 5, 3300, 'USD', true, 99)
on conflict (id) do nothing;

-- Exhaust the 2 complimentary sessions for every fixture user, so that
-- completing a session consumes a CREDIT rather than a free allowance.
insert into public.free_sessions_used (user_id, count)
select id, 2 from auth.users where email like '%@rehearsal.test'
on conflict (user_id) do update set count = 2;

commit;

-- Helper: seed a paid purchase plus its credit, exactly as
-- process_square_payment would leave them.
create or replace function public.rehearse_seed_purchase(
  p_user uuid, p_order text, p_payment text, p_cents integer, p_credits integer
) returns void language plpgsql as $$
begin
  insert into public.square_payments
    (user_id, tier_id, square_order_id, square_payment_id, amount_cents, status,
     currency, session_count, square_location_id)
  values
    (p_user, 'b0000000-0000-0000-0000-0000000000ff', p_order, p_payment, p_cents, 'paid',
     'USD', p_credits, 'LG8FD2SPNNAVX');

  insert into public.credit_ledger (user_id, delta, reason, tier_id, square_order_id)
  values (p_user, p_credits, 'purchase', 'b0000000-0000-0000-0000-0000000000ff', p_order);
end;
$$;

-- Helper: consume N sessions through the real completion RPC.
create or replace function public.rehearse_consume(p_user uuid, p_n integer)
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

-- ===========================================================================
-- CASE 1 — UNUSED. Nothing consumed after the purchase, so the whole grant
-- is clawed back.
-- ===========================================================================
select public.rehearse_seed_purchase(
  'a0000000-0000-0000-0000-000000000001', 'ORD-UNUSED', 'PAY-UNUSED', 3300, 5);

select 'unused_refund' as test,
       public.process_square_refund('RF-UNUSED', 'PAY-UNUSED', 'COMPLETED', 3300, 'USD', 'ORD-UNUSED', 'LG8FD2SPNNAVX')
         @> '{"ok":true,"result":"credits_removed","credits_removed":5,"attribution_basis":"unused"}'::jsonb as pass;

select 'unused_balance_zero' as test,
       (select coalesce(sum(delta), 0) from public.credit_ledger
         where user_id = 'a0000000-0000-0000-0000-000000000001') = 0 as pass;

select 'unused_payment_refunded' as test,
       (select status from public.square_payments where square_order_id = 'ORD-UNUSED') = 'refunded' as pass;

select 'unused_one_refund_ledger_row' as test,
       (select count(*) from public.credit_ledger
         where square_order_id = 'ORD-UNUSED' and reason = 'refund') = 1 as pass;

-- ===========================================================================
-- CASE 2 — PARTIAL USE, sole source. 5 bought, 2 consumed, 3 unused.
-- Only the 3 unused come back.
-- ===========================================================================
select public.rehearse_seed_purchase(
  'a0000000-0000-0000-0000-000000000002', 'ORD-PARTIAL', 'PAY-PARTIAL', 3300, 5);
select public.rehearse_consume('a0000000-0000-0000-0000-000000000002', 2);

select 'partial_use_refund' as test,
       public.process_square_refund('RF-PARTIAL', 'PAY-PARTIAL', 'COMPLETED', 3300, 'USD', 'ORD-PARTIAL', 'LG8FD2SPNNAVX')
         @> '{"ok":true,"result":"credits_removed","credits_removed":3,"attribution_basis":"sole_source"}'::jsonb as pass;

select 'partial_use_balance_zero_not_negative' as test,
       (select coalesce(sum(delta), 0) from public.credit_ledger
         where user_id = 'a0000000-0000-0000-0000-000000000002') = 0 as pass;

-- The two sessions the buyer already had must survive the refund untouched.
select 'partial_use_sessions_preserved' as test,
       (select count(*) from public.sessions
         where user_id = 'a0000000-0000-0000-0000-000000000002' and status = 'completed') = 2 as pass;

select 'partial_use_reports_preserved' as test,
       (select count(*) from public.reports
         where user_id = 'a0000000-0000-0000-0000-000000000002') = 2 as pass;

select 'partial_use_entitlement_usage_preserved' as test,
       (select count(*) from public.session_entitlement_usage
         where user_id = 'a0000000-0000-0000-0000-000000000002') = 2 as pass;

-- ===========================================================================
-- CASE 3 — FULLY USED. All 5 consumed, nothing to remove, and crucially the
-- balance is not driven negative.
-- ===========================================================================
select public.rehearse_seed_purchase(
  'a0000000-0000-0000-0000-000000000003', 'ORD-USED', 'PAY-USED', 3300, 5);
select public.rehearse_consume('a0000000-0000-0000-0000-000000000003', 5);

select 'fully_used_refund' as test,
       public.process_square_refund('RF-USED', 'PAY-USED', 'COMPLETED', 3300, 'USD', 'ORD-USED', 'LG8FD2SPNNAVX')
         @> '{"ok":true,"result":"no_credits_to_remove","credits_removed":0,"attribution_basis":"sole_source"}'::jsonb as pass;

select 'fully_used_balance_not_negative' as test,
       (select coalesce(sum(delta), 0) from public.credit_ledger
         where user_id = 'a0000000-0000-0000-0000-000000000003') = 0 as pass;

select 'fully_used_no_refund_ledger_row' as test,
       (select count(*) from public.credit_ledger
         where square_order_id = 'ORD-USED' and reason = 'refund') = 0 as pass;

select 'fully_used_sessions_preserved' as test,
       (select count(*) from public.sessions
         where user_id = 'a0000000-0000-0000-0000-000000000003' and status = 'completed') = 5 as pass;

-- ===========================================================================
-- CASE 4 — AMBIGUOUS. Two purchases, then consumption. Which pack the
-- sessions came from is unrecoverable, so NO credit change happens.
-- ===========================================================================
select public.rehearse_seed_purchase(
  'a0000000-0000-0000-0000-000000000004', 'ORD-AMB-1', 'PAY-AMB-1', 3300, 5);
select public.rehearse_seed_purchase(
  'a0000000-0000-0000-0000-000000000004', 'ORD-AMB-2', 'PAY-AMB-2', 3300, 5);
select public.rehearse_consume('a0000000-0000-0000-0000-000000000004', 3);

select 'ambiguous_refund' as test,
       public.process_square_refund('RF-AMB', 'PAY-AMB-1', 'COMPLETED', 3300, 'USD', 'ORD-AMB-1', 'LG8FD2SPNNAVX')
         @> '{"ok":true,"result":"ambiguous_attribution","credits_removed":0,"requires_review":true}'::jsonb as pass;

select 'ambiguous_balance_untouched' as test,
       (select coalesce(sum(delta), 0) from public.credit_ledger
         where user_id = 'a0000000-0000-0000-0000-000000000004') = 7 as pass;

select 'ambiguous_no_credit_row_written' as test,
       (select count(*) from public.credit_ledger
         where user_id = 'a0000000-0000-0000-0000-000000000004' and reason = 'refund') = 0 as pass;

select 'ambiguous_is_a_review_item' as test,
       (select requires_review and resolved_at is null and credits_removed = 0
          from public.square_refunds where square_refund_id = 'RF-AMB') as pass;

select 'ambiguous_evidence_recorded' as test,
       (select attribution_evidence @> '{"grant":5,"balance_before":7,"debits_after_purchase":3}'::jsonb
          from public.square_refunds where square_refund_id = 'RF-AMB') as pass;

-- The unrelated second purchase must be entirely unaffected.
select 'ambiguous_other_purchase_untouched' as test,
       (select status from public.square_payments where square_order_id = 'ORD-AMB-2') = 'paid' as pass;

-- ===========================================================================
-- CASE 5 — REPLAY. Redelivering the same refund id must not remove twice.
-- ===========================================================================
select 'replay_same_refund' as test,
       public.process_square_refund('RF-UNUSED', 'PAY-UNUSED', 'COMPLETED', 3300, 'USD', 'ORD-UNUSED', 'LG8FD2SPNNAVX')
         @> '{"ok":true,"result":"already_processed"}'::jsonb as pass;

select 'replay_no_second_removal' as test,
       (select count(*) from public.credit_ledger
         where square_order_id = 'ORD-UNUSED' and reason = 'refund') = 1 as pass;

select 'replay_balance_still_zero' as test,
       (select coalesce(sum(delta), 0) from public.credit_ledger
         where user_id = 'a0000000-0000-0000-0000-000000000001') = 0 as pass;

select 'replay_attempt_counted' as test,
       (select attempt_count from public.square_refunds where square_refund_id = 'RF-UNUSED') >= 2 as pass;

-- Replaying an ambiguous refund must not later become an automatic removal.
select 'replay_ambiguous_stays_ambiguous' as test,
       public.process_square_refund('RF-AMB', 'PAY-AMB-1', 'COMPLETED', 3300, 'USD', 'ORD-AMB-1', 'LG8FD2SPNNAVX')
         @> '{"ok":true,"result":"already_processed","credits_removed":0}'::jsonb as pass;

-- ===========================================================================
-- CASE 6 — PENDING then COMPLETED. A refund seen first as PENDING must
-- record without touching credits, then claw back exactly once when it
-- completes.
-- ===========================================================================
select public.rehearse_seed_purchase(
  'a0000000-0000-0000-0000-000000000006', 'ORD-TRANS', 'PAY-TRANS', 3300, 5);

select 'transition_pending_no_change' as test,
       public.process_square_refund('RF-TRANS', 'PAY-TRANS', 'PENDING', 3300, 'USD', 'ORD-TRANS', 'LG8FD2SPNNAVX')
         @> '{"ok":true,"result":"recorded_not_completed","credits_removed":0}'::jsonb as pass;

select 'transition_pending_balance_intact' as test,
       (select coalesce(sum(delta), 0) from public.credit_ledger
         where user_id = 'a0000000-0000-0000-0000-000000000006') = 5 as pass;

select 'transition_pending_payment_still_paid' as test,
       (select status from public.square_payments where square_order_id = 'ORD-TRANS') = 'paid' as pass;

select 'transition_completed_removes_once' as test,
       public.process_square_refund('RF-TRANS', 'PAY-TRANS', 'COMPLETED', 3300, 'USD', 'ORD-TRANS', 'LG8FD2SPNNAVX')
         @> '{"ok":true,"result":"credits_removed","credits_removed":5}'::jsonb as pass;

select 'transition_final_balance_zero' as test,
       (select coalesce(sum(delta), 0) from public.credit_ledger
         where user_id = 'a0000000-0000-0000-0000-000000000006') = 0 as pass;

select 'transition_single_refund_row' as test,
       (select count(*) from public.square_refunds where square_refund_id = 'RF-TRANS') = 1 as pass;

-- ===========================================================================
-- CASE 7 — FAILURE INJECTION.
--
-- The property mocked tests cannot show: if the transaction dies after the
-- claw-back but before it is committed, NOTHING survives — no refund row, no
-- ledger removal, no status change. The balance must be exactly as before.
-- ===========================================================================
select public.rehearse_seed_purchase(
  'a0000000-0000-0000-0000-000000000005', 'ORD-INJECT', 'PAY-INJECT', 3300, 5);

begin;
select public.process_square_refund('RF-INJECT', 'PAY-INJECT', 'COMPLETED', 3300, 'USD', 'ORD-INJECT', 'LG8FD2SPNNAVX');
-- Confirm the work really did happen inside this transaction before we kill it.
select 'inject_visible_in_txn' as test,
       (select coalesce(sum(delta), 0) from public.credit_ledger
         where user_id = 'a0000000-0000-0000-0000-000000000005') = 0 as pass;
rollback;

select 'inject_balance_restored' as test,
       (select coalesce(sum(delta), 0) from public.credit_ledger
         where user_id = 'a0000000-0000-0000-0000-000000000005') = 5 as pass;

select 'inject_no_refund_row' as test,
       (select count(*) from public.square_refunds where square_refund_id = 'RF-INJECT') = 0 as pass;

select 'inject_no_ledger_row' as test,
       (select count(*) from public.credit_ledger
         where square_order_id = 'ORD-INJECT' and reason = 'refund') = 0 as pass;

select 'inject_payment_still_paid' as test,
       (select status from public.square_payments where square_order_id = 'ORD-INJECT') = 'paid' as pass;

-- And the refund is still fully processable afterwards: an aborted attempt
-- must not poison the order.
select 'inject_retry_succeeds' as test,
       public.process_square_refund('RF-INJECT', 'PAY-INJECT', 'COMPLETED', 3300, 'USD', 'ORD-INJECT', 'LG8FD2SPNNAVX')
         @> '{"ok":true,"result":"credits_removed","credits_removed":5}'::jsonb as pass;

-- ===========================================================================
-- CASE 8 — PARTIAL REFUND AMOUNT. Less than the purchase total authorises no
-- automatic removal.
-- ===========================================================================
select public.rehearse_seed_purchase(
  'a0000000-0000-0000-0000-000000000007', 'ORD-HALF', 'PAY-HALF', 3300, 5);

select 'partial_amount_recorded_only' as test,
       public.process_square_refund('RF-HALF', 'PAY-HALF', 'COMPLETED', 1650, 'USD', 'ORD-HALF', 'LG8FD2SPNNAVX')
         @> '{"ok":true,"result":"recorded_partial","credits_removed":0,"requires_review":true}'::jsonb as pass;

select 'partial_amount_balance_intact' as test,
       (select coalesce(sum(delta), 0) from public.credit_ledger
         where user_id = 'a0000000-0000-0000-0000-000000000007') = 5 as pass;

select 'partial_amount_payment_not_refunded' as test,
       (select status from public.square_payments where square_order_id = 'ORD-HALF') = 'paid' as pass;

select 'partial_amount_not_full_flag' as test,
       (select is_full_refund = false from public.square_refunds where square_refund_id = 'RF-HALF') as pass;

-- ===========================================================================
-- CASE 9 — CONFLICTS AND REJECTIONS. Every one of these must write nothing.
-- ===========================================================================
select 'conflict_unmatched_payment' as test,
       public.process_square_refund('RF-NOPE', 'PAY-NOPE', 'COMPLETED', 3300, 'USD', 'ORD-NOPE', 'LG8FD2SPNNAVX')
         @> '{"result":"unmatched_payment"}'::jsonb as pass;

select 'conflict_wrong_payment_id' as test,
       public.process_square_refund('RF-WRONGPAY', 'PAY-SOMEONEELSE', 'COMPLETED', 3300, 'USD', 'ORD-HALF', 'LG8FD2SPNNAVX')
         @> '{"result":"conflict_payment_id"}'::jsonb as pass;

select 'conflict_amount_exceeds_purchase' as test,
       public.process_square_refund('RF-TOOBIG', 'PAY-HALF', 'COMPLETED', 9900, 'USD', 'ORD-HALF', 'LG8FD2SPNNAVX')
         @> '{"result":"conflict_amount"}'::jsonb as pass;

select 'conflict_currency' as test,
       public.process_square_refund('RF-CUR', 'PAY-HALF', 'COMPLETED', 3300, 'EUR', 'ORD-HALF', 'LG8FD2SPNNAVX')
         @> '{"result":"currency_mismatch"}'::jsonb as pass;

select 'conflict_location' as test,
       public.process_square_refund('RF-LOC', 'PAY-HALF', 'COMPLETED', 3300, 'USD', 'ORD-HALF', 'LSOMEWHEREELSE')
         @> '{"result":"location_mismatch"}'::jsonb as pass;

select 'reject_invalid_amount' as test,
       public.process_square_refund('RF-ZERO', 'PAY-HALF', 'COMPLETED', 0, 'USD', 'ORD-HALF', 'LG8FD2SPNNAVX')
         @> '{"result":"invalid_amount"}'::jsonb as pass;

select 'reject_blank_refund_id' as test,
       public.process_square_refund('   ', 'PAY-HALF', 'COMPLETED', 3300, 'USD', 'ORD-HALF', 'LG8FD2SPNNAVX')
         @> '{"result":"invalid_refund_id"}'::jsonb as pass;

select 'reject_blank_status' as test,
       public.process_square_refund('RF-NOSTAT', 'PAY-HALF', '  ', 3300, 'USD', 'ORD-HALF', 'LG8FD2SPNNAVX')
         @> '{"result":"invalid_refund_status"}'::jsonb as pass;

-- A refund against a payment that never reached 'paid'.
insert into public.square_payments
  (user_id, tier_id, square_order_id, square_payment_id, amount_cents, status, currency, session_count, square_location_id)
values
  ('a0000000-0000-0000-0000-000000000007', 'b0000000-0000-0000-0000-0000000000ff', 'ORD-PENDING', 'PAY-PENDING',
   3300, 'pending', 'USD', 5, 'LG8FD2SPNNAVX');

select 'conflict_not_credited' as test,
       public.process_square_refund('RF-PEND', 'PAY-PENDING', 'COMPLETED', 3300, 'USD', 'ORD-PENDING', 'LG8FD2SPNNAVX')
         @> '{"result":"conflict_not_credited"}'::jsonb as pass;

select 'all_rejections_wrote_nothing' as test,
       (select count(*) from public.square_refunds
         where square_refund_id in ('RF-NOPE','RF-WRONGPAY','RF-TOOBIG','RF-CUR','RF-LOC','RF-ZERO','RF-NOSTAT','RF-PEND')) = 0 as pass;

select 'conflicts_left_balance_intact' as test,
       (select coalesce(sum(delta), 0) from public.credit_ledger
         where user_id = 'a0000000-0000-0000-0000-000000000007') = 5 as pass;

-- ===========================================================================
-- CASE 10 — order id omitted. It must be resolved from the payment id before
-- the advisory lock is taken.
-- ===========================================================================
select 'order_id_resolved_from_payment' as test,
       public.process_square_refund('RF-NOORDER', 'PAY-HALF', 'PENDING', 1650, 'USD', null, 'LG8FD2SPNNAVX')
         @> '{"ok":true,"result":"recorded_not_completed"}'::jsonb as pass;

select 'order_id_resolved_correctly' as test,
       (select square_order_id from public.square_refunds where square_refund_id = 'RF-NOORDER') = 'ORD-HALF' as pass;

-- ===========================================================================
-- CASE 11 — the Stage 2A interaction. Once refunded, a replayed PAYMENT
-- webhook must not re-credit the purchase.
-- ===========================================================================
select 'refunded_purchase_cannot_be_recredited' as test,
       public.process_square_payment('ORD-UNUSED', 'PAY-UNUSED', 3300, 'USD', 'LG8FD2SPNNAVX')
         @> '{"ok":false,"result":"conflict_status","status":"refunded"}'::jsonb as pass;

select 'refunded_purchase_balance_still_zero' as test,
       (select coalesce(sum(delta), 0) from public.credit_ledger
         where user_id = 'a0000000-0000-0000-0000-000000000001') = 0 as pass;

-- ===========================================================================
-- Global invariants
-- ===========================================================================
select 'no_user_has_a_negative_balance' as test,
       not exists (
         select 1 from public.credit_ledger
         group by user_id having coalesce(sum(delta), 0) < 0
       ) as pass;

select 'no_refund_removed_more_than_its_grant' as test,
       not exists (
         select 1
         from public.square_refunds r
         join public.credit_ledger p
           on p.square_order_id = r.square_order_id and p.reason = 'purchase'
         where r.credits_removed > p.delta
       ) as pass;

select 'at_most_one_refund_row_per_order' as test,
       not exists (
         select 1 from public.credit_ledger
         where reason = 'refund'
         group by square_order_id having count(*) > 1
       ) as pass;

select 'no_session_or_report_was_reversed' as test,
       (select count(*) from public.sessions where status = 'completed') =
       (select count(*) from public.reports) as pass;

-- ===========================================================================
-- Cleanup
-- ===========================================================================
begin;
delete from public.square_refunds where square_refund_id like 'RF-%';
delete from public.session_entitlement_usage where user_id in
  (select id from auth.users where email like '%@rehearsal.test');
delete from public.reports where user_id in
  (select id from auth.users where email like '%@rehearsal.test');
delete from public.sessions where user_id in
  (select id from auth.users where email like '%@rehearsal.test');
delete from public.credit_ledger where user_id in
  (select id from auth.users where email like '%@rehearsal.test');
delete from public.square_payments where user_id in
  (select id from auth.users where email like '%@rehearsal.test');
delete from public.free_sessions_used where user_id in
  (select id from auth.users where email like '%@rehearsal.test');
delete from public.session_tiers where id = 'b0000000-0000-0000-0000-0000000000ff';
delete from auth.users where email like '%@rehearsal.test';
drop function if exists public.rehearse_seed_purchase(uuid, text, text, integer, integer);
drop function if exists public.rehearse_consume(uuid, integer);
commit;

select 'cleanup_complete' as test,
       (select count(*) from auth.users where email like '%@rehearsal.test') = 0 as pass;
