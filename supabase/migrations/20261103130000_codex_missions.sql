-- ============================================================
-- 20261103130000_codex_missions.sql
-- Missions (contracts) as a codex source for the global search
-- (concept 2026-11-02 "Suche: Kontext & Aktionen", follow-up "Missionen").
--
-- WHAT
--   public.codex_missions: one row per released MissionBrokerEntry of a codex
--   build (uploader sc_extract/missions.py -> ingest-catalog op `missions`).
--   LIVE 4.x: 1 978 rows, ~2.4 MB JSON per build before TOAST compression;
--   with the 3-build retention (prune_codex_builds) well under 10 MB of the
--   500 MB budget. Rows go with their build: build_id FK on delete cascade,
--   so prune_codex_builds needs no change.
--   Plain table, not part of the codex_payloads dedupe (20261102100000): the
--   payload is small and the whole set is re-sent per build.
--
-- TITLES
--   CIG fills ~mission(Token) placeholders at runtime. `title` is the
--   readable remainder (extractor titleClean.en) or, when nothing readable is
--   left, the mission type ("Bounty Hunter") — never an invented value.
--   `title_raw` keeps the template as shipped.
--
-- READ
--   Anon + authenticated may read, like every public codex table
--   (20260710190000_public_codex_read). Writes: service role only.
--   search_missions(): distinct titles of the current LIVE build (hauling
--   alone has ~800 rows under two titles), trigram-indexed, limit <= 50, so
--   it stays far inside the anon 3 s statement timeout.
-- ============================================================

create table if not exists public.codex_missions (
  id uuid primary key default gen_random_uuid(),
  build_id uuid not null references public.codex_builds(id) on delete cascade,
  channel text not null,
  patch_version text not null,
  build_number text not null default '',
  class_name text not null,
  guid text,
  title text not null,
  title_raw text,
  type_class text,
  type_name text,
  giver_name text,
  location_class text,
  location_name text,
  reward_amount integer,
  reward_currency text,
  lawful boolean,
  category text,
  payload jsonb not null default '{}'::jsonb,
  search_text text generated always as (
    lower(title || ' ' || coalesce(type_name, '') || ' ' || coalesce(giver_name, '')
          || ' ' || coalesce(location_name, ''))
  ) stored,
  created_at timestamptz not null default now(),
  constraint codex_missions_build_class unique (build_id, class_name)
);

comment on table public.codex_missions is
  'Released Star Citizen contracts (MissionBrokerEntry) per codex build. '
  'Search via search_missions(), one mission via codex_mission().';

create index if not exists codex_missions_build_title_idx
  on public.codex_missions (build_id, lower(title));
create index if not exists codex_missions_search_trgm
  on public.codex_missions using gin (search_text extensions.gin_trgm_ops);

alter table public.codex_missions enable row level security;
drop policy if exists codex_missions_public_read on public.codex_missions;
create policy codex_missions_public_read on public.codex_missions
  for select to anon, authenticated using (true);
grant select on public.codex_missions to anon, authenticated;
revoke insert, update, delete, truncate, references, trigger
  on public.codex_missions from anon, authenticated;

-- One row per distinct title of the current LIVE build. `variants` = how many
-- contracts share the title; `total` = distinct titles matched (for "Alle N").
create or replace function public.search_missions(p_query text, p_limit int default 8)
returns table (
  class_name text, title text, type_name text, giver_name text,
  location_name text, reward_amount integer, variants integer, total integer
)
language sql
stable
set search_path = public, extensions
as $$
  with q as (
    select lower(left(btrim(coalesce(p_query, '')), 80)) as t
  ),
  esc as (
    select t, replace(replace(replace(t, '\', '\\'), '%', '\%'), '_', '\_') as e from q
  ),
  b as (
    select id from public.codex_builds
     where channel = 'LIVE' and is_current
     order by created_at desc
     limit 1
  ),
  hits as (
    select m.*,
           (lower(m.title) like esc.e || '%') as prefix,
           word_similarity(esc.t, m.search_text) as sim
      from public.codex_missions m, b, esc
     where m.build_id = b.id
       and char_length(esc.t) >= 2
       and (m.search_text like '%' || esc.e || '%' or word_similarity(esc.t, m.search_text) >= 0.5)
  ),
  grouped as (
    select distinct on (lower(h.title))
           h.class_name, h.title, h.type_name, h.giver_name, h.location_name,
           h.prefix, h.sim,
           (select max(x.reward_amount) from hits x where lower(x.title) = lower(h.title))::int as reward_amount,
           (select count(*) from hits x where lower(x.title) = lower(h.title))::int as variants
      from hits h
     order by lower(h.title), h.class_name
  )
  select g.class_name, g.title, g.type_name, g.giver_name, g.location_name,
         g.reward_amount, g.variants, (count(*) over ())::int as total
    from grouped g
   order by g.prefix desc, g.sim desc, g.title
   limit least(greatest(coalesce(p_limit, 8), 1), 50);
$$;

revoke all on function public.search_missions(text, int) from public;
grant execute on function public.search_missions(text, int) to anon, authenticated;

-- One mission of the current LIVE build plus how many contracts share its title.
create or replace function public.codex_mission(p_class_name text)
returns table (
  class_name text, title text, title_raw text, type_name text, giver_name text,
  location_name text, reward_amount integer, reward_currency text, lawful boolean,
  category text, description text, variants integer, patch_version text
)
language sql
stable
set search_path = public
as $$
  with b as (
    select id from public.codex_builds
     where channel = 'LIVE' and is_current
     order by created_at desc
     limit 1
  ),
  m as (
    select c.* from public.codex_missions c, b
     where c.build_id = b.id and c.class_name = left(coalesce(p_class_name, ''), 200)
     limit 1
  )
  select m.class_name, m.title, m.title_raw, m.type_name, m.giver_name,
         m.location_name, m.reward_amount, m.reward_currency, m.lawful, m.category,
         nullif(m.payload #>> '{description,en}', ''),
         (select count(*) from public.codex_missions x
           where x.build_id = m.build_id and lower(x.title) = lower(m.title))::int,
         m.patch_version
    from m;
$$;

revoke all on function public.codex_mission(text) from public;
grant execute on function public.codex_mission(text) to anon, authenticated;

notify pgrst, 'reload schema';
