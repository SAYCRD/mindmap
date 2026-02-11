-- SAYCRD Database Schema for Supabase
-- Run this in the Supabase SQL Editor

-- ═══════════════════════════════════════
-- User data store (replaces window.storage)
-- ═══════════════════════════════════════
create table if not exists user_data (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  key text not null,
  value jsonb not null,
  updated_at timestamptz default now() not null,
  unique(user_id, key)
);

-- Index for fast lookups
create index if not exists idx_user_data_user_key on user_data(user_id, key);
create index if not exists idx_user_data_user_prefix on user_data(user_id, key text_pattern_ops);

-- ═══════════════════════════════════════
-- Row Level Security — users only see their own data
-- ═══════════════════════════════════════
alter table user_data enable row level security;

create policy "Users can read own data"
  on user_data for select
  using (auth.uid() = user_id);

create policy "Users can insert own data"
  on user_data for insert
  with check (auth.uid() = user_id);

create policy "Users can update own data"
  on user_data for update
  using (auth.uid() = user_id);

create policy "Users can delete own data"
  on user_data for delete
  using (auth.uid() = user_id);

-- ═══════════════════════════════════════
-- Auto-update timestamp
-- ═══════════════════════════════════════
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger user_data_updated_at
  before update on user_data
  for each row execute function update_updated_at();

-- ═══════════════════════════════════════
-- Optional: user profiles (for future features)
-- ═══════════════════════════════════════
create table if not exists profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  display_name text,
  created_at timestamptz default now() not null
);

alter table profiles enable row level security;

create policy "Users can read own profile"
  on profiles for select
  using (auth.uid() = id);

create policy "Users can update own profile"
  on profiles for update
  using (auth.uid() = id);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
