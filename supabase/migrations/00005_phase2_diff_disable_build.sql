-- 00005 · Phase 2 — Build-Number-Separierung, Disable-Flag, Diff-Summary, History-RPC-Update
-- Spec: docs/concepts/2026-05-23-p4k-phase-2-domain-logic.html § E + Abschlussbericht

-- ============================================================
-- Extend p4k_bundles
-- ============================================================
alter table public.p4k_bundles
  add column if not exists build_number text not null default '',
  add column if not exists disabled boolean not null default false,
  add column if not exists disabled_reason text,
  add column if not exists disabled_by uuid references auth.users(id),
  add column if not exists disabled_at timestamptz,
  add column if not exists diff_summary jsonb;

-- Replace UNIQUE-Constraint: include build_number
do $$
begin
  if exists (
    select 1 from pg_constraint
    where conname = 'p4k_bundles_channel_patch_version_uploaded_by_key'
  ) then
    alter table public.p4k_bundles
      drop constraint p4k_bundles_channel_patch_version_uploaded_by_key;
  end if;
end $$;

alter table public.p4k_bundles
  add constraint p4k_bundles_channel_patch_build_uploader_key
  unique (channel, patch_version, build_number, uploaded_by);

create index if not exists p4k_bundles_active_idx
  on public.p4k_bundles (channel, patch_version, build_number, created_at desc)
  where disabled = false;

-- ============================================================
-- RPC: set_bundle_disabled (admin-only)
-- ============================================================
create or replace function public.set_bundle_disabled(
  bundle_id uuid,
  new_disabled boolean,
  reason text default null
)
returns void
language plpgsql security definer set search_path = public as $func$
begin
  if not public.is_admin() then
    raise exception 'forbidden: admin role required';
  end if;
  update public.p4k_bundles
  set disabled = new_disabled,
      disabled_reason = case when new_disabled then reason else null end,
      disabled_by = case when new_disabled then auth.uid() else null end,
      disabled_at = case when new_disabled then now() else null end
  where id = bundle_id;
end;
$func$;

grant execute on function public.set_bundle_disabled(uuid, boolean, text) to authenticated;

-- ============================================================
-- Pure SQL function: diff_bundle
-- ============================================================
create or replace function public.diff_bundle(
  prev_id uuid,
  new_id uuid
)
returns jsonb
language sql security definer set search_path = public stable as $func$
  with prev as (
    select entity_counts, manifest from public.p4k_bundles where id = prev_id
  ),
  new as (
    select entity_counts, manifest from public.p4k_bundles where id = new_id
  )
  select jsonb_build_object(
    'prev_id', prev_id,
    'new_id', new_id,
    'count_diffs', (
      select jsonb_object_agg(key, jsonb_build_object(
        'prev', coalesce((prev.entity_counts->>key)::numeric, 0),
        'new',  coalesce((new.entity_counts->>key)::numeric, 0),
        'delta',
          coalesce((new.entity_counts->>key)::numeric, 0) -
          coalesce((prev.entity_counts->>key)::numeric, 0)
      ))
      from prev, new,
        (select distinct key
         from jsonb_object_keys(prev.entity_counts) key
         union
         select distinct key
         from jsonb_object_keys(new.entity_counts) key
        ) keys
    ),
    'summary', jsonb_build_object(
      'entities_added', coalesce((
        select sum(greatest(
          coalesce((new.entity_counts->>key)::numeric, 0) -
          coalesce((prev.entity_counts->>key)::numeric, 0), 0))
        from prev, new,
          (select distinct key from jsonb_object_keys(prev.entity_counts) key
           union select distinct key from jsonb_object_keys(new.entity_counts) key) k(key)
      ), 0),
      'entities_removed', coalesce((
        select sum(greatest(
          coalesce((prev.entity_counts->>key)::numeric, 0) -
          coalesce((new.entity_counts->>key)::numeric, 0), 0))
        from prev, new,
          (select distinct key from jsonb_object_keys(prev.entity_counts) key
           union select distinct key from jsonb_object_keys(new.entity_counts) key) k(key)
      ), 0)
    )
  )
  from prev, new;
$func$;

grant execute on function public.diff_bundle(uuid, uuid) to authenticated;

-- ============================================================
-- Rewrite: list_p4k_bundles_for_collaborator — default-distinct, history-mode
-- ============================================================
create or replace function public.list_p4k_bundles_for_collaborator(
  include_history boolean default false,
  include_disabled boolean default false
)
returns table (
  id uuid,
  channel public.p4k_channel,
  patch_version text,
  build_number text,
  schema_version int,
  quality_score numeric,
  entity_counts jsonb,
  diff_summary jsonb,
  disabled boolean,
  disabled_reason text,
  tool_version text,
  uploaded_by_id uuid,
  uploaded_by_email text,
  uploaded_by_name text,
  created_at timestamptz
)
language sql security definer set search_path = public stable as $func$
  with filtered as (
    select b.*, u.email as ue, p.display_name as un
    from public.p4k_bundles b
    join auth.users u on u.id = b.uploaded_by
    left join public.profiles p on p.id = b.uploaded_by
    where public.is_collaborator()
      and (include_disabled or b.disabled = false)
  ),
  distinct_latest as (
    select distinct on (channel, patch_version, build_number) *
    from filtered
    order by channel, patch_version, build_number, created_at desc
  )
  select id, channel, patch_version, build_number, schema_version,
         quality_score, entity_counts, diff_summary, disabled, disabled_reason,
         tool_version, uploaded_by as uploaded_by_id,
         ue as uploaded_by_email, un as uploaded_by_name, created_at
  from (
    select * from filtered where include_history
    union all
    select * from distinct_latest where not include_history
  ) merged
  order by created_at desc
$func$;

grant execute on function public.list_p4k_bundles_for_collaborator(boolean, boolean) to authenticated;
