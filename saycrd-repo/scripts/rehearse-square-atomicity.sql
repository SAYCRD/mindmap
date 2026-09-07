-- scripts/rehearse-square-atomicity.sql — Stage 2A rehearsal.
--
-- Proves the properties the JavaScript tests structurally CANNOT prove,
-- because they need real Postgres: transaction atomicity, the row lock, the
-- partial unique index, and the recovery path.
--
-- RUN ONLY against a disposable Supabase branch with no real data. Never
-- against production. It writes rows, deliberately injects failures, and
-- cleans up after itself.
--
-- Expected output is annotated inline as `-- EXPECT:` on each check.

\set ON_ERROR_STOP on

begin;

-- Test fixtures. auth.users has an FK from square_payments/credit_ledger, so
-- create a throwaway user rather than borrowing a real one.
insert into auth.users (id, instance_id, aud, role, email)
values ('99999999-9999-9999-9999-999999999999', '00000000-0000-0000-0000-000000000000',
        'authenticated', 'authenticated', 'rehearsal-2a@example.invalid')
on conflict (id) do nothing;

insert into public.session_tiers (id, name, session_count, price_cents, currency, active, sort_order)
values ('88888888-8888-8888-8888-888888888888', 'Rehearsal pack', 3, 1500, 'usd', true, 999)
on conflict (id) do nothing;

commit;

-- ===========================================================================
-- 1. HAPPY PATH: pending -> paid AND exactly one purchase credit, together.
-- ===========================================================================
begin;
insert into public.square_payments
  (user_id, tier_id, square_order_id, amount_cents, currency, session_count, square_location_id, status)
values
  ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888',
   'REH-ORDER-1', 1500, 'USD', 3, 'LG8FD2SPNNAVX', 'pending');
commit;

select 'happy_path' as test,
       public.process_square_payment('REH-ORDER-1', 'REH-PAY-1', 1500, 'USD', 'LG8FD2SPNNAVX',
         '{"event_id":"REH-EVT-1"}'::jsonb) as result;
-- EXPECT: {"ok": true, "result": "credited", "credits": 3, "repaired": false}

select 'happy_path_state' as test,
       (select status from public.square_payments where square_order_id = 'REH-ORDER-1') as payment_status,
       (select count(*) from public.credit_ledger where square_order_id = 'REH-ORDER-1' and reason = 'purchase') as credit_rows,
       (select sum(delta) from public.credit_ledger where square_order_id = 'REH-ORDER-1') as credited;
-- EXPECT: paid | 1 | 3

-- ===========================================================================
-- 2. REPLAY: the same event again must not grant a second credit.
-- ===========================================================================
select 'replay' as test,
       public.process_square_payment('REH-ORDER-1', 'REH-PAY-1', 1500, 'USD', 'LG8FD2SPNNAVX',
         '{"event_id":"REH-EVT-1"}'::jsonb) as result;
-- EXPECT: {"ok": true, "result": "already_processed", "credits": 3, "repaired": false}

select 'replay_state' as test,
       (select count(*) from public.credit_ledger where square_order_id = 'REH-ORDER-1' and reason = 'purchase') as credit_rows;
-- EXPECT: 1  (still exactly one)

-- ===========================================================================
-- 3. ATOMICITY UNDER INJECTED FAILURE.
--
-- A trigger makes the square_payments UPDATE fail *after* the ledger insert
-- has already happened inside the function — precisely the partial failure
-- that used to leave money collected with no entitlement. Because both
-- writes share one transaction, BOTH must roll back.
-- ===========================================================================
begin;
insert into public.square_payments
  (user_id, tier_id, square_order_id, amount_cents, currency, session_count, square_location_id, status)
values
  ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888',
   'REH-ORDER-2', 1500, 'USD', 3, 'LG8FD2SPNNAVX', 'pending');
commit;

create or replace function public.rehearsal_fail_payment_update()
returns trigger language plpgsql as $$
begin
  if new.status = 'paid' and old.square_order_id = 'REH-ORDER-2' then
    raise exception 'injected failure: simulated crash between the two writes';
  end if;
  return new;
end;
$$;

create trigger rehearsal_fail_update
  before update on public.square_payments
  for each row execute function public.rehearsal_fail_payment_update();

