-- Stage 1 (session-persistence-audit): captures table.
-- Review-only migration. Do NOT apply to any database until explicitly approved.
--
-- Captures are user-saved excerpts (today: localStorage "saveCapture()",
-- capped at 100 client-side purely as a storage-size guard). The server
-- table has no row cap -- pagination replaces truncation once the
-- authenticated read path exists (Stage 4+).

create table if not exists public.captures (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete restrict,

  -- A capture can outlive the session it came from -- on delete set null,
  -- not cascade, so deleting/soft-handling a session never destroys a
  -- capture the user explicitly saved.
  session_id uuid references public.sessions(id) on delete set null,

  -- Live writes are capped at 300 chars (matches today's client-side cap).
  -- Migrated rows are exempt so legacy content is never truncated.
  text text not null
    check (migration_source is not null or char_length(text) <= 300),

  note text
    check (migration_source is not null or note is null or char_length(note) <= 800),

  source text not null default 'report',

  migration_source text
    check (migration_source in ('guest_migration', 'authenticated_local_migration')),
  needs_normalization boolean not null default false,

  created_at timestamptz not null default now()
);

comment on table public.captures is
  'User-saved excerpts. No row cap at the DB layer -- list reads are paginated, not truncated.';

create index if not exists idx_captures_user_created
  on public.captures (user_id, created_at desc);

alter table public.captures enable row level security;

drop policy if exists "captures_select_own" on public.captures;
create policy "captures_select_own"
  on public.captures
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.captures from anon, authenticated;
grant select on public.captures to authenticated;
