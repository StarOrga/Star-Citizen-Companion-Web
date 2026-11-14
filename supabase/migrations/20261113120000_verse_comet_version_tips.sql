-- Comet tips on concrete x.y.z patches (4.4.1, 4.4.2 ...), not only on x.y lines.
--
-- Data sources (verified, nothing invented):
--   * patch_versions (live / ptu / eptu)  - the current x.y.z per channel
--   * patch_channel_builds (hotfix)       - every hotfix build with started_at = the day
--                                           it went LIVE (Spectrum Hotfix Central thread)
--   * verse_patch_announcements           - patch_line is free text <= 32 chars, so an
--                                           admin can record an official date for '4.4.2'
-- Target = the PTU/EPTU build on the LIVE line with z >= 1 that is newer than LIVE, else
-- LIVE + 1 patch (4.4.1 -> 4.4.2; LIVE 4.4 or 4.4.0 -> 4.4.1). Same inference the line
-- comet makes (LIVE + 1 minor). x.y.0 stays the existing line comet.
--
-- Design: a SEPARATE table + new RPCs instead of widening patch_prediction. The old
-- explorer_state(), median RPC, comet star trigger and the pgTAP suite read
-- patch_prediction by patch_line and would mix version tips into line tips. So:
--   * existing line tips are untouched (they stay the tip for the line's x.y.0);
--   * verse_explorer_state() / verse_submit_prediction() are NOT changed, which keeps
--     the deployed client working with zero compatibility window;
--   * the new client calls verse_comet_version_state() / verse_submit_version_prediction()
--     and degrades to the line comet when they do not exist yet (PGRST202).
-- No star for version tips (the 'comet' star is once per line, earned by the line tip).
-- "The day" = a calendar date; LIVE moments compare as UTC dates, current_date is the
-- database clock (UTC on Supabase), same as the line comet.
-- Alpha policy: new table, nothing dropped.
-- ROLLBACK: drop function verse_submit_version_prediction(text, date);
--           drop function verse_comet_version_state(); drop function verse_comet_version_lock(text);
--           drop function verse_comet_version_info(); drop table verse_patch_version_tips;

create table if not exists public.verse_patch_version_tips (
  user_id             uuid        not null references auth.users (id) on delete cascade default auth.uid(),
  patch_version       text        not null check (patch_version ~ '^[0-9]{1,2}\.[0-9]{1,2}\.[1-9][0-9]?$'),
  predicted_live_date date        not null,
  created_at          timestamptz not null default now(),
  primary key (user_id, patch_version)   -- one tip per user per patch, insert-only
);

alter table public.verse_patch_version_tips enable row level security;
revoke all on public.verse_patch_version_tips from anon, authenticated;
grant select on public.verse_patch_version_tips to authenticated;
-- No insert grant: tips go through verse_submit_version_prediction (lock + target checks).
drop policy if exists verse_patch_version_tips_own_select on public.verse_patch_version_tips;
create policy verse_patch_version_tips_own_select on public.verse_patch_version_tips
  for select to authenticated using (user_id = (select auth.uid()));

-- {live, target}: LIVE x.y.z = highest of patch_versions(live) and started hotfix builds
-- (a bare x.y counts as x.y.0); target as described above.
create or replace function public.verse_comet_version_info()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  l record;
  v_z int;
  v_target text;
begin
  select q.ma, q.mi, q.z into l
    from (
      select split_part(m[1], '.', 1)::int as ma, split_part(m[1], '.', 2)::int as mi,
             coalesce(nullif(split_part(m[1], '.', 3), ''), '0')::int as z
        from (select regexp_match(v.version, '^([0-9]{1,2}\.[0-9]{1,2}(?:\.[0-9]{1,2})?)') as m
                from public.patch_versions v where v.channel = 'live') a
       where m is not null
      union all
      select split_part(m[1], '.', 1)::int, split_part(m[1], '.', 2)::int,
             coalesce(nullif(split_part(m[1], '.', 3), ''), '0')::int
        from (select regexp_match(b.version, '^([0-9]{1,2}\.[0-9]{1,2}(?:\.[0-9]{1,2})?)') as m
                from public.patch_channel_builds b
               where b.channel = 'hotfix' and b.started_at <= now()) c
       where m is not null
    ) q
   order by q.ma desc, q.mi desc, q.z desc
   limit 1;
  if l.ma is null then
    return jsonb_build_object('live', null, 'target', null);
  end if;

  -- A build in testing on the LIVE line (z >= 1) that is newer than LIVE.
  select split_part(a.m[1], '.', 3)::int into v_z
    from (select regexp_match(v.version, '^([0-9]{1,2}\.[0-9]{1,2}\.[1-9][0-9]?)') as m
            from public.patch_versions v where v.channel in ('ptu', 'eptu')) a
   where a.m is not null
     and split_part(a.m[1], '.', 1)::int = l.ma and split_part(a.m[1], '.', 2)::int = l.mi
     and split_part(a.m[1], '.', 3)::int > l.z
   order by 1
   limit 1;
  v_z := coalesce(v_z, l.z + 1);
  if v_z <= 99 then
    v_target := l.ma || '.' || l.mi || '.' || v_z;
  end if;
  return jsonb_build_object('live', l.ma || '.' || l.mi || '.' || l.z, 'target', v_target);
end;
$$;
revoke execute on function public.verse_comet_version_info() from public, anon, authenticated;

-- null = tip open; 'live' = LIVE already; 'announced' = official date recorded.
create or replace function public.verse_comet_version_lock(p_version text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_live text := public.verse_comet_version_info() ->> 'live';
begin
  if exists (select 1 from public.patch_channel_builds b
              where b.channel = 'hotfix' and b.version = p_version and b.started_at <= now())
     or exists (select 1 from public.patch_versions v
                 where v.channel = 'live' and v.version = p_version)
     or (v_live is not null
         and string_to_array(v_live, '.')::int[] >= string_to_array(p_version, '.')::int[]) then
    return 'live';
  end if;
  if exists (select 1 from public.verse_patch_announcements a where a.patch_line = p_version) then
    return 'announced';
  end if;
  return null;
end;
$$;
revoke execute on function public.verse_comet_version_lock(text) from public, anon, authenticated;

-- The caller's comet state for the target patch; patch_version null when nothing is known.
create or replace function public.verse_comet_version_state()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_info jsonb := public.verse_comet_version_info();
  v_target text := v_info ->> 'target';
  v_tip date;
  v_lock text;
  v_ann date;
begin
  if v_uid is null then
    return null;
  end if;
  if v_target is null then
    return jsonb_build_object('patch_version', null, 'patch_line', null, 'live_version', v_info ->> 'live', 'comet', null);
  end if;
  v_lock := public.verse_comet_version_lock(v_target);
  select t.predicted_live_date into v_tip
    from public.verse_patch_version_tips t where t.user_id = v_uid and t.patch_version = v_target;
  select a.live_date into v_ann from public.verse_patch_announcements a where a.patch_line = v_target;
  return jsonb_build_object(
    'patch_version', v_target,
    'patch_line', split_part(v_target, '.', 1) || '.' || split_part(v_target, '.', 2),
    'live_version', v_info ->> 'live',
    'comet', jsonb_build_object(
      'state', case when v_tip is not null then 'tipped' else 'none' end, -- the target is never LIVE yet
      'tipped_date', v_tip,
      'locked', v_lock is not null,
      'locked_reason', v_lock,
      'announced_date', v_ann));
end;
$$;
revoke execute on function public.verse_comet_version_state() from public, anon;
grant execute on function public.verse_comet_version_state() to authenticated;

create or replace function public.verse_submit_version_prediction(p_patch_version text, p_date date)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_inserted int;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if p_patch_version is null or p_patch_version !~ '^[0-9]{1,2}\.[0-9]{1,2}\.[1-9][0-9]?$' or p_date is null
     or p_patch_version is distinct from (public.verse_comet_version_info() ->> 'target') then
    raise exception 'comet_invalid' using errcode = '22023';
  end if;
  if public.verse_comet_version_lock(p_patch_version) is not null then
    raise exception 'comet_locked' using errcode = 'P0001';
  end if;
  if p_date < current_date then
    raise exception 'comet_date_past' using errcode = 'P0001';
  end if;
  insert into public.verse_patch_version_tips (user_id, patch_version, predicted_live_date)
  values (v_uid, p_patch_version, p_date)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  if v_inserted = 0 then
    raise exception 'comet_already_tipped' using errcode = 'P0001';
  end if;
  return jsonb_build_object('patch_version', p_patch_version, 'predicted_live_date', p_date);
end;
$$;
revoke execute on function public.verse_submit_version_prediction(text, date) from public, anon;
grant execute on function public.verse_submit_version_prediction(text, date) to authenticated;
