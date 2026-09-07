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
-- SELF-CONTAINED. An earlier version of this file only *described* restoring
-- the Stage 2B function in a comment, told the operator to re-run the Stage 2B
-- migration afterwards, and then dropped the two Stage 2C columns anyway. That
-- was wrong twice over: the claim that the columns were "dropped only after
-- the function has been restored" was false, so running this file as written
-- left the Stage 2C function installed and referencing columns that no longer
-- existed — every refund would then fail. This version executes the function
-- restore itself, and no longer drops the columns at all (see below).
--
-- The inlined Stage 2B function below is a byte-identical copy of the
-- definition in 20260907140000_square_refund_support.sql, which remains the
-- canonical source. Drift is not left to reviewer diligence: it is asserted by
-- api/__tests__/square-refund-rollback-fidelity.test.js, which extracts both
-- definitions and fails if they differ by a single character.
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
-- The guards below refuse to proceed when any exists, because reverting the
-- function would strand those orders in a state the older code cannot reason
-- about. Resolve them first — or keep Stage 2C.
--
-- Credits already removed are NOT restored. A claw-back that Stage 2C
-- performed correctly is a real, correct ledger entry; reversing it would
-- hand credits back to a customer who has had their money returned. If a
-- specific claw-back was wrong, correct that order deliberately rather than
-- through a schema rollback.
--
-- WHAT THIS DELIBERATELY DOES NOT REMOVE
--
-- cumulative_refunded_cents and purchase_amount_cents stay. They are nullable,
-- additive, and unreferenced by the Stage 2B function, so leaving them costs
-- nothing — while dropping them would destroy the only record of what each
-- refund's cumulative position and purchase price were when it was decided.
-- That evidence is exactly what a human needs in order to reconcile the orders
-- this rollback is being run because of. Reversing a code decision must not
-- delete the audit trail of decisions already made.
--
-- The same reasoning keeps ix_square_refunds_open_reconciliation: it indexes
-- the requires_review queue, which Stage 2B also writes to.
--
-- A guarded, explicitly opt-in block for removing the columns is at the end of
-- this file. It refuses to run while any recorded refund holds a value in
-- them.
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
-- Restore Stage 2B's function. Executed here, not described.
--
-- Byte-identical to 20260907140000_square_refund_support.sql. It keeps the
-- two-advisory-lock discipline (order lock, then the per-user lock that
-- complete_session_and_consume_entitlement uses) because that fix is not
-- Stage 2C-specific: without it a refund and a session completion can both
-- spend the same final credit. A rollback must not reintroduce a way to drive
-- a customer's balance negative.
-- ---------------------------------------------------------------------------
create or replace function public.process_square_refund(
  p_square_refund_id text,
  p_square_payment_id text,
  p_refund_status text,
  p_amount_cents integer,
  p_currency text,
  p_square_order_id text default null,
  p_location_id text default null,
  p_refund_summary jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_refund_id text;
  v_payment_id text;
  v_order_id text;
  v_status text;
  v_pay record;
  v_prior record;
  v_purchase record;
  v_balance integer;
  v_debits_after integer;
  v_other_sources integer;
  v_grant integer;
  v_unused integer;
  v_remove integer;
  v_basis text;
  v_result text;
  v_requires_review boolean := false;
  v_ledger_id bigint;
  v_is_full boolean;
  v_evidence jsonb;
  v_duplicate boolean := false;
begin
  -- ---- Argument sanity. Cheap, write-free rejections.
  if p_square_refund_id is null or btrim(p_square_refund_id) = '' then
    return jsonb_build_object('ok', false, 'result', 'invalid_refund_id');
  end if;
  if p_square_payment_id is null or btrim(p_square_payment_id) = '' then
    return jsonb_build_object('ok', false, 'result', 'invalid_payment_id');
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    return jsonb_build_object('ok', false, 'result', 'invalid_amount');
  end if;
  if p_currency is null or btrim(p_currency) = '' then
    return jsonb_build_object('ok', false, 'result', 'invalid_currency');
  end if;
  if p_refund_status is null or btrim(p_refund_status) = '' then
    return jsonb_build_object('ok', false, 'result', 'invalid_refund_status');
  end if;

  v_refund_id := btrim(p_square_refund_id);
  v_payment_id := btrim(p_square_payment_id);
  v_status := upper(btrim(p_refund_status));

  -- ---- Resolve the order id. The refund object normally carries it, but it
  -- is the advisory-lock key, so when absent it must be resolved from the
  -- payment id BEFORE the lock is taken.
  if p_square_order_id is not null and btrim(p_square_order_id) <> '' then
    v_order_id := btrim(p_square_order_id);
  else
    select square_order_id into v_order_id
    from public.square_payments
    where square_payment_id = v_payment_id
    limit 1;

    if v_order_id is null then
      return jsonb_build_object('ok', false, 'result', 'unmatched_payment');
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtext(v_order_id));

  select id, user_id, tier_id, status, amount_cents, currency, session_count,
         square_location_id, square_payment_id
  into v_pay
  from public.square_payments
  where square_order_id = v_order_id
  for update;

  if not found then
    -- Real money moved for an order we have no record of. Never discard it.
    return jsonb_build_object('ok', false, 'result', 'unmatched_payment');
  end if;

  -- ---- Second lock: the USER. Same key as
  -- complete_session_and_consume_entitlement, which is the other writer of
  -- this user's credit_ledger rows and serializes on the user, not the order.
  -- Without this, a refund and a session completion can both observe the same
  -- final credit and both spend it, leaving the balance negative. Taken here,
  -- after the order lock, so the acquisition order is globally consistent —
  -- see the lock-ordering analysis in the header.
  perform pg_advisory_xact_lock(hashtext(v_pay.user_id::text));

  -- ---- Replay / transition handling, under the lock.
  select id, square_order_id, amount_cents, currency, refund_status, result_code,
         credits_removed, attribution_basis
  into v_prior
  from public.square_refunds
  where square_refund_id = v_refund_id;

  if found then
    -- A pre-existing row is only a safe replay if it describes the same
    -- refund. Anything else means one refund id is being reused for different
    -- money, which a human must look at.
    if v_prior.square_order_id <> v_order_id
       or v_prior.amount_cents <> p_amount_cents
       or upper(btrim(v_prior.currency)) <> upper(btrim(p_currency)) then
      return jsonb_build_object(
        'ok', false, 'result', 'conflict_refund_mismatch',
        'existing_refund_row', v_prior.id
      );
    end if;

    -- Terminal decisions are never revisited: a second delivery of a refund
    -- that already produced (or deliberately withheld) a claw-back must not
    -- produce another one.
    if v_prior.result_code in ('credits_removed', 'no_credits_to_remove', 'ambiguous_attribution', 'recorded_partial') then
      update public.square_refunds
      set attempt_count = attempt_count + 1,
          last_seen_at = now(),
          refund_status = v_status
      where id = v_prior.id;

      return jsonb_build_object(
        'ok', true, 'result', 'already_processed',
        'prior_result', v_prior.result_code,
        'credits_removed', v_prior.credits_removed,
        'attribution_basis', v_prior.attribution_basis
      );
    end if;
    -- Otherwise the prior row was a non-terminal record (PENDING seen first).
    -- Fall through so a COMPLETED transition is processed exactly once.
  end if;

  -- ---- Validate the refund against the server-created purchase row.
  if v_pay.square_payment_id is not null
     and btrim(v_pay.square_payment_id) <> v_payment_id then
    return jsonb_build_object('ok', false, 'result', 'conflict_payment_id');
  end if;

  if v_pay.currency is not null
     and upper(btrim(v_pay.currency)) <> upper(btrim(p_currency)) then
    return jsonb_build_object(
      'ok', false, 'result', 'currency_mismatch',
      'expected_currency', upper(btrim(v_pay.currency)),
      'reported_currency', upper(btrim(p_currency))
    );
  end if;

  if v_pay.square_location_id is not null
     and p_location_id is not null
     and btrim(v_pay.square_location_id) <> btrim(p_location_id) then
    return jsonb_build_object('ok', false, 'result', 'location_mismatch');
  end if;

  if p_amount_cents > v_pay.amount_cents then
    return jsonb_build_object(
      'ok', false, 'result', 'conflict_amount',
      'purchase_cents', v_pay.amount_cents, 'refund_cents', p_amount_cents
    );
  end if;

  -- 'full refund' is measured against our own snapshot, never against
  -- Square-reported totals.
  v_is_full := (p_amount_cents = v_pay.amount_cents);

  -- A refund against a payment that never reached 'paid' means money was
  -- returned for something that was never credited. No credit change is
  -- possible, and the state is odd enough to stop on.
  if v_pay.status in ('pending', 'failed') then
    return jsonb_build_object(
      'ok', false, 'result', 'conflict_not_credited', 'payment_status', v_pay.status
    );
  end if;

  -- ---- Decide the outcome.
  if v_status <> 'COMPLETED' then
    -- PENDING / REJECTED / FAILED: record the transition, touch no credits.
    v_result := 'recorded_not_completed';
    v_requires_review := false;
    v_remove := 0;
  elsif not v_is_full then
    -- Policy authorises removal only for a completed FULL refund.
    v_result := 'recorded_partial';
    v_requires_review := true;
    v_remove := 0;
  else
    -- Completed full refund. Attribution time.
    select id, delta
    into v_purchase
    from public.credit_ledger
    where square_order_id = v_order_id
      and reason = 'purchase'
    limit 1;

    select coalesce(sum(delta), 0) into v_balance
    from public.credit_ledger
    where user_id = v_pay.user_id;

    -- Tested on v_purchase.id rather than FOUND: the aggregate above always
    -- finds a row, so FOUND no longer reflects the purchase lookup.
    if v_purchase.id is null then
      -- Nothing was ever credited for this order, so nothing is attributable.
      v_basis := 'no_credit_granted';
      v_grant := 0;
      v_debits_after := 0;
      v_other_sources := 0;
      v_unused := 0;
      v_remove := 0;
      v_result := 'no_credits_to_remove';
      -- Money refunded for an uncredited purchase is worth a human glance.
      v_requires_review := true;
    else
      v_grant := v_purchase.delta;

      -- Debits recorded after the purchase row. id ordering (bigserial) is
      -- used rather than created_at, which can tie for rows written in the
      -- same transaction.
      select coalesce(sum(-delta), 0) into v_debits_after
      from public.credit_ledger
      where user_id = v_pay.user_id
        and delta < 0
        and id > v_purchase.id;

      -- Any other credit source ever granted to this user: another purchase,
      -- an admin grant. Its existence is what can make attribution ambiguous.
      select count(*) into v_other_sources
      from public.credit_ledger
      where user_id = v_pay.user_id
        and delta > 0
        and id <> v_purchase.id;

      if v_debits_after = 0 then
        -- Nothing was spent after this purchase, so none of its credits were.
        v_basis := 'unused';
        v_unused := v_grant;
      elsif v_other_sources = 0 then
        -- This purchase is the user's only credit source ever, so every debit
        -- drew from it and the remaining balance IS its unused remainder.
        v_basis := 'sole_source';
        v_unused := v_balance;
      else
        -- Not provably decidable. Record it, change nothing.
        v_basis := 'ambiguous';
        v_unused := 0;
      end if;

      -- Clamp into [0, grant] and then to the live balance, so a claw-back can
      -- never exceed what the purchase granted nor drive the balance negative.
      v_unused := greatest(0, least(v_unused, v_grant));
      v_remove := greatest(0, least(v_unused, v_balance));

      if v_basis = 'ambiguous' then
        v_result := 'ambiguous_attribution';
        v_requires_review := true;
        v_remove := 0;
      elsif v_remove > 0 then
        v_result := 'credits_removed';
      else
        v_result := 'no_credits_to_remove';
      end if;
    end if;

    v_evidence := jsonb_build_object(
      'grant', v_grant,
      'balance_before', v_balance,
      'debits_after_purchase', v_debits_after,
      'other_positive_sources', v_other_sources,
      'unused_attributable', v_unused,
      'credits_removed', v_remove,
      'balance_after', v_balance - v_remove
    );
  end if;

  -- ---- Writes. Everything from here commits together or not at all.
  --
  -- The ledger insert comes FIRST so that if the unique backstop fires, no
  -- other write has happened yet.
  if v_remove > 0 then
    begin
      insert into public.credit_ledger (user_id, delta, reason, tier_id, square_order_id)
      values (v_pay.user_id, -v_remove, 'refund', v_pay.tier_id, v_order_id)
      returning id into v_ledger_id;
    exception
      when unique_violation then
        v_duplicate := true;
    end;

    if v_duplicate then
      -- A concurrent delivery clawed back first. Report its work rather than
      -- removing a second time.
      select id, credits_removed, result_code, attribution_basis
      into v_prior
      from public.square_refunds
      where square_order_id = v_order_id
        and credits_removed > 0
      limit 1;

      if not found then
        return jsonb_build_object('ok', false, 'result', 'retry_needed');
      end if;

      return jsonb_build_object(
        'ok', true, 'result', 'already_processed',
        'prior_result', v_prior.result_code,
        'credits_removed', v_prior.credits_removed,
        'attribution_basis', v_prior.attribution_basis
      );
    end if;
  end if;

  insert into public.square_refunds (
    square_refund_id, square_payment_id, square_order_id, user_id, refund_status,
    amount_cents, currency, square_location_id, is_full_refund, result_code,
    attribution_basis, credits_removed, credit_ledger_id, attribution_evidence,
    requires_review, refund_summary
  )
  values (
    v_refund_id, v_payment_id, v_order_id, v_pay.user_id, v_status,
    p_amount_cents, upper(btrim(p_currency)), p_location_id, v_is_full, v_result,
    v_basis, coalesce(v_remove, 0), v_ledger_id, v_evidence,
    v_requires_review, p_refund_summary
  )
  on conflict (square_refund_id) do update
    set refund_status = excluded.refund_status,
        result_code = excluded.result_code,
        attribution_basis = excluded.attribution_basis,
        credits_removed = excluded.credits_removed,
        credit_ledger_id = coalesce(excluded.credit_ledger_id, public.square_refunds.credit_ledger_id),
        attribution_evidence = coalesce(excluded.attribution_evidence, public.square_refunds.attribution_evidence),
        requires_review = excluded.requires_review,
        refund_summary = coalesce(excluded.refund_summary, public.square_refunds.refund_summary),
        is_full_refund = excluded.is_full_refund,
        attempt_count = public.square_refunds.attempt_count + 1,
        last_seen_at = now();

  -- The payment is marked refunded only once the refund is COMPLETED and
  -- covers the whole purchase. This also closes the purchase path: Stage 2A's
  -- process_square_payment treats status 'refunded' as conflict_status, so a
  -- replayed payment webhook can no longer re-credit a refunded purchase.
  if v_status = 'COMPLETED' and v_is_full then
    update public.square_payments
    set status = 'refunded',
        updated_at = now()
    where id = v_pay.id;
  end if;

  return jsonb_build_object(
    'ok', true, 'result', v_result,
    'credits_removed', coalesce(v_remove, 0),
    'attribution_basis', v_basis,
    'requires_review', v_requires_review,
    'evidence', v_evidence
  );
