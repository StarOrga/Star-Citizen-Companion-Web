-- HQ (beta) - fleet patch lines for the Start hero (plan section 3.7, D8/D44).
--
-- hq_fleet_patch() diffs the numeric stats of the caller's own ships and set parts between
-- the CURRENT codex build and the build before it (same channel) and returns at most two
-- lines (category / effect / affected set). Empty `lines` = nothing relevant -> the UI hides
-- the patch lines.
--
-- Schema verified from the migrations (comments can be stale - re-check with SQL on the
-- cloud DB before relying on it): codex_builds(id, channel, patch_version, is_current,
-- created_at); codex_ships / codex_weapons / codex_components / codex_items each have
-- (build_id, class_name, payload jsonb). Hangar side: hangar_ships.ship_class_name,
-- hangar_ship_configs.loadout [{className}], hangar_role_loadouts.items [{className}].
--
-- DESIGN CHOICES
--   * SECURITY INVOKER (plan said DEFINER): hangar_* are RLS self-only and codex_* are
--     readable by any authenticated user, so invoker sees exactly the caller's data with
--     no auth.uid() plumbing to get wrong. anon gets no EXECUTE.
--   * Timeout (authenticated = 8 s): every payload is read ONCE per row and flattened by
--     hq_flatten_numeric() into (path, value) pairs in a MATERIALIZED CTE; entities are
--     limited to 60 distinct class names; arrays are not descended into (itemPorts and
--     defaultLoadout lists are the bulk of a ship payload). No jsonb_extract per field.
--   * No hq_patch_cache table: the plan only wants it when the call costs > 300 ms. It
--     cannot be measured from a migration; add the cache in a follow-up if the live
--     measurement (as `authenticated`, in a rolled-back transaction) says so.
--   * Noise paths (ids, guids, hashes, versions, ordering) are ignored; changes below 1 %
--     are ignored. One line per entity, strongest relative change first.
--
-- Alpha-phase data policy: purely additive.

create or replace function public.hq_flatten_numeric(j jsonb, prefix text default '', depth integer default 0)
returns table (path text, val numeric)
language plpgsql
immutable
set search_path = ''
as $$
declare
  k text;
  v jsonb;
