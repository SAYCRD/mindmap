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

-- Production already has two updated_at trigger functions
-- (public.update_updated_at(), public.set_updated_at()), but neither is
-- established by this repository's version-controlled migration history --
-- they exist only as undocumented production drift. A clean staging
-- environment applying just these migrations must not depend on state that
-- isn't captured in this repo, so Stage 1 owns a single, uniquely named
-- trigger function instead of reusing either production function or
-- replacing/modifying them. This function is created here, before any
-- trigger references it, and is used only by the new Blindspot content
-- tables (sessions, reports) added in this Stage.
create or replace function public.blindspot_content_set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

comment on function public.blindspot_content_set_updated_at() is
  'Stage 1 (session-persistence-audit)-owned updated_at trigger function. Used only by sessions/reports. Does not replace or modify public.update_updated_at() or public.set_updated_at(), both pre-existing production functions outside this migration history.';

-- No execute grant to anon/authenticated: trigger functions are invoked by
-- the database engine itself when firing a trigger, never called directly
-- by a client role, so browser-facing roles receive no execute permission
-- on this function at all.
revoke all on function public.blindspot_content_set_updated_at() from public, anon, authenticated;

drop trigger if exists sessions_set_updated_at on public.sessions;
create trigger sessions_set_updated_at
  before update on public.sessions
  for each row
  execute function public.blindspot_content_set_updated_at();

alter table public.sessions enable row level security;

-- Access model: server-API-only. Every read and write to sessions goes
-- through a JWT-verified, service-role API route (Stage 2+) that derives
-- user_id from the verified JWT and never accepts it from the request
-- body. Browser roles (anon, authenticated) receive NO table grant at
-- all -- not even SELECT -- so the Supabase Data API cannot reach this
-- table directly regardless of RLS policy state.
--
-- The own-row SELECT policy below is kept only as defense-in-depth and as
-- a documented option for a possible FUTURE direct-authenticated-read
-- feature. It is currently inert: without a table-level GRANT,
-- `authenticated` cannot execute a SELECT against this table at all, so
-- this policy has no practical effect unless a later, separately-reviewed
-- migration deliberately adds `grant select on public.sessions to
-- authenticated`.
drop policy if exists "sessions_select_own" on public.sessions;
create policy "sessions_select_own"
  on public.sessions
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- Explicit privilege model -- no role is left to "implicit" behavior:
--   - PUBLIC / anon / authenticated: all privileges revoked. Neither can
--     read nor write this table under any circumstance.
--   - service_role: this schema has an ALTER DEFAULT PRIVILEGES entry that
--     auto-grants full CRUD to service_role on every newly created table
--     (existing production behavior, not modified by this migration).
--     Revoking from just public/anon/authenticated would leave that
--     default-privilege grant untouched underneath, so service_role is
--     included in the revoke below first, then re-granted exactly the
--     privileges its API routes need (select/insert/update/delete --
--     delete supports the future staged account-deletion flow). This
--     guarantees the table's effective service_role privileges are
--     exactly what is granted here, never a wider set inherited silently
--     from the schema default.
revoke all on public.sessions from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.sessions to service_role;
