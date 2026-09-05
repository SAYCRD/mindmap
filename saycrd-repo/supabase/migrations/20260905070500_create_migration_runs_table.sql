-- Stage 1 (session-persistence-audit): migration_runs table.
-- Review-only migration. Do NOT apply to any database until explicitly approved.
--
-- Auditable record of each guest-to-account / existing-authenticated-local
-- backfill upload attempt, keyed per (user, device, source scope) rather
-- than per user alone -- this is what allows Device B (opened weeks after
-- Device A already migrated) to still be scanned and uploaded, since it
-- has a different source_device_id. No upload/migration logic itself is
-- authored in this migration; this table only exists so that logic (a
-- later stage) has somewhere durable to record its outcome.

create table if not exists public.migration_runs (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete restrict,

  -- Identifies the browser/install the scanned local data came from, not
  -- the person. Generated client-side once per browser (crypto.randomUUID())
  -- and cached outside any uid-scoped key -- never personally identifying
  -- by itself.
  source_device_id uuid not null default gen_random_uuid(),

  -- Which local scope this run scanned: the two guest buckets, or the
  -- signed-in user's own uid-scoped local keys (the "existing authenticated
  -- user, never a guest" backfill case).
  source_scope text not null
    check (source_scope in ('guest_local', 'guest_local_user', 'authenticated_local')),

  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'partial_failure', 'failed')),

  -- Diagnostic only, e.g. 'local' / 'local-user' / a legacy key name.
  -- Never personally identifying beyond that.
  source_uid_hint text,

  sessions_found int not null default 0,
  sessions_uploaded int not null default 0,
  sessions_failed int not null default 0,
  sessions_duplicate int not null default 0,

  -- Structured diagnostics only (ids, counts, error codes) -- never raw
  -- session content, matching the no-content-logging rule this design
  -- follows throughout.
  error_detail jsonb,

  started_at timestamptz not null default now(),
  finished_at timestamptz
);

comment on table public.migration_runs is
  'Auditable outcome of each guest/local-backfill upload attempt, keyed per (user, device, scope) so a device that migrates later is never blocked by an earlier device''s completed run.';

create index if not exists idx_migration_runs_user
  on public.migration_runs (user_id, started_at desc);

-- One completed run per (user, device, scope) -- the actual decision rule
-- a future migration-trigger check uses ("has THIS device already finished
-- THIS scope for this user") rather than "has this user ever migrated
-- anything, from any device."
create unique index if not exists idx_migration_runs_device_scope
  on public.migration_runs (user_id, source_device_id, source_scope)
  where status = 'completed';

alter table public.migration_runs enable row level security;

-- Access model: server-API-only, matching sessions above. Browser roles
-- get no table grant at all; this policy is inert unless a later,
-- separately-reviewed migration deliberately grants authenticated SELECT.
drop policy if exists "migration_runs_select_own" on public.migration_runs;
create policy "migration_runs_select_own"
  on public.migration_runs
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- service_role gets select/insert/update -- a run starts 'in_progress' and
-- is later updated in place to 'completed'/'partial_failure'/'failed'
-- (never a new row per status change). No delete: a run's outcome is
-- permanent audit history.
revoke all on public.migration_runs from public, anon, authenticated;
grant select, insert, update on public.migration_runs to service_role;
