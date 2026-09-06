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

  -- Nullable, on delete set null (not restrict, and not unique on this
  -- column alone): once the session itself is deleted -- e.g. as part of
  -- account deletion, which removes a user's private sessions/reports --
  -- this row survives with session_id cleared rather than blocking the
  -- session's deletion or being deleted itself. session_ref (below) is the
  -- permanent, immutable stand-in identifier that keeps this row's
  -- "which session was this for" meaning intact even after session_id is
  -- gone.
  session_id uuid references public.sessions(id) on delete set null,

  -- Immutable copy of session_id, captured at insert time by the
  -- blindspot_set_entitlement_session_ref trigger below -- never a foreign
  -- key (so it can never be affected by, or block, the session row's
  -- deletion) and never updated afterward (this table has no UPDATE grant
  -- for any role, see the grants below). This is the durable per-session
  -- audit identifier; session_id is the convenience live link that exists
  -- only while the session row itself still does.
  session_ref uuid not null,

  -- Nullable, on delete set null -- matching granted_by's existing
  -- rationale below, for the identical reason: this table's rows are the
  -- retained minimum financial/entitlement audit evidence for a completed
  -- session and are intentionally never deleted, even across full account
  -- deletion. If this stayed on delete restrict, a deletion flow that
  -- ultimately removes the auth.users row itself would be permanently
  -- blocked by every retained entitlement-usage row belonging to that
  -- user. entitlement_type, credit_ledger_id / subscription_id /
  -- granted_by, and session_ref remain the durable evidence; user_id here
  -- is attribution only and is allowed to be cleared.
  user_id uuid references auth.users(id) on delete set null,

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
  'Auditable, exactly-once-per-session-ever record of which entitlement (complimentary/credit/subscription/admin_grant) was consumed to complete a session. Written only by the Stage 5 completion RPC (not yet authored). Rows are retained across session and account deletion: session_id/user_id are nullable and cleared via ON DELETE SET NULL, but session_ref preserves a permanent, non-FK reference to the original session.';

create index if not exists idx_entitlement_usage_user
  on public.session_entitlement_usage (user_id, created_at desc);

-- Enforces "exactly one entitlement-usage row per session, ever" using the
-- immutable session_ref rather than the nullable session_id -- unlike a
-- unique constraint on session_id, this guarantee survives the session
-- row's own deletion (session_id would otherwise become null and no
-- longer distinguish which session a row was originally for).
create unique index if not exists idx_entitlement_usage_session_ref
  on public.session_entitlement_usage (session_ref);

-- Populates session_ref from session_id at insert time and rejects any
-- insert attempt with a null session_id -- this table's whole purpose is
-- recording entitlement usage FOR a session, so session_id must be real
-- at creation even though it is nullable afterward (to support the later
-- ON DELETE SET NULL when that session is deleted). session_ref is always
-- taken from session_id here, never from a client-supplied value, since
-- application code is not trusted to keep the two in sync.
create or replace function public.blindspot_set_entitlement_session_ref()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.session_id is null then
    raise exception 'session_entitlement_usage.session_id must be set at insert time';
  end if;
  new.session_ref := new.session_id;
  return new;
end;
$$;

comment on function public.blindspot_set_entitlement_session_ref() is
  'Stage 1 (session-persistence-audit)-owned. Populates session_entitlement_usage.session_ref from session_id at insert time; used only by that table''s before-insert trigger.';

revoke all on function public.blindspot_set_entitlement_session_ref() from public, anon, authenticated;

drop trigger if exists entitlement_usage_set_session_ref on public.session_entitlement_usage;
create trigger entitlement_usage_set_session_ref
  before insert on public.session_entitlement_usage
  for each row
  execute function public.blindspot_set_entitlement_session_ref();

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
-- This does NOT prevent session_id/user_id from ever being cleared: the
-- ON DELETE SET NULL actions on those columns are performed internally by
-- Postgres's own foreign-key enforcement when the referenced sessions/
-- auth.users row is deleted, not by an ordinary UPDATE statement -- so
-- they require only DELETE privilege on the REFERENCED table (sessions,
-- auth.users), never an UPDATE grant on this table itself. No role,
-- including service_role, can otherwise modify or delete a row here.
--
-- service_role is included in the revoke below (not just
-- public/anon/authenticated): this schema's ALTER DEFAULT PRIVILEGES
-- entry auto-grants full CRUD to service_role on every new table
-- (existing production behavior, unmodified here). Without this explicit
-- revoke, that inherited default grant would silently give service_role
-- update/delete access on this table, defeating the entire "write-once,
-- no role can ever modify or delete a row here" guarantee documented
-- above.
revoke all on public.session_entitlement_usage from public, anon, authenticated, service_role;
grant select, insert on public.session_entitlement_usage to service_role;
