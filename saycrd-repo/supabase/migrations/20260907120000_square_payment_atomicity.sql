-- Stage 2A (square-activation): make processing a completed Square payment
-- atomic, idempotent and self-validating.
--
-- The defect this fixes: api/square-webhook.js used to (a) update
-- square_payments to paid and (b) insert the credit_ledger row as two
-- separate statements from application code. A crash, timeout or cold-start
-- kill between them left real money collected, the payment marked paid, and
-- NO entitlement granted — and because the replay guard keyed off that same
-- status, every subsequent retry of the event saw "already handled" and
-- skipped recovery. The purchased credits were then unrecoverable without
-- manual intervention.
--
-- (Both of those writes were also unconditionally rejected by existing CHECK
-- constraints — the code wrote status='completed' when only pending|paid|
-- failed are legal, and reason='square_purchase' when only purchase|
-- admin_grant|session_start|session_complete are legal — so the paid path
-- had in fact never once succeeded; square_payments and credit_ledger were
-- both empty. This migration keeps the constraints and moves the writes into
-- a function that uses their legal vocabulary.)
--
-- Everything below is idempotent: safe to apply twice.

-- ---------------------------------------------------------------------------
-- 1. Terms snapshot on the pending row.
--
-- The webhook previously re-read session_tiers at credit time, so an admin
-- editing a tier between purchase and webhook silently changed what the buyer
-- received. These columns record the terms as they were when the link was
-- created, and become the only thing the webhook validates against.
-- ---------------------------------------------------------------------------
alter table public.square_payments add column if not exists session_count integer;
alter table public.square_payments add column if not exists currency text;
alter table public.square_payments add column if not exists square_location_id text;

comment on column public.square_payments.session_count is
  'Stage 2A: credits this purchase grants, snapshotted from session_tiers.session_count when the payment link was created. The webhook grants exactly this many and never re-reads session_tiers, so a later tier edit cannot change a completed purchase.';
comment on column public.square_payments.currency is
  'Stage 2A: ISO currency snapshotted at link creation, validated against the currency Square reports on the completed payment.';
comment on column public.square_payments.square_location_id is
  'Stage 2A: the Square location the link was created against, validated against the location Square reports on the completed payment.';

-- ---------------------------------------------------------------------------
-- 2. Database-level idempotency backstop.
--
-- credit_ledger had only PRIMARY KEY (id); protection against double-credit
-- was purely a read-then-write check in application code, which two
-- concurrent webhook deliveries can interleave through. This index makes a
-- second purchase row for the same Square order impossible regardless of
-- timing. It is the final safeguard beneath the row lock in
-- process_square_payment, not the primary mechanism.
--
-- Partial (reason='purchase') so session_complete debits — which correctly
-- carry no order id — are unaffected. NULL order ids remain unconstrained.
-- ---------------------------------------------------------------------------
create unique index if not exists uq_credit_ledger_purchase_square_order
  on public.credit_ledger (square_order_id)
  where reason = 'purchase';

comment on index public.uq_credit_ledger_purchase_square_order is
  'Stage 2A: at most one purchase credit per Square order. Final backstop against double-crediting a replayed or concurrent webhook delivery.';

-- ---------------------------------------------------------------------------
-- 3. Dead-letter table for webhook events that could not be credited.
--
-- Keyed on Square's own event id and UPSERTed, so an event Square retries
-- (every 503 we return) updates one row and bumps attempt_count instead of
-- inserting an unbounded number of duplicates.
--
-- Stores only what is needed to investigate and reconcile: identifiers,
-- money, location and the failure. Square's payment object also carries
-- buyer identity, card fingerprints, billing address and risk evaluation;
-- none of that is needed here, so none of it is written (see
-- summarizeSquarePayment in api/square-webhook.js).
-- ---------------------------------------------------------------------------
create table if not exists public.square_webhook_dead_letter (
  id bigserial primary key,
  square_event_id text not null,
  event_type text,
  result_code text not null,
  http_status integer not null,
  square_order_id text,
  square_payment_id text,
  amount_cents integer,
  currency text,
  square_location_id text,
  payment_summary jsonb,
  attempt_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint square_webhook_dead_letter_event_id_key unique (square_event_id)
);

