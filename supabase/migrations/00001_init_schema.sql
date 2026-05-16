-- Initial schema: profiles, p4k_uploads, RLS, storage bucket policies
-- Applied via Supabase MCP on 2026-05-17.

-- ============================================================
-- profiles
-- ============================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  rsi_handle text,
  preferred_channel text check (preferred_channel in ('live','ptu','eptu','tech-preview')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

create policy "profiles_self_read" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_self_upsert" on public.profiles
  for insert with check (auth.uid() = id);
create policy "profiles_self_update" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, split_part(new.email, '@', 1))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================
-- p4k_uploads
-- ============================================================
create type public.p4k_channel as enum ('live','ptu','eptu','tech-preview','unknown');
create type public.p4k_status  as enum ('pending','processing','done','failed');

create table public.p4k_uploads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  storage_path text not null,
  original_name text not null,
  size_bytes bigint not null,
  detected_channel public.p4k_channel not null default 'unknown',
  detected_version text,
  uploaded_at timestamptz not null default now(),
  processed_at timestamptz,
  status public.p4k_status not null default 'pending',
  result jsonb,
  error text
);

create index p4k_uploads_user_uploaded_idx on public.p4k_uploads (user_id, uploaded_at desc);
create index p4k_uploads_status_idx on public.p4k_uploads (status) where status in ('pending','processing');

alter table public.p4k_uploads enable row level security;

create policy "p4k_uploads_owner_select" on public.p4k_uploads
  for select using (auth.uid() = user_id);
create policy "p4k_uploads_owner_insert" on public.p4k_uploads
  for insert with check (auth.uid() = user_id);
create policy "p4k_uploads_owner_delete" on public.p4k_uploads
  for delete using (auth.uid() = user_id);

-- ============================================================
-- updated_at trigger helper
-- ============================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();
