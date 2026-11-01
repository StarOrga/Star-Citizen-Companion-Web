-- HQ (beta) - Einsaetze and their steps (plan section 3.2, D17-D19).
--
-- "Einsatz xN" in the UI is count(steps); the badge is computed client-side.
-- Alpha-phase data policy: nothing dropped - /hq/ops never had a table.
-- Reuses hq_sync_before_write() / hq_enforce_cap() from 20261101000000_hq_supplies.sql
-- (LWW + tombstones + caps), so hq_einsaetze syncs exactly like hq_supplies.
--
-- Steps are an ordered child list owned through their Einsatz: the client
-- rewrites the list together with it, so they carry no LWW columns of their own;
-- a soft-deleted Einsatz hides its steps by the join and the steps cascade away
-- when the Einsatz row is purged.

create table if not exists public.hq_einsaetze (
  user_id        uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  id             uuid        not null default gen_random_uuid(),
  title          text        not null,
  activity       text,
  status         text        not null default 'planned',
  planned_at     timestamptz,
  start_location text,
  deleted_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  synced_at      timestamptz not null default now(),
  primary key (id),
  -- Target of the composite FK from steps: a step can never point at another user's Einsatz.
  unique (user_id, id),

  constraint hq_einsaetze_title_len      check (char_length(btrim(title)) between 1 and 120),
  constraint hq_einsaetze_activity       check (activity is null or activity in
    ('kopfgeld', 'bunker', 'medizin', 'rennen', 'bergbau', 'fracht', 'bergung', 'erkunden', 'piraterie')),
  constraint hq_einsaetze_status         check (status in ('planned', 'active', 'done', 'archived')),
  constraint hq_einsaetze_location_len   check (start_location is null or char_length(start_location) <= 200)
);

comment on table public.hq_einsaetze is
  'HQ Einsaetze (planned activities). Private per user (owner-only RLS). activity = D19 codes (lowercase German slugs). '
  'Soft deletes via deleted_at; updated_at = client edit time (LWW), synced_at = server watermark.';

create index if not exists hq_einsaetze_user_status_idx on public.hq_einsaetze (user_id, status, planned_at);
create index if not exists hq_einsaetze_user_synced_idx on public.hq_einsaetze (user_id, synced_at);

drop trigger if exists hq_einsaetze_a_sync on public.hq_einsaetze;
create trigger hq_einsaetze_a_sync
  before insert or update on public.hq_einsaetze
  for each row execute function public.hq_sync_before_write();

-- Cap: 200 live Einsaetze, 600 incl. tombstones per user.
drop trigger if exists hq_einsaetze_b_cap on public.hq_einsaetze;
create trigger hq_einsaetze_b_cap
  before insert or update on public.hq_einsaetze
  for each row execute function public.hq_enforce_cap(200, 600);

create table if not exists public.hq_einsatz_steps (
  einsatz_id   uuid        not null,
  user_id      uuid        not null default auth.uid(),
  ord          integer     not null,
  kind         text        not null,
  label        text        not null,
  location     text,
  system       text,
  class_name   text,
  qty          integer,
  supply_id    text,
  mission_ref  text,
  state        text        not null default 'todo',
  done_at      timestamptz,
  done_by      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (einsatz_id, ord),
  foreign key (user_id, einsatz_id) references public.hq_einsaetze (user_id, id) on delete cascade,

  constraint hq_einsatz_steps_ord        check (ord between 0 and 99),
  constraint hq_einsatz_steps_kind       check (kind in
    ('buy', 'mission', 'mine', 'refine', 'craft', 'transport', 'pickup')),
  constraint hq_einsatz_steps_label_len  check (char_length(btrim(label)) between 1 and 160),
  constraint hq_einsatz_steps_text_len   check (
    (location is null or char_length(location) <= 200) and
    (system is null or char_length(system) <= 80) and
    (class_name is null or char_length(class_name) <= 200) and
    (supply_id is null or char_length(supply_id) <= 200) and
    (mission_ref is null or char_length(mission_ref) <= 200)),
  constraint hq_einsatz_steps_qty        check (qty is null or qty between 1 and 99999),
  constraint hq_einsatz_steps_state      check (state in ('todo', 'done')),
  constraint hq_einsatz_steps_done_by    check (done_by is null or done_by in ('user', 'live'))
);

comment on table public.hq_einsatz_steps is
  'Ordered steps of an Einsatz (kinds = D18 verbs). done_by=live means a SCC-App game-log event ticked it (undoable). '
  'Max 40 steps per Einsatz and 4000 per user.';
comment on column public.hq_einsatz_steps.supply_id is 'hq_supplies.id of the same user (soft reference).';

create index if not exists hq_einsatz_steps_user_idx on public.hq_einsatz_steps (user_id);

drop trigger if exists hq_einsatz_steps_updated_at on public.hq_einsatz_steps;
create trigger hq_einsatz_steps_updated_at before update on public.hq_einsatz_steps
  for each row execute function public.set_updated_at();

