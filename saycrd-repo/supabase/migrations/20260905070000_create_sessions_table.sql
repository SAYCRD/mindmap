-- Stage 1 (session-persistence-audit): sessions table.
-- Review-only migration. Do NOT apply to any database until explicitly approved.
--
-- sessions is the server-authoritative record of a user's reflection session.
-- Identity is always the row's own `id` (a UUID assigned client-side the
-- moment a session is created), never `legacy_date`/`legacy_fingerprint` --
-- those exist solely to detect true duplicates during guest/local migration
-- (see the *_create_migration_runs_table.sql note) and are never used as a
-- primary key or unique identity by themselves.

create table if not exists public.sessions (
  id uuid primary key default gen_random_uuid(),

  -- on delete restrict (not cascade): a session must never be silently wiped
  -- out by a plain auth.users delete. Account deletion is a deliberate,
  -- staged, multi-step operation (deletes sessions explicitly, then handles
  -- auth.users separately) -- this FK makes an accidental/implicit cascade
  -- impossible at the database level.
  user_id uuid not null references auth.users(id) on delete restrict,

  status text not null default 'draft'
    check (status in ('draft', 'processing', 'completed', 'failed', 'abandoned')),

  schema_version int not null default 1,

  -- The session's evolving content (rawText, themes, mapResponses,
  -- cardFeedback, sentenceFeedback, etc.). Modeled as jsonb because this
  -- shape has already changed multiple times historically and will keep
  -- evolving; schema_version lets future code interpret older rows
  -- correctly without a migration every time a field is added.
  content jsonb not null default '{}'::jsonb,

  -- Legacy migration provenance (guest/local -> server backfill). These
  -- columns are populated only by the migration path, never by normal
  -- session creation, and are informational/dedup-only -- see requirement
  -- that legacy_fingerprint must never replace UUID identity, satisfied by
  -- `id` being the sole primary key and the only column any foreign key in
  -- this schema ever references.
  legacy_date timestamptz,
  legacy_fingerprint text,

  -- Set true when a migrated row contains a field that would have violated
  -- a live-write validation limit (see sessions_content_size_ck below). This
  -- is how legacy content is preserved byte-for-byte without truncation
  -- while still flagging it for optional, user-initiated cleanup later.
  needs_normalization boolean not null default false,

  migration_source text
    check (migration_source in ('guest_migration', 'authenticated_local_migration')),
  migration_batch_id uuid,

  -- Non-consuming start-time reservation window. Populated/renewed only by
  -- the Stage 5 reservation RPC (not authored in this migration) -- the
  -- column exists now so Stage 5 does not require an ALTER TABLE.
  reservation_expires_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,

  -- Live writes (migration_source is null) are capped at ~200KB of jsonb
  -- content as a sanity bound. Migrated rows (migration_source is not null)
  -- are explicitly exempt so legacy content can never be truncated or
  -- rejected by this migration.
  constraint sessions_content_size_ck
    check (migration_source is not null or pg_column_size(content) <= 200000)
);

comment on table public.sessions is
  'Server-authoritative session records. id is the only identity any other table references; legacy_date/legacy_fingerprint are migration-dedup metadata only.';

-- Query patterns this migration must support without a future ALTER TABLE:
--   - "this user's sessions by status" (dashboard, start-eligibility checks)
--   - "this user's completed sessions, most recent first" (dashboard list, paginated)
--   - "this user's currently-reserved draft/processing sessions" (Stage 5 concurrency check)
create index if not exists idx_sessions_user_status
  on public.sessions (user_id, status);

create index if not exists idx_sessions_user_completed
  on public.sessions (user_id, completed_at desc)
  where status = 'completed';

create index if not exists idx_sessions_reservation
  on public.sessions (user_id)
  where status in ('draft', 'processing') and reservation_expires_at is not null;

-- True-duplicate protection only, scoped per user. A shared legacy_date
-- alone can never collide two different sessions because the fingerprint
-- is content-derived (see migration_runs migration note); this index only
-- blocks byte-identical content from being inserted twice.
create unique index if not exists idx_sessions_user_legacy_fingerprint
  on public.sessions (user_id, legacy_fingerprint)
  where legacy_fingerprint is not null;

-- Shared updated_at trigger function, reused by every table in this Stage
-- that has an updated_at column. `create or replace` makes this migration
-- safe to re-run without colliding with any existing function of the same
-- name/signature.
create or replace function public.tg_set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists sessions_set_updated_at on public.sessions;
create trigger sessions_set_updated_at
  before update on public.sessions
  for each row
  execute function public.tg_set_updated_at();

alter table public.sessions enable row level security;

-- Read-only-own-row policy. There is deliberately no insert/update/delete
-- policy for anon or authenticated: every write to this table goes through
-- a service-role API route that independently verifies the caller's JWT
-- before ever touching user_id (Stage 2+). service_role bypasses RLS
-- entirely (Postgres role property), so this table's write surface can
-- grow later (new API routes) without ever needing to loosen this policy.
create policy "sessions_select_own"
  on public.sessions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Defense in depth beyond RLS: explicitly strip table-level write grants
-- from the browser-facing roles so a future missing/misconfigured RLS
-- policy could not be silently compensated for by a leftover default
-- grant. Only SELECT is granted to authenticated (required so the Data
-- API can expose read access at all -- RLS still governs which rows).
revoke all on public.sessions from anon, authenticated;
grant select on public.sessions to authenticated;
