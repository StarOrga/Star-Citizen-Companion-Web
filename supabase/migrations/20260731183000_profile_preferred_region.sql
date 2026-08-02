-- ============================================================
-- 20260731183000_profile_preferred_region.sql
-- Adds an explicit REGION preference (`preferred_region`) to profiles.
--
-- Language and region are two independent axes (admin feedback 38b3d25a):
-- `preferred_lang` (migration 20260706221138) already stores which translation
-- the user reads; the region decides how a date is ORDERED (31 / July / 2026
-- vs July / 31 / 2026) and whether the clock is 12- or 24-hour. A German
-- speaker living in the US wants the German UI with US date order, so the two
-- cannot share one column.
--
-- ISO 3166-1 alpha-2, uppercase. NULL = "no explicit preference" — the client
-- then resolves the region from browser signals (language-tag region subtag,
-- Intl locale, IANA time zone) and finally falls back to the app default.
-- Enforced by a CHECK on the shape rather than an enum/FK: the client owns the
-- curated picker list, and the shape check is what keeps junk out.
--
-- Write path is the SECURITY DEFINER RPC `set_preferred_region()`, mirroring
-- `set_preferred_lang()`.
--
-- RLS: unchanged. `profiles_self_read` (00001) already covers self-select of
-- all columns including this one, and the RPC is the write path — no new
-- policies needed.
--
-- ADDITIVE: this migration drops and renames nothing.
-- ============================================================

alter table public.profiles
  add column if not exists preferred_region text;

alter table public.profiles
  drop constraint if exists profiles_preferred_region_check;

alter table public.profiles
  add constraint profiles_preferred_region_check
    check (preferred_region is null or preferred_region ~ '^[A-Z]{2}$');

comment on column public.profiles.preferred_region is
  'Explicit region preference (ISO 3166-1 alpha-2, uppercase) set via set_preferred_region(). Decides date field order + clock convention. NULL = detect from the browser.';

-- ============================================================
-- RPC — set_preferred_region
-- ============================================================
create or replace function public.set_preferred_region(region text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  normalized text := nullif(upper(trim(region)), '');
begin
  if caller is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  if normalized is not null and normalized !~ '^[A-Z]{2}$' then
    raise exception 'preferred_region_invalid' using errcode = '22023';
  end if;

  update public.profiles
  set preferred_region = normalized
  where id = caller;
end;
$$;

grant execute on function public.set_preferred_region(text) to authenticated;
