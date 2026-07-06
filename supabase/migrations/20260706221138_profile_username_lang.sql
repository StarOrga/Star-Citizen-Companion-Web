-- ============================================================
-- 20260706120000_profile_username_lang.sql
-- Adds a user-chosen unique handle (`username`) and an explicit
-- language preference (`preferred_lang`) to profiles.
--
-- `username` uses `citext` for case-insensitive uniqueness ("Jerry" and
-- "jerry" collide) instead of a `lower(username)` functional unique index.
-- citext is not used elsewhere in this schema yet, but it is the cleaner
-- primitive here: comparisons, ORDER BY, and the RPC's uniqueness check all
-- behave case-insensitively for free, and Postgrest/pg still reports it back
-- to clients as plain text. Nullable — existing users keep username = NULL
-- until they opt in via set_username().
--
-- `preferred_lang` mirrors the app's ngx-translate locales (de/en/fr/es/pt/
-- ru/zh). NULL means "no explicit preference, fall back to browser/app
-- default" — enforced by a CHECK constraint rather than an enum type to
-- keep it cheap to extend later without an ALTER TYPE migration.
--
-- Two new SECURITY DEFINER RPCs (set_username, set_preferred_lang) are the
-- only write path — profiles_self_update from 00001 would technically also
-- allow a direct UPDATE, but the RPCs centralize format/uniqueness
-- validation so the app should always go through them.
--
-- RLS: profiles_self_read (00001) already covers self-select of all
-- columns including the two new ones — no policy changes needed.
--
-- list_users_for_admin (00003) is replaced here to also project `username`
-- for the admin table (display_name is kept unchanged).
--
-- ADDITIVE: this migration drops nothing.
-- ============================================================

create extension if not exists citext;

alter table public.profiles
  add column if not exists username citext,
  add column if not exists preferred_lang text;

alter table public.profiles
  add constraint profiles_username_unique unique (username);

alter table public.profiles
  add constraint profiles_preferred_lang_check
    check (preferred_lang is null or preferred_lang in ('de','en','fr','es','pt','ru','zh'));

comment on column public.profiles.username is
  'Case-insensitive unique handle chosen by the user via set_username(). NULL until set.';
comment on column public.profiles.preferred_lang is
  'Explicit UI language preference (de/en/fr/es/pt/ru/zh) set via set_preferred_lang(). NULL = no preference, use app default.';

-- ============================================================
-- RPC — set_username
-- ============================================================
create or replace function public.set_username(new_name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  normalized citext := new_name;
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if new_name is null or new_name !~* '^[a-z0-9_]{3,20}$' then
    raise exception 'username_invalid' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.profiles
    where username = normalized
      and id <> caller
  ) then
    raise exception 'username_taken' using errcode = '23505';
  end if;

  update public.profiles
  set username = normalized
  where id = caller;
end;
$$;

grant execute on function public.set_username(text) to authenticated;

-- ============================================================
-- RPC — set_preferred_lang
-- ============================================================
create or replace function public.set_preferred_lang(lang text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if lang is not null and lang not in ('de','en','fr','es','pt','ru','zh') then
    raise exception 'preferred_lang_invalid' using errcode = '22023';
  end if;

  update public.profiles
  set preferred_lang = lang
  where id = caller;
end;
$$;

grant execute on function public.set_preferred_lang(text) to authenticated;

-- ============================================================
-- list_users_for_admin — add `username` to the admin result set
-- ============================================================
-- DROP first: this function already exists (migration 00003) and we are
-- widening its RETURNS TABLE with `username`. Postgres rejects a return-type
-- change via CREATE OR REPLACE ("cannot change return type of existing
-- function, use DROP FUNCTION first"), so the replace alone would fail on
-- apply. Argument list is unchanged (no args), so the drop is unambiguous.
drop function if exists public.list_users_for_admin();

create or replace function public.list_users_for_admin()
returns table (
  id uuid,
  email text,
  display_name text,
  username citext,
  role text,
  created_at timestamptz,
  last_sign_in_at timestamptz
)
language sql security definer set search_path = public stable as $$
  select p.id, u.email, p.display_name, p.username, p.role, p.created_at, u.last_sign_in_at
  from public.profiles p
  join auth.users u on u.id = p.id
  where public.is_admin()
  order by
    case p.role when 'admin' then 0 when 'collaborator' then 1 else 2 end,
    p.created_at desc
$$;

grant execute on function public.list_users_for_admin() to authenticated;