-- Cap: 40 steps per Einsatz, 4000 per user. Rows of tombstoned Einsaetze do not count
-- towards the user total (hq_einsaetze_c_drop_steps deletes them anyway).
-- `insert ... on conflict do update` fires BEFORE INSERT for the attempted row even when
-- (einsatz_id, ord) exists - that is an UPDATE, so it must not trip the caps.
create or replace function public.hq_einsatz_steps_enforce_cap()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('hq_einsatz_steps:' || new.user_id::text, 0));
  if exists (select 1 from public.hq_einsatz_steps
              where einsatz_id = new.einsatz_id and ord = new.ord) then
    return new;
  end if;
  if (select count(*) from public.hq_einsatz_steps where einsatz_id = new.einsatz_id) >= 40 then
    raise exception 'hq_einsatz_steps: at most 40 steps per Einsatz' using errcode = 'check_violation';
  end if;
  if (select count(*)
        from public.hq_einsatz_steps st
        join public.hq_einsaetze e on e.id = st.einsatz_id
       where st.user_id = new.user_id and e.deleted_at is null) >= 4000 then
    raise exception 'hq_einsatz_steps: step limit reached (4000)' using errcode = 'check_violation';
  end if;
  return new;
end;
$$;
revoke all on function public.hq_einsatz_steps_enforce_cap() from public, anon, authenticated;

drop trigger if exists hq_einsatz_steps_cap on public.hq_einsatz_steps;
create trigger hq_einsatz_steps_cap
  before insert on public.hq_einsatz_steps
  for each row execute function public.hq_einsatz_steps_enforce_cap();

-- A tombstoned Einsatz hides its steps by the join; drop them for good so they free their
-- cap slots. SECURITY INVOKER is enough: the owner's own RLS allows the delete.
create or replace function public.hq_einsaetze_drop_steps()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.hq_einsatz_steps where einsatz_id = new.id;
  return null;
end;
$$;
revoke all on function public.hq_einsaetze_drop_steps() from public, anon, authenticated;

drop trigger if exists hq_einsaetze_c_drop_steps on public.hq_einsaetze;
create trigger hq_einsaetze_c_drop_steps
  after insert or update of deleted_at on public.hq_einsaetze
  for each row when (new.deleted_at is not null)
  execute function public.hq_einsaetze_drop_steps();

-- Atomic step replacement: one transaction = delete + insert, so a client never leaves
-- an Einsatz half-written. SECURITY INVOKER: RLS limits it to the caller's own rows.
-- p_steps = jsonb array (max 40) of {kind,label,location?,system?,class_name?,qty?,
-- supply_id?,mission_ref?,state?,done_at?,done_by?}; `ord` is the array index.
create or replace function public.hq_replace_einsatz_steps(p_einsatz_id uuid, p_steps jsonb)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  n integer;
begin
  if p_steps is null or jsonb_typeof(p_steps) <> 'array' then
    raise exception 'p_steps must be a jsonb array' using errcode = 'invalid_parameter_value';
  end if;
  n := jsonb_array_length(p_steps);
  if n > 40 then
    raise exception 'hq_einsatz_steps: at most 40 steps per Einsatz' using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.hq_einsaetze
                  where id = p_einsatz_id and user_id = (select auth.uid()) and deleted_at is null) then
    raise exception 'Einsatz not found' using errcode = 'no_data_found';
  end if;

  delete from public.hq_einsatz_steps where einsatz_id = p_einsatz_id;

  insert into public.hq_einsatz_steps
    (einsatz_id, user_id, ord, kind, label, location, system, class_name, qty,
     supply_id, mission_ref, state, done_at, done_by)
  select p_einsatz_id, (select auth.uid()), (t.ord - 1)::integer, s.kind, s.label, s.location, s.system,
         s.class_name, s.qty, s.supply_id, s.mission_ref, coalesce(s.state, 'todo'), s.done_at, s.done_by
    from jsonb_array_elements(p_steps) with ordinality as t(el, ord)
    cross join lateral jsonb_to_record(t.el) as s(
      kind text, label text, location text, system text, class_name text, qty integer,
      supply_id text, mission_ref text, state text, done_at timestamptz, done_by text);
  return n;
end;
$$;
revoke all on function public.hq_replace_einsatz_steps(uuid, jsonb) from public, anon;
grant execute on function public.hq_replace_einsatz_steps(uuid, jsonb) to authenticated;

comment on function public.hq_replace_einsatz_steps(uuid, jsonb) is
  'Atomically replaces all steps of one of the caller''s Einsaetze (max 40; ord = array index). Returns the step count.';

-- Tombstone purge (180 days) now also covers Einsaetze; steps cascade. Replaces the
-- supplies-only version from 20261101000000 (same cron job, hq-purge-tombstones).
create or replace function public.hq_purge_tombstones()
returns void
language sql
security definer
set search_path = ''
as $fn$
  delete from public.hq_supplies  where deleted_at is not null and deleted_at < now() - interval '180 days';
  delete from public.hq_einsaetze where deleted_at is not null and deleted_at < now() - interval '180 days';
$fn$;
revoke all on function public.hq_purge_tombstones() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS: owner only (both tables)
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['hq_einsaetze', 'hq_einsatz_steps']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on table public.%I from anon', t);
    execute format('grant select, insert, update, delete on table public.%I to authenticated', t);

    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('create policy %I on public.%I for select to authenticated using ((select auth.uid()) = user_id)',
      t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check ((select auth.uid()) = user_id)',
      t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('create policy %I on public.%I for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)',
      t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using ((select auth.uid()) = user_id)',
      t || '_delete_own', t);
  end loop;
end $$;