exception
  when unique_violation then
    -- Any other constraint violation rolls back every write this call made
    -- rather than reporting a false success.
    return jsonb_build_object('ok', false, 'result', 'retry_needed');
end;
$function$;

-- CREATE OR REPLACE preserves the existing ACL, so these are belt-and-braces
-- rather than strictly required — but a rollback is exactly the situation in
-- which nobody should be relying on an assumption about privileges.
revoke all on function public.process_square_refund(text, text, text, integer, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.process_square_refund(text, text, text, integer, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- Restore Stage 2B's narrower reading of the column comment.
-- ---------------------------------------------------------------------------
comment on column public.square_refunds.is_full_refund is
  'Stage 2B: true when this refund''s amount equalled the purchase price.';

-- ---------------------------------------------------------------------------
-- Verification. Expect: 1 function, which is Stage 2B's (no cumulative
-- arithmetic), the two reconciliation columns still PRESENT, and the Stage 2B
-- table and indexes intact.
-- ---------------------------------------------------------------------------
do $$
declare
  v_src text;
begin
  select prosrc into v_src
  from pg_proc where proname = 'process_square_refund';

  if v_src is null then
    raise exception 'Rollback verification failed: process_square_refund is absent.';
  end if;

  -- The restored function must not reference the Stage 2C columns, or it would
  -- be the Stage 2C function still installed under a rollback that claims
  -- otherwise.
  if position('cumulative_refunded_cents' in v_src) > 0 then
    raise exception
      'Rollback verification failed: the installed process_square_refund still contains Stage 2C cumulative logic. The restore above did not take effect.';
  end if;

  -- The Stage 2B function must still take the per-user lock.
  if position('hashtext(v_pay.user_id::text)' in v_src) = 0 then
    raise exception
      'Rollback verification failed: the restored function does not take the per-user advisory lock, so a refund could race session completion.';
  end if;

  raise notice 'Rollback verified: Stage 2B function restored, per-user lock intact, reconciliation columns preserved.';
end $$;

select 'process_square_refund' as object, count(*)::text as value
from pg_proc where proname = 'process_square_refund'
union all
select 'stage2c columns PRESERVED (expect 2)', count(*)::text
from information_schema.columns
where table_schema = 'public' and table_name = 'square_refunds'
  and column_name in ('cumulative_refunded_cents', 'purchase_amount_cents')
union all
select 'reconciliation index (kept)', count(*)::text
from pg_indexes where indexname = 'ix_square_refunds_open_reconciliation'
union all
select 'refund rows carrying evidence', count(*)::text
from public.square_refunds
where cumulative_refunded_cents is not null or purchase_amount_cents is not null
union all
select 'square_refunds table (kept)', coalesce(to_regclass('public.square_refunds')::text, 'ABSENT')
union all
select 'ledger refund uniq index (kept)', count(*)::text
from pg_indexes where indexname = 'uq_credit_ledger_refund_square_order';

-- ---------------------------------------------------------------------------
-- OPTIONAL AND DESTRUCTIVE. Not part of the rollback above.
--
-- Only for returning a database to a pristine pre-Stage-2C shape — a rehearsal
-- branch, or a production database where no refund was ever recorded. It
-- refuses while any refund row still carries reconciliation evidence, because
-- dropping the columns would delete it irrecoverably.
--
-- Uncomment deliberately, and only after reading the count reported above.
-- ---------------------------------------------------------------------------
-- do $$
-- declare
--   v_rows integer;
-- begin
--   select count(*) into v_rows
--   from public.square_refunds
--   where cumulative_refunded_cents is not null
--      or purchase_amount_cents is not null;
--
--   if v_rows > 0 then
--     raise exception
--       'Refusing to drop the Stage 2C reconciliation columns: % refund row(s) carry cumulative_refunded_cents / purchase_amount_cents. Dropping them would destroy the record of how those refunds were decided. Export that evidence first if it is genuinely no longer needed.',
--       v_rows;
--   end if;
--
--   drop index if exists public.ix_square_refunds_open_reconciliation;
--   alter table public.square_refunds drop column if exists cumulative_refunded_cents;
--   alter table public.square_refunds drop column if exists purchase_amount_cents;
--
--   raise notice 'Stage 2C columns dropped: no refund row carried evidence.';
-- end $$;
