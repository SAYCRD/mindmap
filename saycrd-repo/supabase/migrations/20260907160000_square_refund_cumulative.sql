-- ---------------------------------------------------------------------------
-- Stage 2C: cumulative refund accounting.
--
-- Stage 2B decided "is this a full refund?" from a SINGLE refund's amount:
--
--     v_is_full := (p_amount_cents = v_pay.amount_cents);
--
-- That is wrong as soon as a merchant refunds in instalments. Two 1200-cent
-- refunds against a 2400-cent purchase each looked partial, so:
--
--   * unused credits were never removed even though the customer had been
--     made whole in full, and
--   * square_payments.status never became 'refunded', which left Stage 2A's
--     replay protection open — process_square_payment only reports
--     conflict_status for a payment already marked refunded, so a replayed
--     payment.updated could still re-credit the purchase.
--
-- Stage 2C measures refunds against the ORDER, not the event: the full-refund
-- policy fires when the cumulative COMPLETED refunded amount for the order
-- reaches the purchase total, whether that happens in one event or five.
--
-- Three properties carry the design.
--
-- 1. THE CUMULATIVE SUM EXCLUDES THE REFUND BEING PROCESSED.
--    It sums prior COMPLETED refunds with square_refund_id <> the current one,
--    then adds the current amount. So the total is a pure function of
--    (order, set of completed refunds) and does NOT depend on whether this
--    refund's own row already exists. Recomputing after a redelivery yields
--    the same number, which is what makes replay convergence structural
--    rather than a happy accident of ordering.
--
-- 2. SUMMING CENTS IS ONLY VALID BECAUSE CURRENCY IS ALREADY PINNED.
--    Every refund is rejected with currency_mismatch unless it matches the
--    purchase row's currency, so all COMPLETED refunds for an order are
--    necessarily in one unit and the sum is meaningful. The currency guard is
--    load-bearing for this arithmetic, not merely defensive.
--
-- 3. refund_status NEVER REGRESSES FROM 'COMPLETED'.
--    The cumulative sum reads that column, so allowing a redelivery carrying
--    a stale PENDING to overwrite a COMPLETED row would silently shrink the
--    total and could un-do a full refund. Both update paths now clamp it.
--
-- Exactly-once for the claw-back is enforced at three levels, unchanged in
-- kind from Stage 2B but now spanning multiple events:
--   (a) pg_advisory_xact_lock(hashtext(order_id)) + SELECT ... FOR UPDATE
--       serialize all refunds for one order, so only one delivery can be the
--       one that crosses the threshold;
--   (b) terminal result codes short-circuit any redelivery of an already
--       decided refund id;
--   (c) uq_credit_ledger_refund_square_order permits at most one refund
--       ledger row per order, whatever happens above it.
--
-- Over-refunds are RECORDED AND FLAGGED rather than acted on. A cumulative
-- total above the purchase price cannot arise from Square operating normally
-- (Square itself refuses to refund more than a payment), so it indicates
-- corrupt or mis-associated data. Removing credits on the strength of a total
-- we already know is impossible would be acting on evidence we have just
-- proved unreliable, so the row is written with requires_review and the
-- credit balance is left alone.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Reconciliation columns.
--
-- Both are snapshots taken under the lock at decision time. They let a human
-- reconstruct why a given event was treated as partial or full without
-- replaying the whole refund history.
-- ---------------------------------------------------------------------------
alter table public.square_refunds
  add column if not exists cumulative_refunded_cents integer;

alter table public.square_refunds
  add column if not exists purchase_amount_cents integer;

comment on column public.square_refunds.cumulative_refunded_cents is
  'Stage 2C: total COMPLETED refunded cents for this order including this refund, as computed under the advisory lock when this row was last decided. Basis for the partial/full determination.';

comment on column public.square_refunds.purchase_amount_cents is
  'Stage 2C: amount_cents of the square_payments row this refund was measured against. Snapshotted so later edits cannot change how a past decision reads.';

