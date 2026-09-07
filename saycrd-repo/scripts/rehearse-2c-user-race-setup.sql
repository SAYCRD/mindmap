-- ---------------------------------------------------------------------------
-- scripts/rehearse-2c-user-race-setup.sql
--
-- RUN ONLY ON A DISPOSABLE SUPABASE BRANCH.
--
-- Fixtures for the refund-vs-session-completion race in
-- scripts/rehearse-2c-user-race.sh.
--
-- WHY THIS RACE EXISTS
--
-- Every earlier concurrency rehearsal raced refunds against refunds, which all
-- serialize on pg_advisory_xact_lock(hashtext(order_id)). That structurally
-- could not detect the real hole: complete_session_and_consume_entitlement
-- locks the USER, not the order. Two different keys, so before the per-user
-- lock was added to process_square_refund, a refund and a session completion
-- could both read a balance of 1 and both spend it, committing to -1.
--
-- The state below is the minimum that can expose it: exactly ONE credit, one
-- draft session ready to consume it, and a full refund that would claw the
-- same credit back. Exactly one of the two may succeed.
--
-- Each round gets its own user and its own order, so a round can never be
-- contaminated by the previous round's committed state, and so the two racers
-- contend for one credit rather than one of several.
-- ---------------------------------------------------------------------------

\set ON_ERROR_STOP on
\pset pager off

-- The tier grants ONE session for 1000 cents, so a 1000-cent refund is a full
-- refund and the grant is a single credit.
insert into public.session_tiers (id, name, session_count, price_cents, currency, active, sort_order)
values ('b0000000-0000-0000-0000-0000000000fd', 'Stage2C race single', 1, 1000, 'USD', true, 97)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- Round fixture. Returns the draft session id the completion racer will use.
--
-- Deliberately NOT wrapped in an outer transaction by the caller: the racers
-- are separate connections and must see committed fixtures.
-- ---------------------------------------------------------------------------
create or replace function public.rehearse2c_race_seed_round(p_round integer)
returns uuid language plpgsql as $$
declare
  v_user uuid;
  v_session uuid;
  v_order text := 'ORD-UR-' || p_round;
  v_payment text := 'PAY-UR-' || p_round;
begin
  v_user := ('c1000000-0000-0000-0000-' || lpad(p_round::text, 12, '0'))::uuid;

  insert into auth.users (id, instance_id, aud, role, email)
  values (v_user, '00000000-0000-0000-0000-000000000000',
          'authenticated', 'authenticated',
          'c2c-race-' || p_round || '@rehearsal.test')
  on conflict (id) do nothing;

  -- Exhaust the complimentary allowance, or completion would consume a free
  -- session and never touch the credit the refund is competing for.
  insert into public.free_sessions_used (user_id, count)
  values (v_user, 2)
  on conflict (user_id) do update set count = 2;

  insert into public.square_payments
    (user_id, tier_id, square_order_id, square_payment_id, amount_cents, status,
     currency, session_count, square_location_id)
  values
    (v_user, 'b0000000-0000-0000-0000-0000000000fd', v_order, v_payment, 1000, 'paid',
     'USD', 1, 'LG8FD2SPNNAVX')
  on conflict (square_order_id) do nothing;

  insert into public.credit_ledger (user_id, delta, reason, tier_id, square_order_id)
  values (v_user, 1, 'purchase', 'b0000000-0000-0000-0000-0000000000fd', v_order);

  insert into public.sessions (user_id, status) values (v_user, 'draft')
  returning id into v_session;

  -- The premise of the race. If this is ever false the round proves nothing,
  -- so fail loudly rather than reporting a meaningless pass.
  if (select coalesce(sum(delta), 0) from public.credit_ledger where user_id = v_user) <> 1 then
    raise exception 'round % did not start from exactly one credit', p_round;
  end if;

  return v_session;
end;
$$;

create or replace function public.rehearse2c_race_user(p_round integer)
returns uuid language sql as $$
  select ('c1000000-0000-0000-0000-' || lpad(p_round::text, 12, '0'))::uuid;
$$;

-- ---------------------------------------------------------------------------
-- Per-round verdict, read from committed state only.
--
-- The invariant is not "the refund wins" or "the completion wins" — which one
-- wins is nondeterministic and both outcomes are correct. The invariant is
-- that EXACTLY ONE of them spent the credit.
-- ---------------------------------------------------------------------------
create or replace function public.rehearse2c_race_verdict(p_round integer)
returns jsonb language sql as $$
  with u as (select public.rehearse2c_race_user(p_round) as id),
  o as (select 'ORD-UR-' || p_round as ord)
  select jsonb_build_object(
    'round', p_round,
    'balance', (select coalesce(sum(delta), 0) from public.credit_ledger, u
                 where credit_ledger.user_id = u.id),
    'session_debits', (select count(*) from public.credit_ledger, u
                        where credit_ledger.user_id = u.id and reason = 'session_complete'),
    'refund_debits', (select count(*) from public.credit_ledger, u
                       where credit_ledger.user_id = u.id and reason = 'refund'),
    'completed_sessions', (select count(*) from public.sessions, u
                            where sessions.user_id = u.id and status = 'completed'),
    'draft_sessions', (select count(*) from public.sessions, u
                        where sessions.user_id = u.id and status = 'draft'),
    'reports', (select count(*) from public.reports, u where reports.user_id = u.id),
    'refund_rows', (select count(*) from public.square_refunds, o
                     where square_refunds.square_order_id = o.ord),
    'refund_result', (select result_code from public.square_refunds, o
                       where square_refunds.square_order_id = o.ord limit 1),
    'credits_removed', (select coalesce(sum(credits_removed), 0) from public.square_refunds, o
                         where square_refunds.square_order_id = o.ord),
    'payment_status', (select status from public.square_payments, o
                        where square_payments.square_order_id = o.ord)
  );
$$;

\echo 'race fixtures installed'
