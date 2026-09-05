-- Blindspot: Square-based session-pack payments schema
-- Run this in the Supabase SQL Editor, in the SAME project as schema.sql
-- (schema.sql should be run first, since it defines update_updated_at()
-- and the update_updated_at trigger function reused below — but this file
-- also redefines it, so it is safe to run in either order.)

-- ═══════════════════════════════════════
-- Shared trigger helper (idempotent redefinition — see note above)
-- ═══════════════════════════════════════
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ═══════════════════════════════════════
-- Session tiers — admin-managed catalog (e.g. "1 Session" / $12,
-- "2 Sessions" / $18, "5 Sessions" / $33). Read is public (anon can see
-- active tiers to render the paywall); writes only happen through the
-- service role from api/admin-tiers.js, which enforces its own
-- ADMIN_EMAILS allowlist — no insert/update/delete policy exists here for
-- anon/authenticated, so RLS blocks all client-side writes outright.
-- ═══════════════════════════════════════
create table if not exists session_tiers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  session_count integer not null check (session_count > 0),
  price_cents integer not null check (price_cents > 0),
  currency text not null default 'USD',
  active boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table session_tiers enable row level security;

drop policy if exists "Anyone can read active tiers" on session_tiers;
create policy "Anyone can read active tiers"
  on session_tiers for select
  using (active = true);

drop trigger if exists session_tiers_updated_at on session_tiers;
create trigger session_tiers_updated_at
  before update on session_tiers
  for each row execute function update_updated_at();

insert into session_tiers (name, session_count, price_cents, sort_order)
select v.name, v.session_count, v.price_cents, v.sort_order
from (values
  ('1 Session', 1, 1200, 1),
  ('2 Sessions', 2, 1800, 2),
  ('5 Sessions', 5, 3300, 3)
) as v(name, session_count, price_cents, sort_order)
where not exists (select 1 from session_tiers);

-- ═══════════════════════════════════════
-- Free session usage — everyone (once they have a real account) gets 2
-- free sessions, ever. Only the service role (via the consume_session_credit
-- RPC below) increments this; a signed-in user can read their own row but
-- never write it directly.
-- ═══════════════════════════════════════
create table if not exists free_sessions_used (
  user_id uuid primary key references auth.users(id) on delete cascade,
  count integer not null default 0 check (count >= 0),
  updated_at timestamptz not null default now()
);

alter table free_sessions_used enable row level security;

drop policy if exists "Users can read own free session count" on free_sessions_used;
create policy "Users can read own free session count"
  on free_sessions_used for select
  using (auth.uid() = user_id);

drop trigger if exists free_sessions_used_updated_at on free_sessions_used;
create trigger free_sessions_used_updated_at
  before update on free_sessions_used
  for each row execute function update_updated_at();

-- ═══════════════════════════════════════
-- Credit ledger — append-only. A user's paid-credit balance is always
-- derived as sum(delta), never stored directly, so there is no separate
-- balance column that can drift out of sync. Positive rows come from a
-- completed Square payment (webhook); negative rows come from consuming
-- one session. Only the service role can insert; a signed-in user can
-- read their own rows but never write.
-- ═══════════════════════════════════════
create table if not exists credit_ledger (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  delta integer not null,
  reason text not null check (reason in ('purchase', 'session_start', 'admin_grant')),
  tier_id uuid references session_tiers(id),
  square_order_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_credit_ledger_user on credit_ledger(user_id);

alter table credit_ledger enable row level security;

drop policy if exists "Users can read own ledger" on credit_ledger;
create policy "Users can read own ledger"
  on credit_ledger for select
  using (auth.uid() = user_id);

-- ═══════════════════════════════════════
-- Square payments — audit + idempotency. square_order_id is unique so a
-- duplicate webhook delivery for the same order can never double-credit.
-- ═══════════════════════════════════════
create table if not exists square_payments (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  tier_id uuid references session_tiers(id) not null,
  square_order_id text not null unique,
  square_payment_id text,
  amount_cents integer not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed')),
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_square_payments_user on square_payments(user_id);

alter table square_payments enable row level security;

drop policy if exists "Users can read own payments" on square_payments;
create policy "Users can read own payments"
  on square_payments for select
  using (auth.uid() = user_id);

drop trigger if exists square_payments_updated_at on square_payments;
create trigger square_payments_updated_at
  before update on square_payments
  for each row execute function update_updated_at();

-- ═══════════════════════════════════════
-- consume_session_credit — the single atomic "spend one session" operation.
-- Called by api/session-start.js via the service role. Runs as
-- security definer with a pinned search_path (required so a caller can't
-- shadow a table name and run code as the function owner), and serializes
-- concurrent calls for the same user with a transaction-scoped advisory
-- lock so two simultaneous "start session" clicks can never both succeed
-- off the same last credit.
--
-- p_seed_used lets the first-ever call for a user seed their free-session
-- count from local guest-session history reported by the client (capped at
-- the free limit) instead of starting at 0 — but only on first insert; it
-- can never lower an existing count.
-- ═══════════════════════════════════════
create or replace function consume_session_credit(p_user_id uuid, p_seed_used integer default 0)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_free_used integer;
  v_balance integer;
  v_free_limit integer := 2;
  v_seed integer;
begin
  perform pg_advisory_xact_lock(hashtext(p_user_id::text));

  v_seed := greatest(0, least(coalesce(p_seed_used, 0), v_free_limit));

  insert into public.free_sessions_used (user_id, count)
  values (p_user_id, v_seed)
  on conflict (user_id) do nothing;

  select count into v_free_used from public.free_sessions_used where user_id = p_user_id;

  if v_free_used < v_free_limit then
    update public.free_sessions_used set count = count + 1 where user_id = p_user_id;
    return jsonb_build_object('ok', true, 'source', 'free');
  end if;

  select coalesce(sum(delta), 0) into v_balance from public.credit_ledger where user_id = p_user_id;

  if v_balance > 0 then
    insert into public.credit_ledger (user_id, delta, reason)
    values (p_user_id, -1, 'session_start');
    return jsonb_build_object('ok', true, 'source', 'paid');
  end if;

  return jsonb_build_object('ok', false);
end;
$$;

-- ═══════════════════════════════════════
-- ensure_free_sessions_seed — read-only-safe seeding used by api/credits.js
-- so the balance display reflects carried-over guest sessions even before
-- the user's first real-account session start. Never lowers an existing
-- row (ON CONFLICT DO NOTHING), so it cannot be used to reset a count.
-- ═══════════════════════════════════════
create or replace function ensure_free_sessions_seed(p_user_id uuid, p_seed_used integer default 0)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seed integer;
begin
  v_seed := greatest(0, least(coalesce(p_seed_used, 0), 2));
  insert into public.free_sessions_used (user_id, count)
  values (p_user_id, v_seed)
  on conflict (user_id) do nothing;
end;
$$;
