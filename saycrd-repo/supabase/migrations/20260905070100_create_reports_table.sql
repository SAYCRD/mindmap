-- Stage 1 (session-persistence-audit): reports table.
-- Review-only migration. Do NOT apply to any database until explicitly approved.
--
-- A report is generated after a session completes and is read back as
-- prompt context for future reports (the "recent report tone" use case) --
-- that access pattern is why this is its own indexed table rather than a
-- field on sessions.content.

create table if not exists public.reports (
  id uuid primary key default gen_random_uuid(),

  -- unique: enforces "generated once per session, reused on every view /
  -- replaced explicitly on retry" at the database level, not just in
  -- application code.
  session_id uuid not null unique references public.sessions(id) on delete cascade,

  -- Denormalized for RLS simplicity and for querying "this user's last N
  -- reports" without a join. on delete restrict: a report must never be
  -- silently orphaned or wiped by a plain auth.users delete.
  user_id uuid not null references auth.users(id) on delete restrict,

  -- Defaults to 'generating', never 'complete': a row exists the moment
  -- generation begins, so a hung/crashed generation is a visible stuck
  -- 'generating' row rather than no row at all. Only the (not-yet-authored)
  -- Stage 5 completion RPC ever transitions a row to 'complete'.
  status text not null default 'generating'
    check (status in ('generating', 'complete', 'failed')),

  schema_version int not null default 1,

  -- Null while status is 'generating' or 'failed'. Populated with
  -- {sections[], oneLineVerdict, whatMightWantToHappen, dateRange, ...}
  -- once status = 'complete'.
  content jsonb,

  -- Denormalized copy of content.oneLineVerdict for cheap listing without
  -- unpacking jsonb. Migrated rows are exempt from the length cap so a
  -- legacy verdict can never be rejected or truncated by this constraint.
  one_line_verdict text
    check (migration_source is not null or one_line_verdict is null or char_length(one_line_verdict) <= 200),

  migration_source text
    check (migration_source in ('guest_migration', 'authenticated_local_migration')),
  needs_normalization boolean not null default false,

  -- A failed generation still gets a row (status='failed'), and a retry
  -- reuses that same row via the completion RPC's `on conflict (session_id)
  -- do update` rather than inserting a duplicate. attempt_count makes the
  -- retry history visible without a separate audit table.
  attempt_count int not null default 1,

  -- Structured error identifier only (e.g. 'generation_timeout'). Never
  -- raw prose or any field derived from user content -- see the no-content
  -- -logging rule this design follows throughout.
  last_error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.reports is
  'One row per session (unique session_id). generating until a completion RPC (Stage 5) sets status=complete and writes content.';

create index if not exists idx_reports_user_created
  on public.reports (user_id, created_at desc);

create index if not exists idx_reports_session
  on public.reports (session_id);

-- Reuses the Stage-1-owned public.blindspot_content_set_updated_at()
-- created in the sessions migration (this migration runs after it) --
-- never the pre-existing, undocumented-in-this-repo production functions
-- public.update_updated_at() / public.set_updated_at().
drop trigger if exists reports_set_updated_at on public.reports;
create trigger reports_set_updated_at
  before update on public.reports
  for each row
  execute function public.blindspot_content_set_updated_at();

alter table public.reports enable row level security;

-- Access model: server-API-only, matching sessions above. Browser roles
-- get no table grant at all; this policy is inert unless a later,
-- separately-reviewed migration deliberately grants authenticated SELECT.
drop policy if exists "reports_select_own" on public.reports;
create policy "reports_select_own"
  on public.reports
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- service_role needs select/insert/update (a retry re-uses the same row
-- via `on conflict (session_id) do update`, per the Stage 5 completion
-- RPC design) but never delete -- reports are removed only by cascading
-- from their parent session (session_id ... on delete cascade, above),
-- never by a direct DELETE statement against this table. Postgres
-- performs an ON DELETE CASCADE action internally as part of enforcing
-- the foreign key, which requires DELETE privilege on the REFERENCED
-- table (sessions) but not on this table itself -- so account deletion's
-- `DELETE FROM public.sessions WHERE user_id = ...` (service_role has
-- DELETE on sessions) is sufficient on its own to also remove this user's
-- reports, with no separate DELETE grant needed here.
--
-- service_role is included in the revoke below (not just
-- public/anon/authenticated): this schema's ALTER DEFAULT PRIVILEGES
-- entry auto-grants full CRUD to service_role on every new table
-- (existing production behavior, unmodified here), so without this
-- explicit revoke the "no delete" intent above would be silently
-- undermined by that inherited default grant.
revoke all on public.reports from public, anon, authenticated, service_role;
grant select, insert, update on public.reports to service_role;