-- The injected exception propagates out of the function, so this SELECT
-- errors. That is the expected result; ON_ERROR_STOP is relaxed for it.
\set ON_ERROR_STOP off
select 'injected_failure' as test,
       public.process_square_payment('REH-ORDER-2', 'REH-PAY-2', 1500, 'USD', 'LG8FD2SPNNAVX',
         '{"event_id":"REH-EVT-2"}'::jsonb) as result;
-- EXPECT: ERROR  injected failure: simulated crash between the two writes
\set ON_ERROR_STOP on

drop trigger rehearsal_fail_update on public.square_payments;
drop function public.rehearsal_fail_payment_update();

select 'injected_failure_state' as test,
       (select status from public.square_payments where square_order_id = 'REH-ORDER-2') as payment_status,
       (select count(*) from public.credit_ledger where square_order_id = 'REH-ORDER-2') as credit_rows;
-- EXPECT: pending | 0
-- The ledger insert rolled back with the failed update: no orphaned credit,
-- and the payment is still 'pending' so replaying the event recovers it.

-- ===========================================================================
-- 4. RECOVERY: replay after the failure credits correctly.
-- ===========================================================================
select 'recovery' as test,
       public.process_square_payment('REH-ORDER-2', 'REH-PAY-2', 1500, 'USD', 'LG8FD2SPNNAVX',
         '{"event_id":"REH-EVT-2"}'::jsonb) as result;
-- EXPECT: {"ok": true, "result": "credited", "credits": 3, "repaired": false}

select 'recovery_state' as test,
       (select status from public.square_payments where square_order_id = 'REH-ORDER-2') as payment_status,
       (select count(*) from public.credit_ledger where square_order_id = 'REH-ORDER-2') as credit_rows;
-- EXPECT: paid | 1

-- ===========================================================================
-- 5. REPAIR OF A LEGACY PARTIAL STATE.
--
-- Simulates the exact state the old code could leave behind: marked paid,
-- but no credit. A replay must grant the missing credits rather than
-- reporting "already handled".
-- ===========================================================================
begin;
insert into public.square_payments
  (user_id, tier_id, square_order_id, amount_cents, currency, session_count, square_location_id, status, square_payment_id)
values
  ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888',
   'REH-ORDER-3', 1500, 'USD', 3, 'LG8FD2SPNNAVX', 'paid', 'REH-PAY-3');
commit;

select 'repair_lost_credit' as test,
       public.process_square_payment('REH-ORDER-3', 'REH-PAY-3', 1500, 'USD', 'LG8FD2SPNNAVX',
         '{"event_id":"REH-EVT-3"}'::jsonb) as result;
-- EXPECT: {"ok": true, "result": "credited", "credits": 3, "repaired": false}
--         (money was already marked paid; the missing credit is now granted)

select 'repair_state' as test,
       (select sum(delta) from public.credit_ledger where square_order_id = 'REH-ORDER-3') as credited;
-- EXPECT: 3

-- ===========================================================================
-- 6. VALIDATION AGAINST THE PENDING ROW, NOT THE WEBHOOK.
-- ===========================================================================
begin;
insert into public.square_payments
  (user_id, tier_id, square_order_id, amount_cents, currency, session_count, square_location_id, status)
values
  ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888',
   'REH-ORDER-4', 1500, 'USD', 3, 'LG8FD2SPNNAVX', 'pending');
commit;

select 'amount_mismatch' as test,
       public.process_square_payment('REH-ORDER-4', 'REH-PAY-4', 100, 'USD', 'LG8FD2SPNNAVX', null) as result;
-- EXPECT: {"ok": false, "result": "amount_mismatch", "expected_cents": 1500, "reported_cents": 100}

select 'currency_mismatch' as test,
       public.process_square_payment('REH-ORDER-4', 'REH-PAY-4', 1500, 'CAD', 'LG8FD2SPNNAVX', null) as result;
-- EXPECT: {"ok": false, "result": "currency_mismatch", ...}

select 'location_mismatch' as test,
       public.process_square_payment('REH-ORDER-4', 'REH-PAY-4', 1500, 'USD', 'LWRONGPLACE', null) as result;
-- EXPECT: {"ok": false, "result": "location_mismatch"}

