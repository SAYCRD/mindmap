-- Stage 1 (session-persistence-audit): bookmarks table.
-- Review-only migration. Do NOT apply to any database until explicitly approved.
--
-- Bookmarks are today's hold-to-save gesture in BookmarkableCard /
-- UnderneathItem, written directly to localStorage with no cap (an
-- unbounded-growth risk noted in the pre-design gap check). The server
-- table adds an explicit length cap for new writes and pagination for
-- reads -- legacy content is still preserved in full (see the
-- migration_source exemption below).

create table if not exists public.bookmarks (
  id uuid primary key default gen_random_uuid(),

  user_id uuid not null references auth.users(id) on delete restrict,

  -- A bookmark can outlive the session it came from -- on delete set null,
  -- not cascade.
  session_id uuid references public.sessions(id) on delete set null,

  -- Was unbounded client-side; new writes are now explicitly capped at
  -- 2000 chars. Migrated rows are exempt so a legacy bookmark of any
  -- length is preserved verbatim, only flagged via needs_normalization.
  text text not null
    check (migration_source is not null or char_length(text) <= 2000),

  label text,

  migration_source text
    check (migration_source in ('guest_migration', 'authenticated_local_migration')),
  needs_normalization boolean not null default false,

  created_at timestamptz not null default now()
);

comment on table public.bookmarks is
  'User-saved bookmarks (hold-to-save gesture). Live writes capped at 2000 chars; migrated legacy rows are exempt and preserved in full.';

create index if not exists idx_bookmarks_user_created
  on public.bookmarks (user_id, created_at desc);

alter table public.bookmarks enable row level security;

-- Access model: server-API-only, matching sessions above. Browser roles
-- get no table grant at all; this policy is inert unless a later,
-- separately-reviewed migration deliberately grants authenticated SELECT.
drop policy if exists "bookmarks_select_own" on public.bookmarks;
create policy "bookmarks_select_own"
  on public.bookmarks
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

-- service_role gets select/insert/delete (a user can remove a bookmark
-- they saved) -- no update, since bookmarks are immutable once saved.
--
-- service_role is included in the revoke below (not just
-- public/anon/authenticated): this schema's ALTER DEFAULT PRIVILEGES
-- entry auto-grants full CRUD to service_role on every new table
-- (existing production behavior, unmodified here), so without this
-- explicit revoke the "no update" intent above would be silently
-- undermined by that inherited default grant.
revoke all on public.bookmarks from public, anon, authenticated, service_role;
grant select, insert, delete on public.bookmarks to service_role;
