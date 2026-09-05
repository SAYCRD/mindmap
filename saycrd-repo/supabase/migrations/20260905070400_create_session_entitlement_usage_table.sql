-- Stage 1 (session-persistence-audit): session_entitlement_usage table.
-- Review-only migration. Do NOT apply to any database until explicitly approved.
--
-- This is the auditable record of "what paid/free/subscribed/admin-granted
-- slot was consumed by completing this session." It replaces a bare
-- sessions.credit_ledger_id column (which could only represent purchased-
-- credit consumption, not complimentary/subscription/admin-grant usage --
-- the flaw explicitly corrected in this design). No RPC that writes to
-- this table is authored in this migration; that is Stage 5. This
-- migration only establishes the table, its constraints, and its RLS.
--
-- References public.subscriptions(id) and public.credit_ledger(id), both
-- of which already exist in production (see supabase/schema.sql and the
-- already-applied add_subscriptions_table / add_session_credit_payment_tables
-- migrations). Neither table's own schema is modified by this migration --
-- subscriptions and session_tiers changes are explicitly out of scope for
-- Stage 1 per the approved plan.

create table if not exists public.session_entitlement_usage (
  id uuid primary key default gen_random_uuid(),

  -- unique: exactly one entitlement-usage row can ever exist per session,
  -- regardless of entitlement type -- this is the auditable guarantee this
  -- table exists to provide. on delete restrict: a session with a recorded
  -- entitlement usage can never be deleted by a plain DELETE; any real
  -- deletion flow must handle this explicitly (matches the financial-
  -- record-retention design for account deletion).
  session_id uuid not null unique references public.sessions(id) on delete restrict,

  user_id uuid not null references auth.users(id) on delete restrict,

  entitlement_type text not null
    check (entitlement_type in ('complimentary', 'credit', 'subscription', 'admin_grant')),

  -- Exactly one of these three is set, matching entitlement_type -- enforced
  -- by session_entitlement_usage_linkage_ck below, not left to application
  -- code alone.
  credit_ledger_id bigint references public.credit_ledger(id),
  subscription_id uuid references public.subscriptions(id),

  -- Attribution only (which admin granted a complimentary/manual session).
  -- on delete set null: losing the admin's own account must never block
  -- deleting this audit row's referential integrity for the session itself.
  granted_by uuid references auth.users(id) on delete set null,

  created_at timestamptz not null default now(),

  constraint session_entitlement_usage_linkage_ck check (
    (entitlement_type = 'credit'
      and credit_ledger_id is not null and subscription_id is null and granted_by is null)
    or (entitlement_type = 'subscription'
      and subscription_id is not null and credit_ledger_id is null and granted_by is null)
    or (entitlement_type = 'admin_grant'
      and granted_by is not null and credit_ledger_id is null and subscription_id is null)
    or (entitlement_type = 'complimentary'
      and credit_ledger_id is null and subscription_id is null and granted_by is null)
  )
);

comment on table public.session_entitlement_usage is
  'Auditable, exactly-once-per-session record of which entitlement (complimentary/credit/subscription/admin_grant) was consumed to complete a session. Written only by the Stage 5 completion RPC (not yet authored).';

create index if not exists idx_entitlement_usage_user
  on public.session_entitlement_usage (user_id, created_at desc);

alter table public.session_entitlement_usage enable row level security;

-- Access model: server-API-only, matching sessions above. Browser roles
-- get no table grant at all; this policy is inert unless a later,
-- separately-reviewed migration deliberately grants authenticated SELECT.
drop policy if exists "entitlement_usage_select_own" on public.session_entitlement_usage;
create policy "entitlement_usage_select_own"
  on public.session_entitlement_usage
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- service_role gets select/insert only -- this table is a write-once
-- audit trail by design ("exactly one row per session, ever"), so no
-- update or delete privilege is granted at all, even to service_role.
revoke all on public.session_entitlement_usage from public, anon, authenticated;
grant select, insert on public.session_entitlement_usage to service_role;
