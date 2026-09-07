-- Stage 2B (square-activation): refund support.
--
-- A completed FULL refund must claw back only the credits from that purchase
-- that are still unused. Everything else about the account is left alone:
-- completed sessions and their reports are never reversed, unrelated credits
-- are never touched, and the balance is never driven negative.
--
-- ---------------------------------------------------------------------------
-- WHY ATTRIBUTION IS THE HARD PART
-- ---------------------------------------------------------------------------
-- credit_ledger is a FUNGIBLE POOL, not a set of per-purchase buckets:
--
--   * a purchase inserts one row, delta = +session_count, carrying
--     square_order_id.
--   * a consumed session inserts delta = -1, reason 'session_complete', and
--     carries NO square_order_id (see complete_session_and_consume_entitlement).
--   * balance is sum(delta) over the user's rows (see api/credits.js).
--
-- So a debit does not record which purchase it drew from, and in general
-- "how many of THIS purchase's credits are unused" has no unique answer. With
-- two purchases of 5 and a single session consumed, the ledger is identical
-- whichever pack that session came from.
--
-- This migration therefore does not guess. It computes attribution only in
-- the configurations where exactly one answer is possible, and refuses —
-- recording a manual-review row and changing no credits — in every other
-- case. The four decidable cases:
--
--   no_credit_granted  no purchase credit exists for the order at all, so
--                      there is nothing attributable to remove. (A refund of
--                      a payment that was never credited.)
--
--   unused             no debit was recorded after the purchase row, so none
--                      of its credits can have been spent. Unused = the full
--                      grant. Holds no matter how many other credit sources
--                      exist, because the pool only shrinks on a debit.
--
--   sole_source        the purchase is the user's ONLY positive-delta row
--                      ever. Every debit necessarily drew from it, so
--                      unused = balance exactly. This is the case that
--                      covers partial use (balance between 1 and grant-1)
--                      and full use (balance 0, remove nothing).
--
--   ambiguous          debits exist after the purchase AND at least one other
--                      positive source exists. Which pool each debit drew
--                      from is not recoverable from the ledger. NO credit
--                      change; the square_refunds row is the review item.
--
-- The removal is additionally clamped to the live balance, so the balance can
-- never be driven below zero even if the two disagree.
--
-- ---------------------------------------------------------------------------
-- WHAT ARRIVES, AND FROM WHERE
-- ---------------------------------------------------------------------------
-- Square never sets a "REFUNDED" payment status; a refunded payment stays
-- COMPLETED and gains refunded_money / refund_ids. Authoritative refund
-- status lives on the PaymentRefund object (PENDING | COMPLETED | REJECTED |
-- FAILED). This function therefore takes the refund's own status and refuses
-- to remove credits unless it is COMPLETED. See api/square-webhook.js for how
-- that status is obtained under the current payment.updated-only subscription.
--
-- Everything below is idempotent: safe to apply twice.

-- ---------------------------------------------------------------------------
-- 1. Vocabulary the refund path needs.
--
-- Both of these CHECKs currently reject the values Stage 2B must write. Note
-- the first one is also a latent Stage 2A bug: process_square_payment already
-- branches on `v_pay.status in ('failed','refunded')`, but 'refunded' was not
-- a legal status, so that branch was unreachable.
-- ---------------------------------------------------------------------------
alter table public.square_payments drop constraint if exists square_payments_status_check;
alter table public.square_payments add constraint square_payments_status_check
  check (status in ('pending', 'paid', 'failed', 'refunded'));

alter table public.credit_ledger drop constraint if exists credit_ledger_reason_check;
alter table public.credit_ledger add constraint credit_ledger_reason_check
  check (reason in ('purchase', 'admin_grant', 'session_start', 'session_complete', 'refund'));

comment on constraint credit_ledger_reason_check on public.credit_ledger is
  'Stage 2B adds ''refund'': a single negative-delta row removing unused credits attributable to a refunded purchase, carrying that purchase''s square_order_id.';

-- ---------------------------------------------------------------------------
-- 2. Database-level idempotency backstop for the claw-back.
--
-- Mirrors uq_credit_ledger_purchase_square_order from Stage 2A: at most one
-- refund row per Square order, regardless of delivery timing. This is the
-- final safeguard beneath the advisory lock and row lock in
-- process_square_refund, not the primary mechanism.
-- ---------------------------------------------------------------------------
create unique index if not exists uq_credit_ledger_refund_square_order
  on public.credit_ledger (square_order_id)
  where reason = 'refund';

comment on index public.uq_credit_ledger_refund_square_order is
  'Stage 2B: at most one refund claw-back per Square order. Backstop against double-removal from a replayed or concurrent refund delivery.';

-- ---------------------------------------------------------------------------
-- 3. square_refunds — the reconciliation and manual-review record.
--
-- One row per Square refund id, UPSERTed, so a refund Square retries or
-- transitions (PENDING -> COMPLETED) updates one row instead of accumulating
-- duplicates.
--
-- Deliberately narrow. Square's refund and payment objects also carry buyer
-- identity, card fingerprints, billing address and processing fees; none of
-- that is needed to reconcile a claw-back, so none of it is stored (see
-- summarizeSquareRefund in api/square-webhook.js).
--
-- requires_review is what makes this table the review queue: an ambiguous
-- attribution, a partial refund, or a refund against a payment that was never
-- credited all land here with the credit decision left to a human.
-- ---------------------------------------------------------------------------
create table if not exists public.square_refunds (
  id bigserial primary key,
  square_refund_id text not null,
  square_payment_id text not null,
  square_order_id text not null,
  user_id uuid references auth.users (id) on delete set null,
  refund_status text not null,
  amount_cents integer not null,
  currency text not null,
  square_location_id text,
  is_full_refund boolean not null default false,
  result_code text not null,
  attribution_basis text,
  credits_removed integer not null default 0,
  credit_ledger_id bigint,
  attribution_evidence jsonb,
  requires_review boolean not null default false,
  refund_summary jsonb,
  attempt_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint square_refunds_refund_id_key unique (square_refund_id),
  constraint square_refunds_credits_removed_check check (credits_removed >= 0)
);