select 'unmatched' as test,
       public.process_square_payment('REH-ORDER-NONE', 'REH-PAY-X', 1500, 'USD', 'LG8FD2SPNNAVX', null) as result;
-- EXPECT: {"ok": false, "result": "unmatched"}

select 'invalid_amount' as test,
       public.process_square_payment('REH-ORDER-4', 'REH-PAY-4', 0, 'USD', null, null) as result;
-- EXPECT: {"ok": false, "result": "invalid_amount"}

-- Critically, none of the rejections above may have written anything.
select 'rejections_wrote_nothing' as test,
       (select status from public.square_payments where square_order_id = 'REH-ORDER-4') as payment_status,
       (select count(*) from public.credit_ledger where square_order_id = 'REH-ORDER-4') as credit_rows;
-- EXPECT: pending | 0

-- ===========================================================================
-- 7. A SECOND, DIFFERENT PAYMENT ID FOR THE SAME ORDER IS A CONFLICT.
-- ===========================================================================
select 'conflict_payment_id' as test,
       public.process_square_payment('REH-ORDER-1', 'REH-PAY-DIFFERENT', 1500, 'USD', 'LG8FD2SPNNAVX', null) as result;
-- EXPECT: {"ok": false, "result": "conflict_payment_id"}

-- ===========================================================================
-- 8. MISSING SNAPSHOT (a pre-Stage-2A pending row) IS REFUSED, NOT GUESSED.
-- ===========================================================================
begin;
insert into public.square_payments
  (user_id, tier_id, square_order_id, amount_cents, status)
values
  ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888',
   'REH-ORDER-5', 1500, 'pending');
commit;

select 'missing_snapshot' as test,
       public.process_square_payment('REH-ORDER-5', 'REH-PAY-5', 1500, 'USD', 'LG8FD2SPNNAVX', null) as result;
-- EXPECT: {"ok": false, "result": "missing_snapshot"}

-- ===========================================================================
-- 9. A MISMATCHED PRE-EXISTING LEDGER ROW IS NOT ACCEPTED AS A SAFE REPLAY.
--
-- Hand-write a purchase credit for the same order with the WRONG credit
-- amount, then replay. The unique index will fire; the function must
-- re-validate and refuse rather than reporting already_processed.
-- ===========================================================================
begin;
insert into public.square_payments
  (user_id, tier_id, square_order_id, amount_cents, currency, session_count, square_location_id, status)
values
  ('99999999-9999-9999-9999-999999999999', '88888888-8888-8888-8888-888888888888',
   'REH-ORDER-6', 1500, 'USD', 3, 'LG8FD2SPNNAVX', 'pending');

insert into public.credit_ledger (user_id, delta, reason, tier_id, square_order_id)
values ('99999999-9999-9999-9999-999999999999', 99, 'purchase',
        '88888888-8888-8888-8888-888888888888', 'REH-ORDER-6');
commit;

select 'conflict_ledger_mismatch' as test,
       public.process_square_payment('REH-ORDER-6', 'REH-PAY-6', 1500, 'USD', 'LG8FD2SPNNAVX', null) as result;
-- EXPECT: {"ok": false, "result": "conflict_ledger_mismatch", "existing_delta": 99, "expected_credits": 3}

select 'ledger_mismatch_state' as test,
       (select status from public.square_payments where square_order_id = 'REH-ORDER-6') as payment_status;
-- EXPECT: pending  (a conflict must not mark the payment paid)

-- ===========================================================================
-- 10. THE PARTIAL UNIQUE INDEX IS REAL.
-- ===========================================================================
\set ON_ERROR_STOP off
insert into public.credit_ledger (user_id, delta, reason, tier_id, square_order_id)
values ('99999999-9999-9999-9999-999999999999', 3, 'purchase',
        '88888888-8888-8888-8888-888888888888', 'REH-ORDER-1');
-- EXPECT: ERROR  duplicate key value violates unique constraint
--                "uq_credit_ledger_purchase_square_order"
\set ON_ERROR_STOP on

-- session_complete debits carry no order id and must remain unconstrained:
-- many of them can coexist.
insert into public.credit_ledger (user_id, delta, reason)
values ('99999999-9999-9999-9999-999999999999', -1, 'session_complete'),
       ('99999999-9999-9999-9999-999999999999', -1, 'session_complete');