-- Stage 2B read this as "this one refund equalled the purchase price". Stage
-- 2C redefines it at the ORDER level, which is the only reading that survives
-- instalment refunds.
comment on column public.square_refunds.is_full_refund is
  'Stage 2C: true when the order''s cumulative COMPLETED refunded total had reached the purchase price as of this event. Not a statement about this refund''s own amount — an instalment that completes the total sets it true, and a still-pending refund arriving after the total was already reached also reports true because it describes the order.';

-- Reconciliation queue: partial and flagged refunds, newest first. Partials
-- are the rows an operator must chase, because they are the ones holding
-- money back without a credit consequence.
create index if not exists ix_square_refunds_open_reconciliation
  on public.square_refunds (square_order_id, last_seen_at desc)
  where requires_review;

comment on index public.ix_square_refunds_open_reconciliation is
  'Stage 2C: supports the reconciliation queue over partial, ambiguous and over-refund rows.';

-- ---------------------------------------------------------------------------
-- 2. process_square_refund, cumulative.
--
-- Signature unchanged, so the webhook keeps calling it identically and this
-- migration is a pure behaviour replacement.
--
-- Result codes: credits_removed | no_credits_to_remove | ambiguous_attribution
--   | recorded_partial | recorded_not_completed | already_processed
--   | conflict_over_refund | unmatched_payment | conflict_amount
--   | conflict_payment_id | conflict_refund_mismatch | conflict_not_credited
--   | currency_mismatch | location_mismatch | retry_needed | invalid_*
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
  v_is_full boolean := false;
  v_evidence jsonb;
  v_duplicate boolean := false;
  -- Stage 2C
  v_prior_completed integer := 0;
  v_prior_refund_count integer := 0;
  v_cumulative integer := 0;
  v_over boolean := false;
  v_ok boolean := true;
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

  -- ---- Replay / transition handling, under the lock.
  select id, square_order_id, amount_cents, currency, refund_status, result_code,
         credits_removed, attribution_basis, cumulative_refunded_cents
  into v_prior
  from public.square_refunds
  where square_refund_id = v_refund_id;

  if found then
    -- A pre-existing row is only a safe replay if it describes the same
    -- refund. Anything else means one refund id is being reused for different
    -- money, which a human must look at. This is also what rejects an
    -- unrelated refund id colliding with an order it does not belong to.
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
    -- produce another one. recorded_partial is terminal for the refund ID,
    -- not for the order — a LATER, DIFFERENT refund id can still push the
    -- cumulative total to full and trigger the claw-back. What this prevents
    -- is a redelivery of an already-counted partial being counted twice.
    if v_prior.result_code in ('credits_removed', 'no_credits_to_remove',
                               'ambiguous_attribution', 'recorded_partial') then
      update public.square_refunds
      set attempt_count = attempt_count + 1,
          last_seen_at = now(),
          -- Never regress a COMPLETED refund: the cumulative sum reads this
          -- column, so a stale PENDING redelivery must not shrink the total.
          -- Unqualified on the right-hand side, which reads the stored value.
          refund_status = case
            when refund_status = 'COMPLETED' then 'COMPLETED'
            else v_status
          end
      where id = v_prior.id;

      return jsonb_build_object(
        'ok', true, 'result', 'already_processed',
        'prior_result', v_prior.result_code,
        'credits_removed', v_prior.credits_removed,
        'attribution_basis', v_prior.attribution_basis,
        'cumulative_refunded_cents', v_prior.cumulative_refunded_cents,
        'purchase_amount_cents', v_pay.amount_cents
      );
    end if;
    -- Otherwise the prior row was a non-terminal record (PENDING seen first,
    -- or a flagged over-refund awaiting data repair). Fall through so the
    -- decision is recomputed from the current facts.
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

  -- A SINGLE refund larger than the whole purchase is malformed on its face,
  -- independently of history. Rejected before any write, as in Stage 2B.
  -- (Cumulative excess is a different finding and is handled below, because
  -- each contributing event is individually plausible.)
  if p_amount_cents > v_pay.amount_cents then
    return jsonb_build_object(
      'ok', false, 'result', 'conflict_amount',
      'purchase_cents', v_pay.amount_cents, 'refund_cents', p_amount_cents
    );
  end if;

  -- A refund against a payment that never reached 'paid' means money was
  -- returned for something that was never credited. No credit change is
  -- possible, and the state is odd enough to stop on.
  if v_pay.status in ('pending', 'failed') then
    return jsonb_build_object(
      'ok', false, 'result', 'conflict_not_credited', 'payment_status', v_pay.status
    );
  end if;

  -- ---- Cumulative accounting. Self-excluding, so this is a pure function of
  -- the order's completed-refund set and is therefore replay-stable.
  select coalesce(sum(amount_cents), 0), count(*)
  into v_prior_completed, v_prior_refund_count
  from public.square_refunds
  where square_order_id = v_order_id
    and refund_status = 'COMPLETED'
    and square_refund_id <> v_refund_id;

  if v_status = 'COMPLETED' then
    v_cumulative := v_prior_completed + p_amount_cents;
  else
    -- A non-completed refund contributes nothing; the total still reflects
    -- whatever has actually completed so far.
    v_cumulative := v_prior_completed;
  end if;

  v_over := (v_cumulative > v_pay.amount_cents);
  v_is_full := (v_cumulative = v_pay.amount_cents);

  -- ---- Decide the outcome.
  if v_status <> 'COMPLETED' then
    -- PENDING / REJECTED / FAILED: record the transition, touch no credits.
    v_result := 'recorded_not_completed';
    v_requires_review := false;
    v_remove := 0;
  elsif v_over then
    -- Impossible under normal Square operation, so the inputs are suspect.
    -- Preserve the event, flag it, change no credits.
    v_result := 'conflict_over_refund';
    v_requires_review := true;
    v_remove := 0;
    v_ok := false;
  elsif not v_is_full then
    -- Cumulative total is still short of the purchase price. Policy
    -- authorises removal only once the customer has been made whole, so this
    -- is preserved for reconciliation and nothing is clawed back. A later
    -- refund on the same order may complete the total and trigger removal.
    v_result := 'recorded_partial';
    v_requires_review := true;
    v_remove := 0;
  else
    -- Cumulative total now equals the purchase price. Attribution time. This
    -- branch can be reached by exactly one refund delivery per order: the
    -- advisory lock serializes contenders, the terminal codes above absorb
    -- redeliveries, and the unique ledger index is the final backstop.
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
  end if;

  -- Evidence is recorded for every outcome, not just the full-refund path, so
  -- a partial or flagged row explains itself during reconciliation.
  v_evidence := jsonb_build_object(
    'purchase_cents', v_pay.amount_cents,
    'this_refund_cents', p_amount_cents,
    'prior_completed_cents', v_prior_completed,
    'prior_completed_refunds', v_prior_refund_count,
    'cumulative_refunded_cents', v_cumulative,
    'remaining_cents', greatest(0, v_pay.amount_cents - v_cumulative),
    'is_full_refund', v_is_full,
    'over_refund', v_over,
    'grant', v_grant,
    'balance_before', v_balance,
    'debits_after_purchase', v_debits_after,
    'other_positive_sources', v_other_sources,
    'unused_attributable', v_unused,
    'credits_removed', coalesce(v_remove, 0),
    'balance_after', case when v_balance is null then null
                          else v_balance - coalesce(v_remove, 0) end
  );

  -- ---- Writes. Everything from here commits together or not at all.
  --
  -- The ledger insert comes FIRST so that if the unique backstop fires, no
  -- other write has happened yet.
  if coalesce(v_remove, 0) > 0 then
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
        'attribution_basis', v_prior.attribution_basis,
        'cumulative_refunded_cents', v_cumulative,
        'purchase_amount_cents', v_pay.amount_cents
      );
    end if;
  end if;

  insert into public.square_refunds (
    square_refund_id, square_payment_id, square_order_id, user_id, refund_status,
    amount_cents, currency, square_location_id, is_full_refund, result_code,
    attribution_basis, credits_removed, credit_ledger_id, attribution_evidence,
    requires_review, refund_summary, cumulative_refunded_cents, purchase_amount_cents
  )
  values (
    v_refund_id, v_payment_id, v_order_id, v_pay.user_id, v_status,
    p_amount_cents, upper(btrim(p_currency)), p_location_id, v_is_full, v_result,
    v_basis, coalesce(v_remove, 0), v_ledger_id, v_evidence,
    v_requires_review, p_refund_summary, v_cumulative, v_pay.amount_cents
  )
  on conflict (square_refund_id) do update
    set refund_status = case
          when public.square_refunds.refund_status = 'COMPLETED' then 'COMPLETED'
          else excluded.refund_status
        end,
        result_code = excluded.result_code,
        attribution_basis = excluded.attribution_basis,
        credits_removed = excluded.credits_removed,
        credit_ledger_id = coalesce(excluded.credit_ledger_id, public.square_refunds.credit_ledger_id),
        attribution_evidence = coalesce(excluded.attribution_evidence, public.square_refunds.attribution_evidence),
        requires_review = excluded.requires_review,
        refund_summary = coalesce(excluded.refund_summary, public.square_refunds.refund_summary),
        is_full_refund = excluded.is_full_refund,
        cumulative_refunded_cents = excluded.cumulative_refunded_cents,
        purchase_amount_cents = excluded.purchase_amount_cents,
        attempt_count = public.square_refunds.attempt_count + 1,
        last_seen_at = now();

  -- The payment is marked refunded only once the CUMULATIVE completed total
  -- covers the whole purchase. This also closes the purchase path: Stage 2A's
  -- process_square_payment treats status 'refunded' as conflict_status, so a
  -- replayed payment webhook can no longer re-credit a fully refunded
  -- purchase. Stage 2B only reached this for single-event full refunds, which
  -- left instalment refunds re-creditable.
  if v_status = 'COMPLETED' and v_is_full then
    update public.square_payments
    set status = 'refunded',
        updated_at = now()
    where id = v_pay.id;
  end if;

  return jsonb_build_object(
    'ok', v_ok, 'result', v_result,
    'credits_removed', coalesce(v_remove, 0),
    'attribution_basis', v_basis,
    'requires_review', v_requires_review,
    'cumulative_refunded_cents', v_cumulative,
    'purchase_amount_cents', v_pay.amount_cents,
    'remaining_cents', greatest(0, v_pay.amount_cents - v_cumulative),
    'is_full_refund', v_is_full,
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
  'Stage 2C-owned. The ONLY place a Square refund removes credits. Measures refunds cumulatively per ORDER: removes unused credits provably attributable to the purchase only once the cumulative COMPLETED refunded amount equals the purchase total, whether reached in one event or several, and exactly once. Partial refunds are preserved with requires_review and change no credits. Cumulative totals exceeding the purchase are recorded as conflict_over_refund and change no credits. The cumulative sum excludes the refund being processed, so redelivered events converge on the same result. Never reverses sessions or reports, never touches unrelated credits, never drives the balance negative.';

revoke all on function public.process_square_refund(text, text, text, integer, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.process_square_refund(text, text, text, integer, text, text, text, jsonb) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Backfill the reconciliation snapshots for any pre-existing rows.
--
-- Production has none (square_refunds is empty and Stage 2B is unapplied
-- there), so this is a no-op in practice. It exists so an environment that
-- did run Stage 2B is not left with NULL snapshots that read as "unknown".
--
-- Ordering by id reproduces the sequence the rows were decided in, and the
-- running total counts only COMPLETED refunds — the same basis the function
-- uses.
-- ---------------------------------------------------------------------------
with running as (
  select r.id,
         p.amount_cents as purchase_cents,
         sum(case when r.refund_status = 'COMPLETED' then r.amount_cents else 0 end)
           over (partition by r.square_order_id order by r.id
                 rows between unbounded preceding and current row) as cumulative
  from public.square_refunds r
  join public.square_payments p on p.square_order_id = r.square_order_id
)
update public.square_refunds r
set cumulative_refunded_cents = running.cumulative,
    purchase_amount_cents = running.purchase_cents
from running
where running.id = r.id
  and (r.cumulative_refunded_cents is null or r.purchase_amount_cents is null);