alter table public.square_webhook_dead_letter enable row level security;

comment on table public.square_webhook_dead_letter is
  'Stage 2A: Square webhook events for a COMPLETED payment that could not be credited (unmatched pending row, amount/currency/location/identifier conflict, malformed event, RPC failure). One row per Square event id; retries bump attempt_count. RLS enabled with no policies: reachable only by the service role.';

create index if not exists idx_square_webhook_dead_letter_unresolved
  on public.square_webhook_dead_letter (last_seen_at desc)
  where resolved_at is null;

-- ---------------------------------------------------------------------------
-- 4. Orphaned payment links.
--
-- Square creates the payment link before api/square-checkout.js persists the
-- pending row. If that insert fails the link still exists and IS PAYABLE by
-- anyone holding the URL — including the buyer's own browser. Recording it
-- here means it can be voided in Square or reconciled once a pending row
-- exists, instead of becoming an untracked way to collect money that the
-- webhook would then report as 'unmatched'.
-- ---------------------------------------------------------------------------
create table if not exists public.square_orphaned_links (
  id bigserial primary key,
  square_order_id text not null,
  square_payment_link_id text,
  checkout_url text,
  user_id uuid references auth.users (id) on delete set null,
  tier_id uuid references public.session_tiers (id) on delete set null,
  amount_cents integer,
  currency text,
  square_location_id text,
  session_count integer,
  failure_code text not null,
  attempt_count integer not null default 1,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  constraint square_orphaned_links_order_id_key unique (square_order_id)
);

alter table public.square_orphaned_links enable row level security;

comment on table public.square_orphaned_links is
  'Stage 2A: Square payment links that were created but whose pending square_payments row failed to persist. These links are PAYABLE, not inert — treat each row as an open reconciliation item (void in Square, or create the pending row and replay the webhook). RLS enabled with no policies: reachable only by the service role.';