-- EXPECT: INSERT 0 2

-- ===========================================================================
-- 11. DEAD-LETTER UPSERT: one row per event id, attempt_count increments.
-- ===========================================================================
select 'dead_letter_1' as test,
       public.record_square_webhook_dead_letter('REH-EVT-DL', 'unmatched', 503, 'payment.updated',
         'REH-ORDER-NONE', 'REH-PAY-X', 1500, 'USD', 'LG8FD2SPNNAVX', '{"event_id":"REH-EVT-DL"}'::jsonb) as result;
-- EXPECT: {"ok": true, "result": "recorded", "attempt_count": 1}

select 'dead_letter_2' as test,
       public.record_square_webhook_dead_letter('REH-EVT-DL', 'unmatched', 503, 'payment.updated',
         'REH-ORDER-NONE', 'REH-PAY-X', 1500, 'USD', 'LG8FD2SPNNAVX', '{"event_id":"REH-EVT-DL"}'::jsonb) as result;
-- EXPECT: {"ok": true, "result": "recorded", "attempt_count": 2}

select 'dead_letter_3' as test,
       public.record_square_webhook_dead_letter('REH-EVT-DL', 'unmatched', 503) as result;
-- EXPECT: attempt_count 3

select 'dead_letter_rows' as test, count(*) as rows, max(attempt_count) as attempts
from public.square_webhook_dead_letter where square_event_id = 'REH-EVT-DL';
-- EXPECT: 1 | 3   (retries reuse one record, never accumulate duplicates)

-- ===========================================================================
-- 12. ORPHANED LINK UPSERT.
-- ===========================================================================
select 'orphan_1' as test,
       public.record_square_orphaned_link('REH-ORPHAN-1', 'pending_insert_failed', 'LINK-1',
         'https://square.link/u/rehearsal', '99999999-9999-9999-9999-999999999999',
         '88888888-8888-8888-8888-888888888888', 1500, 'USD', 'LG8FD2SPNNAVX', 3) as result;
-- EXPECT: attempt_count 1

select 'orphan_2' as test,
       public.record_square_orphaned_link('REH-ORPHAN-1', 'pending_insert_failed') as result;
-- EXPECT: attempt_count 2

select 'orphan_rows' as test, count(*) as rows, max(attempt_count) as attempts,
       bool_or(checkout_url is not null) as url_retained
from public.square_orphaned_links where square_order_id = 'REH-ORPHAN-1';
-- EXPECT: 1 | 2 | t   (the payable URL is retained for reconciliation)

-- ===========================================================================
-- 13. CONCURRENCY. Run this block from TWO psql sessions simultaneously
--     against the same order; one must get 'credited', the other
--     'already_processed', and exactly one ledger row may exist.
--
--     Serialization comes from pg_advisory_xact_lock + SELECT ... FOR UPDATE
--     inside the function, so no explicit locking is needed here.
-- ===========================================================================
-- Session A and B both run:
--   select public.process_square_payment('REH-ORDER-CONCURRENT', 'REH-PAY-C', 1500, 'USD', 'LG8FD2SPNNAVX', null);
-- Then verify:
--   select count(*) from public.credit_ledger
--    where square_order_id = 'REH-ORDER-CONCURRENT' and reason = 'purchase';
--   -- EXPECT: 1

-- ===========================================================================
-- CLEANUP. Order matters: ledger and payments reference the user and tier.
-- ===========================================================================
begin;
delete from public.credit_ledger where user_id = '99999999-9999-9999-9999-999999999999';
delete from public.square_payments where user_id = '99999999-9999-9999-9999-999999999999';
delete from public.square_webhook_dead_letter where square_event_id like 'REH-%';
delete from public.square_orphaned_links where square_order_id like 'REH-%';
delete from public.session_tiers where id = '88888888-8888-8888-8888-888888888888';
delete from auth.users where id = '99999999-9999-9999-9999-999999999999';
commit;

select 'cleanup' as test,
       (select count(*) from public.square_payments where square_order_id like 'REH-%') as payments_left,
       (select count(*) from public.credit_ledger where square_order_id like 'REH-%') as ledger_left;
-- EXPECT: 0 | 0