begin
  if jsonb_typeof(j) <> 'object' or depth > 3 then
    return;
  end if;
  for k, v in select * from jsonb_each(j) loop
    if jsonb_typeof(v) = 'number' then
      path := case when prefix = '' then k else prefix || '.' || k end;
      val := (v #>> '{}')::numeric;
      return next;
    elsif jsonb_typeof(v) = 'object' then
      return query select * from public.hq_flatten_numeric(v, case when prefix = '' then k else prefix || '.' || k end, depth + 1);
    end if;
  end loop;
end;
$$;

revoke all on function public.hq_flatten_numeric(jsonb, text, integer) from public, anon;
grant execute on function public.hq_flatten_numeric(jsonb, text, integer) to authenticated;

create or replace function public.hq_fleet_patch()
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  cur  record;
  prev record;
  result jsonb;
begin
  -- Newest current build, LIVE preferred; the previous build of the same channel.
  select b.id, b.channel, b.patch_version, b.created_at into cur
    from public.codex_builds b
   where b.is_current
   order by (b.channel = 'LIVE') desc, b.created_at desc
   limit 1;
  if cur.id is null then
    return jsonb_build_object('build', null, 'previous', null, 'lines', '[]'::jsonb);
  end if;

  select b.id, b.patch_version into prev
    from public.codex_builds b
   where b.channel = cur.channel and b.id <> cur.id and b.created_at < cur.created_at
   order by b.created_at desc
   limit 1;
  if prev.id is null or prev.patch_version = cur.patch_version then
    return jsonb_build_object('build', cur.patch_version, 'previous', null, 'lines', '[]'::jsonb);
  end if;

  with owned as materialized (
    -- (class_name, kind, set) of everything the user owns / put into a set
    select s.ship_class_name as class_name, 'ship'::text as entity_kind,
           null::text as set_kind, null::uuid as set_id, s.custom_name as set_name
      from public.hangar_ships s
     where s.status = 'owned'
    union all
    select e.value ->> 'className', 'part', 'ship', c.id, c.name
      from public.hangar_ship_configs c
      cross join lateral jsonb_array_elements(c.loadout) e
     where e.value ->> 'className' is not null
    union all
    select e.value ->> 'className', 'part', 'fps', l.id, l.name
      from public.hangar_role_loadouts l
      cross join lateral jsonb_array_elements(l.items) e
     where e.value ->> 'className' is not null
  ),
  wanted as materialized (
    select distinct o.class_name from owned o limit 60
  ),
  rows_cur as materialized (
    select x.class_name, x.payload from (
      select class_name, payload from public.codex_ships      where build_id = cur.id
      union all
      select class_name, payload from public.codex_weapons    where build_id = cur.id
      union all
      select class_name, payload from public.codex_components where build_id = cur.id
      union all
      select class_name, payload from public.codex_items      where build_id = cur.id
    ) x join wanted w on w.class_name = x.class_name
  ),
  rows_prev as materialized (
    select x.class_name, x.payload from (
      select class_name, payload from public.codex_ships      where build_id = prev.id
      union all
      select class_name, payload from public.codex_weapons    where build_id = prev.id
      union all
      select class_name, payload from public.codex_components where build_id = prev.id
      union all
      select class_name, payload from public.codex_items      where build_id = prev.id
    ) x join wanted w on w.class_name = x.class_name
  ),
  flat_cur as materialized (
    select r.class_name, f.path, f.val
      from rows_cur r, lateral public.hq_flatten_numeric(r.payload) f
  ),
  flat_prev as materialized (
    select r.class_name, f.path, f.val
      from rows_prev r, lateral public.hq_flatten_numeric(r.payload) f
  ),
  diffs as materialized (
    select c.class_name, c.path, p.val as old_val, c.val as new_val,
           (c.val - p.val) / p.val as pct
      from flat_cur c
      join flat_prev p on p.class_name = c.class_name and p.path = c.path
     where p.val <> 0
       and c.val <> p.val
       and abs((c.val - p.val) / p.val) >= 0.01
       and c.path !~* '(^|\.)(id|guid|hash|version|index|order|sort|seed|crc)([._]|$)'
  ),
  best as (
    select distinct on (d.class_name) d.*
      from diffs d
     order by d.class_name, abs(d.pct) desc, d.path
  ),
  top2 as (
    select b.*, row_number() over (order by abs(b.pct) desc, b.class_name) as rn
      from best b
  )
  select coalesce(jsonb_agg(
           jsonb_build_object(
             'class_name', t.class_name,
             'entity_kind', o.entity_kind,
             'category', split_part(t.path, '.', 1),
             'path', t.path,
             'old', t.old_val,
             'new', t.new_val,
             'pct', round(t.pct * 100, 1),
             'set_kind', o.set_kind,
             'set_id', o.set_id,
             'set_name', o.set_name)
           order by t.rn), '[]'::jsonb)
    into result
    from top2 t
    cross join lateral (
      -- the most relevant owner of the class: a ship itself first, else any set that uses it
      select ow.entity_kind, ow.set_kind, ow.set_id, ow.set_name
        from owned ow
       where ow.class_name = t.class_name
       order by (ow.entity_kind = 'ship') desc, ow.set_name nulls last
       limit 1
    ) o
   where t.rn <= 2;

  return jsonb_build_object('build', cur.patch_version, 'previous', prev.patch_version, 'lines', coalesce(result, '[]'::jsonb));
end;
$$;

revoke all on function public.hq_fleet_patch() from public, anon;
grant execute on function public.hq_fleet_patch() to authenticated;

comment on function public.hq_fleet_patch() is
  'Patch lines for the HQ Start hero: strongest numeric stat change (>= 1 %) between the current and previous codex build for the '
  'caller''s ships and set parts, max 2 lines. Returns {build, previous, lines:[{class_name, entity_kind, category, path, old, new, pct, '
  'set_kind, set_id, set_name}]}; lines = [] when nothing relevant. SECURITY INVOKER (RLS self-only hangar + authenticated codex read).';
