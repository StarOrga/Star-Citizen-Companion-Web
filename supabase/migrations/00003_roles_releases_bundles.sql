-- 00003 · Roles, desktop releases, p4k bundles, role-gated RLS
-- Phase 1 of the P4K Companion Desktop Tool concept.
-- Apply via: npm run db:push

-- ============================================================
-- profiles.role
-- ============================================================
do $$ begin
  alter table public.profiles
    add column if not exists role text not null default 'viewer'
      check (role in ('admin', 'collaborator', 'viewer'));
end $$;

create index if not exists profiles_role_idx on public.profiles (role) where role <> 'viewer';

-- ============================================================
-- Role helper functions (security definer, stable)
-- ============================================================
create or replace function public.current_user_role()
returns text language sql security definer set search_path = public stable as $$
  select coalesce((select role from public.profiles where id = auth.uid()), 'viewer');
$$;

create or replace function public.is_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select public.current_user_role() = 'admin';
$$;

create or replace function public.is_collaborator()
returns boolean language sql security definer set search_path = public stable as $$
  select public.current_user_role() in ('admin', 'collaborator');
$$;

-- ============================================================
-- Augment handle_new_user — seed Jeremy as admin on signup
-- ============================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name, role)
  values (
    new.id,
    split_part(new.email, '@', 1),
    case when lower(new.email) = 'jeremy.treder@gmail.com' then 'admin' else 'viewer' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- One-time seed if Jeremy already exists from a previous sign-up
update public.profiles p
set role = 'admin'
from auth.users u
where u.id = p.id
  and lower(u.email) = 'jeremy.treder@gmail.com'
  and p.role <> 'admin';

-- ============================================================
-- profiles RLS — admin can read/update everyone's profile
-- ============================================================
drop policy if exists "profiles_admin_read_all" on public.profiles;
create policy "profiles_admin_read_all" on public.profiles
  for select to authenticated using (public.is_admin());

drop policy if exists "profiles_admin_role_update" on public.profiles;
create policy "profiles_admin_role_update" on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- Admin RPC — list users (joins auth.users for email)
-- ============================================================
create or replace function public.list_users_for_admin()
returns table (
  id uuid,
  email text,
  display_name text,
  role text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select p.id, u.email, p.display_name, p.role, p.created_at, u.last_sign_in_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_admin()
  order by
    case p.role when 'admin' then 0 when 'collaborator' then 1 else 2 end,
    p.created_at desc
$$;

-- ============================================================
-- Admin RPC — set_user_role with last-admin guard
-- ============================================================
create or replace function public.set_user_role(target_id uuid, new_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required';
  end if;
  if new_role not in ('admin', 'collaborator', 'viewer') then
    raise exception 'invalid role: %', new_role;
  end if;
  -- Prevent demoting the last admin
  if new_role <> 'admin' and target_id in (
    select id from public.profiles where role = 'admin'
  ) then
    if (select count(*) from public.profiles where role = 'admin') = 1 then
      raise exception 'cannot demote the only admin';
    end if;
  end if;
  update public.profiles set role = new_role where id = target_id;
end;
$$;

-- ============================================================
-- desktop_releases — tracks published Desktop-Tool binaries
-- ============================================================
create table if not exists public.desktop_releases (
  id uuid primary key default gen_random_uuid(),
  version text not null,
  release_token uuid not null default gen_random_uuid(),
  platforms jsonb not null default '{}'::jsonb,
  notes text,
  is_current boolean not null default true,
  created_at timestamptz not null default now(),
  unique (version)
);

create index if not exists desktop_releases_token_idx on public.desktop_releases (release_token);
create index if not exists desktop_releases_current_idx on public.desktop_releases (is_current) where is_current;

-- Only one current release per version family — soft constraint via trigger
create or replace function public.dr_dedupe_current()
returns trigger language plpgsql as $$
begin
  if new.is_current then
    update public.desktop_releases set is_current = false
      where id <> new.id and is_current;
  end if;
  return new;
end;
$$;

drop trigger if exists desktop_releases_dedupe on public.desktop_releases;
create trigger desktop_releases_dedupe
  before insert or update of is_current on public.desktop_releases
  for each row execute function public.dr_dedupe_current();

alter table public.desktop_releases enable row level security;

drop policy if exists "desktop_releases_read_collab" on public.desktop_releases;
create policy "desktop_releases_read_collab" on public.desktop_releases
  for select to authenticated using (public.is_collaborator());

drop policy if exists "desktop_releases_write_admin" on public.desktop_releases;
create policy "desktop_releases_write_admin" on public.desktop_releases
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- ============================================================
-- p4k_bundles — vorverdaute JSON-Extracts (replaces the raw upload flow)
-- Alpha-phase: legacy raw p4k_uploads stays around but RLS is now collab-gated
-- ============================================================
create table if not exists public.p4k_bundles (
  id uuid primary key default gen_random_uuid(),
  uploaded_by uuid not null references auth.users(id) on delete cascade,
  channel public.p4k_channel not null,
  patch_version text not null,
  schema_version int not null default 1,
  quality_score numeric(5,2),
  entity_counts jsonb not null default '{}'::jsonb,
  manifest jsonb not null,
  data_url text,
  tool_version text,
  created_at timestamptz not null default now(),
  unique (channel, patch_version, uploaded_by)
);

create index if not exists p4k_bundles_channel_version_idx on public.p4k_bundles (channel, patch_version);
create index if not exists p4k_bundles_uploader_idx on public.p4k_bundles (uploaded_by, created_at desc);

alter table public.p4k_bundles enable row level security;

drop policy if exists "p4k_bundles_read_collab" on public.p4k_bundles;
create policy "p4k_bundles_read_collab" on public.p4k_bundles
  for select to authenticated using (public.is_collaborator());

drop policy if exists "p4k_bundles_write_collab" on public.p4k_bundles;
create policy "p4k_bundles_write_collab" on public.p4k_bundles
  for insert to authenticated
  with check (public.is_collaborator() and auth.uid() = uploaded_by);

drop policy if exists "p4k_bundles_delete_admin" on public.p4k_bundles;
create policy "p4k_bundles_delete_admin" on public.p4k_bundles
  for delete to authenticated
  using (public.is_admin());

-- Aggregate stats (public-readable for landing-page later, but no sensitive data)
create or replace view public.p4k_bundles_public_stats as
select
  channel,
  patch_version,
  max(quality_score) as best_quality_score,
  count(*) as bundle_count,
  max(created_at) as latest_at
from public.p4k_bundles
group by channel, patch_version;

-- ============================================================
-- p4k_uploads RLS — now collaborator-gated (drop legacy owner-only policies)
-- ============================================================
drop policy if exists "p4k_uploads_owner_select" on public.p4k_uploads;
drop policy if exists "p4k_uploads_owner_insert" on public.p4k_uploads;
drop policy if exists "p4k_uploads_owner_delete" on public.p4k_uploads;

create policy "p4k_uploads_collab_select" on public.p4k_uploads
  for select to authenticated using (public.is_collaborator());

create policy "p4k_uploads_collab_insert" on public.p4k_uploads
  for insert to authenticated
  with check (public.is_collaborator() and auth.uid() = user_id);

create policy "p4k_uploads_admin_delete" on public.p4k_uploads
  for delete to authenticated using (public.is_admin());

-- Storage bucket policies — collaborator-gate
drop policy if exists "p4k_owner_upload" on storage.objects;
drop policy if exists "p4k_owner_read" on storage.objects;
drop policy if exists "p4k_owner_delete" on storage.objects;

create policy "p4k_collab_upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'p4k-uploads'
    and (storage.foldername(name))[1] = auth.uid()::text
    and public.is_collaborator()
  );

create policy "p4k_collab_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'p4k-uploads'
    and public.is_collaborator()
  );

create policy "p4k_admin_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'p4k-uploads'
    and public.is_admin()
  );

-- ============================================================
-- Grant execute on RPCs to authenticated role
-- ============================================================
grant execute on function public.list_users_for_admin() to authenticated;
grant execute on function public.set_user_role(uuid, text) to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_collaborator() to authenticated;
grant execute on function public.current_user_role() to authenticated;