-- ---------------------------------------------------------------------------
-- 5. record_square_webhook_dead_letter — UPSERT one row per Square event id.
-- ---------------------------------------------------------------------------
create or replace function public.record_square_webhook_dead_letter(
  p_square_event_id text,
  p_result_code text,
  p_http_status integer,
  p_event_type text default null,
  p_square_order_id text default null,
  p_square_payment_id text default null,
  p_amount_cents integer default null,
  p_currency text default null,
  p_square_location_id text default null,
  p_payment_summary jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_attempts integer;
begin
  if p_square_event_id is null or btrim(p_square_event_id) = '' then
    return jsonb_build_object('ok', false, 'result', 'invalid_event_id');
  end if;

  insert into public.square_webhook_dead_letter (
    square_event_id, event_type, result_code, http_status, square_order_id,
    square_payment_id, amount_cents, currency, square_location_id, payment_summary
  )
  values (
    btrim(p_square_event_id), p_event_type, p_result_code, p_http_status, p_square_order_id,
    p_square_payment_id, p_amount_cents, p_currency, p_square_location_id, p_payment_summary
  )
  on conflict (square_event_id) do update
    set result_code = excluded.result_code,
        http_status = excluded.http_status,
        event_type = coalesce(excluded.event_type, public.square_webhook_dead_letter.event_type),
        square_order_id = coalesce(excluded.square_order_id, public.square_webhook_dead_letter.square_order_id),
        square_payment_id = coalesce(excluded.square_payment_id, public.square_webhook_dead_letter.square_payment_id),
        amount_cents = coalesce(excluded.amount_cents, public.square_webhook_dead_letter.amount_cents),
        currency = coalesce(excluded.currency, public.square_webhook_dead_letter.currency),
        square_location_id = coalesce(excluded.square_location_id, public.square_webhook_dead_letter.square_location_id),
        payment_summary = coalesce(excluded.payment_summary, public.square_webhook_dead_letter.payment_summary),
        attempt_count = public.square_webhook_dead_letter.attempt_count + 1,
        last_seen_at = now()
  returning attempt_count into v_attempts;

  return jsonb_build_object('ok', true, 'result', 'recorded', 'attempt_count', v_attempts);
end;
$function$;

comment on function public.record_square_webhook_dead_letter(text, text, integer, text, text, text, integer, text, text, jsonb) is
  'Stage 2A: records an uncreditable Square webhook event, one row per Square event id. Retried deliveries update that row and increment attempt_count rather than creating duplicates.';

-- ---------------------------------------------------------------------------
-- 6. record_square_orphaned_link — UPSERT one row per Square order id.
-- ---------------------------------------------------------------------------
create or replace function public.record_square_orphaned_link(
  p_square_order_id text,
  p_failure_code text,
  p_square_payment_link_id text default null,
  p_checkout_url text default null,
  p_user_id uuid default null,
  p_tier_id uuid default null,
  p_amount_cents integer default null,
  p_currency text default null,
  p_square_location_id text default null,
  p_session_count integer default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_attempts integer;
begin
  if p_square_order_id is null or btrim(p_square_order_id) = '' then
    return jsonb_build_object('ok', false, 'result', 'invalid_order_id');
  end if;

  insert into public.square_orphaned_links (
    square_order_id, square_payment_link_id, checkout_url, user_id, tier_id,
    amount_cents, currency, square_location_id, session_count, failure_code
  )
  values (
    btrim(p_square_order_id), p_square_payment_link_id, p_checkout_url, p_user_id, p_tier_id,
    p_amount_cents, p_currency, p_square_location_id, p_session_count, coalesce(p_failure_code, 'unknown')
  )
  on conflict (square_order_id) do update
    set failure_code = excluded.failure_code,
        checkout_url = coalesce(excluded.checkout_url, public.square_orphaned_links.checkout_url),
        square_payment_link_id = coalesce(excluded.square_payment_link_id, public.square_orphaned_links.square_payment_link_id),
        attempt_count = public.square_orphaned_links.attempt_count + 1,
        last_seen_at = now()
  returning attempt_count into v_attempts;

  return jsonb_build_object('ok', true, 'result', 'recorded', 'attempt_count', v_attempts);
end;
$function$;

comment on function public.record_square_orphaned_link(text, text, text, text, uuid, uuid, integer, text, text, integer) is
  'Stage 2A: records a Square payment link whose pending square_payments row failed to persist. Such a link is payable; each row is an open reconciliation item.';

-- ---------------------------------------------------------------------------
-- 7. process_square_payment — the atomic core.
--
-- Contract (returns jsonb with 'ok' and 'result'):
--
--   credited              first successful credit. square_payments -> paid AND
--                         exactly one credit_ledger purchase row, committed
--                         together.
--   already_processed     a matching purchase credit already exists. No second
--                         credit. 'repaired' is true when this call also
--                         corrected a payment left non-paid by an earlier
--                         partial failure (the recovery path).
--   unmatched             no pending row for this order. NO WRITES. Caller must
--                         answer 503 so Square retries — a completed payment
--                         with no pending row is real money awaiting
--                         correlation, never something to discard.
--   conflict_status       the payment is failed/refunded. NO WRITES.
--   missing_snapshot      the pending row predates the Stage 2A snapshot
--                         columns, so the purchase terms cannot be verified.
--                         NO WRITES; needs a human.
--   amount_mismatch       Square's amount differs from the snapshot. NO WRITES.
--   currency_mismatch     ditto for currency. NO WRITES.
--   location_mismatch     ditto for location. NO WRITES.
--   conflict_payment_id   the row already records a DIFFERENT Square payment id.
--                         NO WRITES.
--   conflict_ledger_mismatch  a purchase credit exists for this order but does
--                         not match on user, tier or granted credits. NO WRITES.
--   retry_needed          lost a concurrency race in a way that should simply be
--                         retried. NO WRITES.
--
-- Every non-success path leaves the row exactly as it was — in particular it
-- is never marked paid — so nothing becomes permanently unrecoverable: fix
-- the discrepancy and replay the event.
--
-- Concurrency: pg_advisory_xact_lock on the order id plus `select ... for
-- update` on the square_payments row means two concurrent deliveries for the
-- same order fully serialize; the second observes the first's committed work
-- and takes the already_processed branch. The partial unique index is the
-- backstop if that ever fails.
--
-- Validation is always against the server-created pending row, never against
-- webhook metadata. session_tiers is deliberately NOT read here.
-- ---------------------------------------------------------------------------
create or replace function public.process_square_payment(
  p_square_order_id text,
  p_square_payment_id text,
  p_amount_cents integer,
  p_currency text,
  p_location_id text default null,
  p_payment_summary jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_pay record;
  v_existing record;
  v_expected_credits integer;
  v_duplicate boolean := false;
  v_repaired boolean := false;
begin
  -- Argument sanity. These are cheap, write-free rejections.
  if p_square_order_id is null or btrim(p_square_order_id) = '' then
    return jsonb_build_object('ok', false, 'result', 'invalid_order_id');
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

  perform pg_advisory_xact_lock(hashtext(btrim(p_square_order_id)));

  select id, user_id, tier_id, status, amount_cents, currency, session_count,
         square_location_id, square_payment_id
  into v_pay
  from public.square_payments
  where square_order_id = btrim(p_square_order_id)
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'result', 'unmatched');
  end if;

  if v_pay.status in ('failed', 'refunded') then
    return jsonb_build_object('ok', false, 'result', 'conflict_status', 'status', v_pay.status);
  end if;

  -- Without a terms snapshot there is nothing trustworthy to validate
  -- against, and re-reading session_tiers is exactly the mutable-source bug
  -- this design removes. Refuse rather than guess.
  if v_pay.session_count is null or v_pay.session_count <= 0 or v_pay.currency is null then
    return jsonb_build_object('ok', false, 'result', 'missing_snapshot');
  end if;

  if v_pay.amount_cents <> p_amount_cents then
    return jsonb_build_object(
      'ok', false, 'result', 'amount_mismatch',
      'expected_cents', v_pay.amount_cents, 'reported_cents', p_amount_cents
    );
  end if;

  if upper(btrim(v_pay.currency)) <> upper(btrim(p_currency)) then
    return jsonb_build_object(
      'ok', false, 'result', 'currency_mismatch',
      'expected_currency', upper(btrim(v_pay.currency)), 'reported_currency', upper(btrim(p_currency))
    );
  end if;

  if v_pay.square_location_id is not null
     and p_location_id is not null
     and btrim(v_pay.square_location_id) <> btrim(p_location_id) then
    return jsonb_build_object('ok', false, 'result', 'location_mismatch');
  end if;

  -- A different payment id against the same order means two distinct Square
  -- payments claim one order: never silently accept the second.
  if v_pay.square_payment_id is not null
     and btrim(v_pay.square_payment_id) <> btrim(p_square_payment_id) then
    return jsonb_build_object('ok', false, 'result', 'conflict_payment_id');
  end if;

  v_expected_credits := v_pay.session_count;

  -- Is there already a purchase credit for this order? Checked under the row
  -- lock, so a concurrent delivery cannot slip between this read and the
  -- insert below.
  select id, user_id, delta, tier_id
  into v_existing
  from public.credit_ledger
  where square_order_id = btrim(p_square_order_id)
    and reason = 'purchase'
  limit 1;

  if found then
    -- A pre-existing row is NOT assumed to be a safe replay. It only counts
    -- as one if it grants the same credits to the same user for the same
    -- tier as this order's snapshot; anything else is a conflict for a human.
    if v_existing.user_id <> v_pay.user_id
       or v_existing.delta <> v_expected_credits
       or coalesce(v_existing.tier_id::text, '') <> coalesce(v_pay.tier_id::text, '') then
      return jsonb_build_object(
        'ok', false, 'result', 'conflict_ledger_mismatch',
        'existing_ledger_id', v_existing.id,
        'existing_delta', v_existing.delta,
        'expected_credits', v_expected_credits
      );
    end if;

    -- Verified replay. If the payment was left non-paid by an earlier partial
    -- failure, correct it now — this is the recovery the old code could never
    -- perform because its replay guard keyed off that very status.
    if v_pay.status <> 'paid' then
      update public.square_payments
      set status = 'paid',
          square_payment_id = coalesce(square_payment_id, btrim(p_square_payment_id)),
          raw_payload = coalesce(p_payment_summary, raw_payload),
          updated_at = now()
      where id = v_pay.id;
      v_repaired := true;
    end if;

    return jsonb_build_object(
      'ok', true, 'result', 'already_processed',
      'credits', v_existing.delta, 'repaired', v_repaired
    );
  end if;

  -- No credit yet. Note this deliberately includes the case where status is
  -- already 'paid': that is precisely the money-collected-without-entitlement
  -- state, and the correct action is to grant the missing credits now.
  --
  -- The ledger insert comes FIRST so that if the unique index fires, no other
  -- write has happened yet and the conflict paths below are genuinely
  -- write-free.
  begin
    insert into public.credit_ledger (user_id, delta, reason, tier_id, square_order_id)
    values (v_pay.user_id, v_expected_credits, 'purchase', v_pay.tier_id, btrim(p_square_order_id));
  exception
    when unique_violation then
      v_duplicate := true;
  end;

  if v_duplicate then
    -- Backstop hit: a concurrent delivery inserted first. Re-read and apply
    -- the same equality test — a unique violation alone is NOT proof that the
    -- existing row is equivalent to what this call intended to write.
    select id, user_id, delta, tier_id
    into v_existing
    from public.credit_ledger
    where square_order_id = btrim(p_square_order_id)
      and reason = 'purchase'
    limit 1;

    if not found then
      return jsonb_build_object('ok', false, 'result', 'retry_needed');
    end if;

    if v_existing.user_id <> v_pay.user_id
       or v_existing.delta <> v_expected_credits
       or coalesce(v_existing.tier_id::text, '') <> coalesce(v_pay.tier_id::text, '') then
      return jsonb_build_object(
        'ok', false, 'result', 'conflict_ledger_mismatch',
        'existing_ledger_id', v_existing.id,
        'existing_delta', v_existing.delta,
        'expected_credits', v_expected_credits
      );
    end if;

    if v_pay.status <> 'paid' then
      update public.square_payments
      set status = 'paid',
          square_payment_id = coalesce(square_payment_id, btrim(p_square_payment_id)),
          raw_payload = coalesce(p_payment_summary, raw_payload),
          updated_at = now()
      where id = v_pay.id;
      v_repaired := true;
    end if;

    return jsonb_build_object(
      'ok', true, 'result', 'already_processed',
      'credits', v_existing.delta, 'repaired', v_repaired
    );
  end if;

  -- Same transaction as the ledger insert above: both commit, or neither does.
  update public.square_payments
  set status = 'paid',
      square_payment_id = btrim(p_square_payment_id),
      raw_payload = coalesce(p_payment_summary, raw_payload),
      updated_at = now()
  where id = v_pay.id;

  return jsonb_build_object('ok', true, 'result', 'credited', 'credits', v_expected_credits, 'repaired', false);
exception
  when unique_violation then
    -- Any other constraint violation rolls back every write this call made
    -- and asks for a retry rather than reporting a false success.
    return jsonb_build_object('ok', false, 'result', 'retry_needed');
end;
$function$;

comment on function public.process_square_payment(text, text, integer, text, text, jsonb) is
  'Stage 2A-owned. The ONLY place a Square purchase is credited. Transitions square_payments pending -> paid and inserts exactly one credit_ledger purchase row in a single transaction, validating Square''s reported amount, currency, location and payment id against the server-created pending row (never against webhook metadata, and never re-reading session_tiers). Returns credited | already_processed | unmatched | conflict_* | missing_snapshot | retry_needed. Every non-success path performs no writes and leaves the payment recoverable by replaying the event.';

revoke all on function public.process_square_payment(text, text, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.process_square_payment(text, text, integer, text, text, jsonb) to service_role;

revoke all on function public.record_square_webhook_dead_letter(text, text, integer, text, text, text, integer, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.record_square_webhook_dead_letter(text, text, integer, text, text, text, integer, text, text, jsonb) to service_role;

revoke all on function public.record_square_orphaned_link(text, text, text, text, uuid, uuid, integer, text, text, integer) from public, anon, authenticated;
grant execute on function public.record_square_orphaned_link(text, text, text, text, uuid, uuid, integer, text, text, integer) to service_role;
