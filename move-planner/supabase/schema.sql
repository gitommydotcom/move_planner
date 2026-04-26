-- =====================================================
-- Move Editorial Planner — Supabase schema
-- Run once in: Supabase Dashboard → SQL Editor → New query
-- =====================================================

-- One row per user. All app data lives here as JSONB.
create table if not exists public.user_data (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  clients     jsonb not null default '[]'::jsonb,
  history     jsonb not null default '[]'::jsonb,
  settings    jsonb not null default '{}'::jsonb,
  meta_cache  jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- RLS: users can only read/write their own row.
alter table public.user_data enable row level security;

drop policy if exists "user_data_select_own" on public.user_data;
create policy "user_data_select_own" on public.user_data
  for select using (auth.uid() = user_id);

drop policy if exists "user_data_insert_own" on public.user_data;
create policy "user_data_insert_own" on public.user_data
  for insert with check (auth.uid() = user_id);

drop policy if exists "user_data_update_own" on public.user_data;
create policy "user_data_update_own" on public.user_data
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "user_data_delete_own" on public.user_data;
create policy "user_data_delete_own" on public.user_data
  for delete using (auth.uid() = user_id);

-- Touch updated_at on every UPDATE.
create or replace function public.touch_user_data_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_user_data_updated_at on public.user_data;
create trigger trg_user_data_updated_at
  before update on public.user_data
  for each row execute function public.touch_user_data_updated_at();