alter table public.square_refunds enable row level security;

comment on table public.square_refunds is
  'Stage 2B: one row per Square refund id. Records the refund, the attribution decision, and how many credits were removed. Rows with requires_review = true and resolved_at is null are OPEN ITEMS a human must adjudicate: ambiguous attribution, a partial refund, or a refund of a payment that was never credited. RLS enabled with no policies: reachable only by the service role.';
comment on column public.square_refunds.attribution_basis is
  'Which decidable case applied: no_credit_granted | unused | sole_source | ambiguous. Null when the refund was recorded without reaching attribution (not COMPLETED, partial, or a conflict).';
comment on column public.square_refunds.attribution_evidence is
  'The numbers the decision was made from (grant, balance_before, debits_after, other_positive_sources, balance_after). Kept so an ambiguous case can be adjudicated later without reconstructing history.';
comment on column public.square_refunds.credits_removed is
  'Credits actually removed by this refund. 0 whenever no automatic change was made, including every ambiguous case.';

create index if not exists idx_square_refunds_open_review
  on public.square_refunds (last_seen_at desc)
  where requires_review and resolved_at is null;

create index if not exists idx_square_refunds_order
  on public.square_refunds (square_order_id);

-- ---------------------------------------------------------------------------
-- 4. process_square_refund — the atomic core.
--
-- Contract (returns jsonb with 'ok' and 'result'):
--
--   credits_removed        completed full refund, attribution decided, claw-back
--                          committed: square_refunds row + credit_ledger refund
--                          row + square_payments -> refunded, all in one
--                          transaction.
--   no_credits_to_remove   completed full refund, attribution decided, but the
--                          removable count is zero (fully used, or nothing was
--                          ever credited). Refund recorded, payment -> refunded,
--                          NO ledger row.
--   ambiguous_attribution  completed full refund whose attribution is not
--                          provably decidable. Refund recorded with
--                          requires_review; NO credit change.
--   recorded_partial       completed refund for less than the full purchase
--                          amount. Policy authorises no automatic removal.
--                          Recorded with requires_review; NO credit change.
--   recorded_not_completed refund is PENDING / REJECTED / FAILED. Recorded so
--                          the transition is visible; NO credit change.
--   already_processed      this refund id has already been processed to a
--                          terminal decision. No second claw-back.
--   unmatched_payment      no square_payments row for this refund. NO WRITES.
--                          Caller must answer 503 so Square retries: a real
--                          refund awaiting correlation is never discarded.
--   conflict_payment_id    the payment row records a different Square payment
--                          id than the refund refers to. NO WRITES.
--   conflict_not_credited  the payment is still pending, i.e. money was
--                          refunded for something never credited. NO WRITES.
--   conflict_amount        refund amount exceeds the purchase amount. NO WRITES.
--   currency_mismatch      refund currency differs from the purchase snapshot.
--   location_mismatch      ditto for location. NO WRITES.
--   conflict_refund_mismatch  this refund id was already recorded against a
--                          different order/amount/currency. NO WRITES.
--   retry_needed           lost a concurrency race in a way a retry fixes.
--
-- Every non-success path leaves credits exactly as they were.
--
-- Concurrency: TWO advisory locks, always in this order — first
-- pg_advisory_xact_lock(hashtext(order_id)), the SAME key as
-- process_square_payment, so a refund and a payment for one order fully
-- serialize against each other and two concurrent refund deliveries serialize
-- too (the second observes the first's committed work and takes
-- already_processed); then pg_advisory_xact_lock(hashtext(user_id::text)), the
-- SAME key as complete_session_and_consume_entitlement, without which a refund
-- and a session completion can both spend the same last credit and drive the
-- balance negative. No caller ever takes the user lock before the order lock,
-- so the fixed order cannot deadlock. Full case analysis lives in the header
-- of 20260907160000_square_refund_cumulative.sql.
--
-- Validation is always against the server-created square_payments row, never
-- against refund metadata: the purchase amount, currency, location and
-- payment id all come from that row, and 'full refund' means equal to that
-- row's amount_cents.
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

comment on function public.process_square_refund(text, text, text, integer, text, text, text, jsonb) is
  'Stage 2B-owned. The ONLY place a Square refund removes credits. Removes only unused credits provably attributable to the refunded purchase, in one transaction with the square_refunds record and the square_payments status change. Never reverses sessions or reports, never touches unrelated credits, never drives the balance negative, and records a manual-review row instead of guessing when attribution is not decidable. Returns credits_removed | no_credits_to_remove | ambiguous_attribution | recorded_partial | recorded_not_completed | already_processed | unmatched_payment | conflict_* | currency_mismatch | location_mismatch | retry_needed.';

revoke all on function public.process_square_refund(text, text, text, integer, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.process_square_refund(text, text, text, integer, text, text, text, jsonb) to service_role;
