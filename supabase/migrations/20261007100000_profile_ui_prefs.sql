-- ============================================================
-- 20261007100000_profile_ui_prefs.sql
-- Account-wide UI preferences (`profiles.ui_prefs`).
--
-- Small view choices a user expects to follow them from browser to browser
-- (first one: the Holodeck "Einordnung" comparison group — all ships / career /
-- role). Until now such choices lived in localStorage only, so a second device
-- or a cleared browser forgot them. One jsonb map instead of a column per
-- toggle: the keys are owned by the client, and a new toggle must not need a
-- migration.
--
-- Write path is the SECURITY DEFINER RPC `set_ui_pref(pref_key, pref_value)`,
-- which merges ONE key into the caller's own map (a client never rewrites the
-- whole object, so two tabs setting different keys cannot clobber each other).
-- A null value removes the key. Shape + size checks keep it a preference map,
-- not a storage bucket: key `^[a-z][a-zA-Z0-9._-]{0,63}$`, value <= 1 kB,
-- whole map <= 16 kB.
--
-- RLS: unchanged. `profiles_self_read` (00001) covers self-select of the new
-- column; the RPC is the intended write path. `profiles_self_update` would
-- also allow a raw PATCH of the caller's own map — harmless, the column holds
-- nothing but the caller's own view settings, and the CHECK still applies.
--
-- ADDITIVE: this migration drops and renames nothing.
-- ROLLBACK: drop function if exists public.set_ui_pref(text, jsonb);
--           alter table public.profiles drop column if exists ui_prefs;
-- ============================================================

alter table public.profiles
  add column if not exists ui_prefs jsonb not null default '{}'::jsonb;

alter table public.profiles
  drop constraint if exists profiles_ui_prefs_check;

alter table public.profiles
  add constraint profiles_ui_prefs_check
    check (jsonb_typeof(ui_prefs) = 'object' and pg_column_size(ui_prefs) <= 16384);

comment on column public.profiles.ui_prefs is
  'Account-wide UI view preferences, key -> JSON value (e.g. "codex.rankScope": "career"). '
  'Written via set_ui_pref(); keys are owned by the client.';

-- ============================================================
-- RPC — set_ui_pref
-- ============================================================
create or replace function public.set_ui_pref(pref_key text, pref_value jsonb)
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

  if pref_key is null or pref_key !~ '^[a-z][a-zA-Z0-9._-]{0,63}$' then
    raise exception 'ui_pref_key_invalid' using errcode = '22023';
  end if;

  if pref_value is not null and pg_column_size(pref_value) > 1024 then
    raise exception 'ui_pref_value_too_large' using errcode = '22023';
  end if;

  update public.profiles
  set ui_prefs = case
    when pref_value is null or pref_value = 'null'::jsonb then ui_prefs - pref_key
    else ui_prefs || jsonb_build_object(pref_key, pref_value)
  end
  where id = caller;
end;
$$;

revoke all on function public.set_ui_pref(text, jsonb) from public;
grant execute on function public.set_ui_pref(text, jsonb) to authenticated;

comment on function public.set_ui_pref(text, jsonb) is
  'Sets (or, with null, removes) one key of the caller''s profiles.ui_prefs map.';
