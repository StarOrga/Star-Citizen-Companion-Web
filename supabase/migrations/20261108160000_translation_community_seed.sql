-- Game-translation community seed + learning loop: database layer
-- (concept docs/concepts/20261108-1130-spieluebersetzung-community-seed,
--  decision 2026-11-08; brief briefs/implement.md checklist A1, A2, B4, D1, E3).
--
-- Adds, on top of 20261029180000_translation_pipeline.sql:
--   * translation_sources    community packs (licence, status, coverage), seeded with 8 rows
--   * translation_override_alerts  admin alert when CIG changes a key that has an admin correction
--   * translation_cards      admin flash cards ("Karteikarten") for what the AI cannot decide
--   * translation_outreach   maintainer message drafts (approve = protected admin only,
--                            sending is manual only - there is NO send code path)
--   * glossary: origin also 'mined'|'community', evidence counter (hysteresis)
--   * translation_languages.style (learned style record), approves de/it/pt-BR/ja/ru
--   * translation_settings: arbiter model, web-research cap, revision/promotion thresholds
--   * RPCs: resolve_override_alert, answer_translation_card, skip_translation_card,
--     translation_card_leaderboard, translation_card_stats, approve_translation_outreach,
--     mark_translation_outreach_sent, record_translation_outreach_answer
--
-- Alpha data policy: new tables and columns only, nothing dropped; the only change
-- to existing objects is widening the glossary origin check and approving languages.
-- translation_settings.enabled stays false (the admin switches it).
-- Every table is admin-readable (public.is_admin()); anon has nothing; edge functions use
-- the service role (bypasses RLS). State transitions that carry trust (card points, source
-- status, outreach approval) are NOT writable directly by an authenticated admin - only
-- through the security definer RPCs below (guard triggers / no write grants), so approval
-- and points cannot be faked from a browser session.
--
-- ROLLBACK: drop function public.resolve_override_alert(uuid, text, text),
--             public.answer_translation_card(uuid, text, text, text, boolean),
--             public.skip_translation_card(uuid), public.translation_card_leaderboard(),
--             public.translation_card_stats(text), public.translation_card_streak(uuid),
--             public.approve_translation_outreach(uuid),
--             public.mark_translation_outreach_sent(uuid),
--             public.record_translation_outreach_answer(uuid, text, text);
--           drop table public.translation_outreach, public.translation_cards,
--             public.translation_override_alerts, public.translation_sources;
--           drop function public.translation_guard_direct_write();
--           alter table public.translation_glossary drop column evidence;
--           alter table public.translation_glossary drop constraint translation_glossary_origin_check;
--           alter table public.translation_glossary add constraint translation_glossary_origin_check
--             check (origin in ('cig','ai','admin'));  -- only valid while no mined/community rows exist
--           alter table public.translation_languages drop column style;
--           alter table public.translation_settings drop column arbiter_model,
--             drop column web_research_cap_usd, drop column revise_margin,
--             drop column revise_budget_pct, drop column promote_min_evidence,
--             drop column promote_min_agreement;
--           update public.translation_languages set approved = false, approved_at = null
--             where lang in ('it','pt-BR','ja','ru');

-- ------------------------------------------------------------ settings
alter table public.translation_settings
  add column if not exists arbiter_model text not null default 'claude-haiku-5-5',
  add column if not exists web_research_cap_usd numeric not null default 5 check (web_research_cap_usd >= 0),
  add column if not exists revise_margin integer not null default 3 check (revise_margin >= 0),
  add column if not exists revise_budget_pct numeric not null default 2 check (revise_budget_pct >= 0 and revise_budget_pct <= 100),
  add column if not exists promote_min_evidence integer not null default 5 check (promote_min_evidence >= 1),
  add column if not exists promote_min_agreement numeric not null default 0.9 check (promote_min_agreement > 0 and promote_min_agreement <= 1);

-- ------------------------------------------------------------ languages
alter table public.translation_languages
  add column if not exists style jsonb not null default '{}'::jsonb;

-- 'ru' exists in the pipeline seed (russian_(russia)); the insert is a safety net.
insert into public.translation_languages (lang, cig_folder) values
  ('ru', 'russian_(russia)')
on conflict (lang) do nothing;

-- fr/zh-Hans/es/ko/pl stay unapproved until a source is permitted.
update public.translation_languages
   set approved = true,
       approved_at = coalesce(approved_at, now())
 where lang in ('de','it','pt-BR','ja','ru') and not approved;

-- ------------------------------------------------------------ glossary
alter table public.translation_glossary drop constraint if exists translation_glossary_origin_check;
alter table public.translation_glossary add constraint translation_glossary_origin_check
  check (origin in ('cig','ai','admin','mined','community'));
alter table public.translation_glossary
  add column if not exists evidence integer not null default 0 check (evidence >= 0);

-- ------------------------------------------------------------ sources (A1)
create table if not exists public.translation_sources (
  id               text primary key,
  lang             text not null references public.translation_languages(lang),
  name             text not null,
  repo_url         text,
  raw_url          text,
  -- set when raw_url cannot be fixed, e.g. 'github-release:owner/repo:global.ini' = latest release asset
  resolver         text,
  license          text not null,
  license_kind     text not null check (license_kind in ('permissive','nc_sa','none')),
  status           text not null check (status in ('licensed','awaiting_permission','permitted','refused')),
  attribution      text not null,
  game_folder      text not null,
  use_cig_table    boolean not null default true,
  enabled          boolean not null default true,
  last_seen_commit text,
  last_synced_at   timestamptz,
  coverage         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now()
);
create index if not exists translation_sources_lang_idx on public.translation_sources (lang);

insert into public.translation_sources
  (id, lang, name, repo_url, raw_url, resolver, license, license_kind, status, attribution, game_folder, use_cig_table, coverage)
values
  ('rjcncpt', 'de', 'rjcncpt / StarCitizen-Deutsch-INI',
   'https://github.com/rjcncpt/StarCitizen-Deutsch-INI',
   'https://raw.githubusercontent.com/rjcncpt/StarCitizen-Deutsch-INI/main/live/global.ini', null,
   'CC-BY-NC-SA-4.0', 'nc_sa', 'licensed', 'rjcncpt', 'german_(germany)', true, '{"text_pct":94.3}'),
  ('dymerz-it', 'it', 'Dymerz / StarCitizen-Localization (italian)',
   'https://github.com/Dymerz/StarCitizen-Localization',
   'https://raw.githubusercontent.com/Dymerz/StarCitizen-Localization/main/data/Localization/italian_(italy)/global.ini', null,
   'MIT', 'permissive', 'licensed', 'Dymerz', 'italian_(italy)', true, '{"text_pct":93.3}'),
  ('dymerz-ptbr', 'pt-BR', 'Dymerz / StarCitizen-Localization (portuguese)',
   'https://github.com/Dymerz/StarCitizen-Localization',
   'https://raw.githubusercontent.com/Dymerz/StarCitizen-Localization/main/data/Localization/portuguese_(brazil)/global.ini', null,
   'MIT', 'permissive', 'licensed', 'Dymerz', 'portuguese_(brazil)', true, '{"text_pct":93.6}'),
  ('stdblue', 'ja', 'stdblue / StarCitizenJapaneseResources',
   'https://github.com/stdblue/StarCitizenJapaneseResources',
   null, 'github-release:stdblue/StarCitizenJapaneseResources:global.ini',
   'MIT', 'permissive', 'licensed', 'stdblue', 'japanese_(japan)', true, '{"text_pct":88.9}'),
  -- The game has no russian folder: the pack ships in the korean slot, whose CIG table is Korean.
  ('n1ghter', 'ru', 'n1ghter / StarCitizenRu',
   'https://github.com/n1ghter/StarCitizenRu',
   'https://raw.githubusercontent.com/n1ghter/StarCitizenRu/master/data/Localization/korean_(south_korea)/global.ini', null,
   'CC-BY-NC-SA-4.0 (+ special permission for CIG only)', 'nc_sa', 'licensed', 'n1ghter', 'korean_(south_korea)', false, '{"text_pct":95.3}'),
  ('circuspes', 'fr', 'Traduction communautaire francophone (circuspes, via Dymerz)',
   'https://github.com/Dymerz/StarCitizen-Localization',
   'https://raw.githubusercontent.com/Dymerz/StarCitizen-Localization/main/data/Localization/french_(france)/global.ini', null,
   'none (Copyright (c) Traduction communautaire francophone de StarCitizen 2026)', 'none', 'awaiting_permission',
   'Traduction communautaire francophone de StarCitizen (traduction.circuspes.fr)', 'french_(france)', true, '{"text_pct":97.8}'),
  ('42kit', 'zh-Hans', '42kit / StarCitizenToolBox LocalizationData',
   'https://github.com/StarCitizenToolBox/LocalizationData',
   'https://ini.42kit.com/data.zip', 'zip-entry:data/Localization/chinese_(simplified)/global.ini',
   'none', 'none', 'awaiting_permission', '42kit', 'chinese_(simplified)', true, '{"text_pct":97.9}'),
  ('thord82', 'es', 'Thord82 / Star_citizen_ES',
   'https://github.com/Thord82/Star_citizen_ES',
   'https://raw.githubusercontent.com/Thord82/Star_citizen_ES/main/global.ini', null,
   'All rights reserved (COPYRIGHT.md: personal use only, express prior permission required)', 'none', 'awaiting_permission',
   'Thord82', 'spanish_(spain)', true, '{"text_pct":57.4}')
on conflict (id) do nothing;

-- ------------------------------------------------------------ override alerts (B4)
create table if not exists public.translation_override_alerts (
  id          uuid primary key default gen_random_uuid(),
  lang        text not null references public.translation_languages(lang),
  key         text not null,
  build_id    uuid references public.codex_builds(id) on delete set null,
  en_old      text,
  en_new      text,
  cig_old     text,
  cig_new     text,
  admin_text  text not null,
  status      text not null default 'open' check (status in ('open','kept','adopted','edited')),
  edited_text text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at  timestamptz not null default now()
);
-- One open alert per key: the orchestrator upserts instead of piling up duplicates.
create unique index if not exists translation_override_alerts_open_uidx
  on public.translation_override_alerts (lang, key) where status = 'open';
create index if not exists translation_override_alerts_status_idx
  on public.translation_override_alerts (status, created_at desc);

-- ------------------------------------------------------------ cards (D1)
create table if not exists public.translation_cards (
  id           uuid primary key default gen_random_uuid(),
  lang         text not null references public.translation_languages(lang),
  kind         text not null check (kind in ('meta','wording','style')),
  question     text not null,
  option_a     jsonb not null,   -- {text, source}
  option_b     jsonb not null,   -- {text, source}
  context      jsonb not null default '{}'::jsonb,  -- {key, en, neighbours, where, research}
  spread       integer not null default 0 check (spread >= 0),   -- strings affected
  reach        integer not null default 0,                       -- visibility: UI/HUD high, lore low
  doubt        numeric not null default 0,                       -- AI uncertainty 0..1
  fresh        boolean not null default false,                   -- touches the current patch
  -- kind order of the queue: meta (0) before wording (1) before style (2)
  kind_rank    smallint generated always as (
    case kind when 'meta' then 0 when 'wording' then 1 else 2 end) stored,
  -- optional idempotency key for the creator (one unanswered card per conflict)
  dedupe_key   text,
  status       text not null default 'open' check (status in ('open','answered','skipped')),
  answer       text check (answer in ('a','b','own')),
  own_text     text,
  note         text,
  save_as_rule boolean not null default false,
  impact       integer not null default 0 check (impact >= 0),   -- strings unified by the answer
  points       integer,
  answered_by  uuid references auth.users(id) on delete set null,
  answered_at  timestamptz,
  skipped_at   timestamptz,
  created_at   timestamptz not null default now(),
  check ((status = 'answered') = (answer is not null)),
  check (answer is distinct from 'own' or coalesce(btrim(own_text), '') <> '')
);
create unique index if not exists translation_cards_dedupe_uidx
  on public.translation_cards (lang, dedupe_key) where dedupe_key is not null and status <> 'answered';
-- D2 queue order: spread, reach, kind, doubt, fresh (all "most first", kind meta<wording<style).
-- Skipped cards go to the end: queue = status in ('open','skipped') order by (status = 'skipped'), then these.
create index if not exists translation_cards_queue_idx
  on public.translation_cards (lang, spread desc, reach desc, kind_rank, doubt desc, fresh desc)
  where status in ('open','skipped');
create index if not exists translation_cards_answered_idx
  on public.translation_cards (answered_by, answered_at desc) where status = 'answered';

-- ------------------------------------------------------------ outreach (E3)
create table if not exists public.translation_outreach (
  id           uuid primary key default gen_random_uuid(),
  source_id    text not null references public.translation_sources(id) on delete cascade,
  kind         text not null check (kind in ('notify','permission')),
  message_lang text not null default 'de',
  subject      text not null,
  body         text not null,
  status       text not null default 'draft' check (status in ('draft','approved','sent','answered')),
  approved_by  uuid references auth.users(id) on delete set null,
  approved_at  timestamptz,
  sent_at      timestamptz,
  answer       text,
  answer_at    timestamptz,
  decision     text check (decision in ('granted','refused')),
  created_at   timestamptz not null default now()
);
create index if not exists translation_outreach_source_idx on public.translation_outreach (source_id, created_at desc);

-- ------------------------------------------------------------ guard against direct writes
-- A plain authenticated admin must not fake trust-carrying fields via PostgREST. The
-- security definer RPCs run as the function owner, the edge functions as service_role -
-- both pass; only current_user = 'authenticated' (a browser session) is checked.
create or replace function public.translation_guard_direct_write()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  o jsonb := to_jsonb(old);
  n jsonb := to_jsonb(new);
  f text;
begin
  if current_user <> 'authenticated' then
    return new;
  end if;
  foreach f in array tg_argv loop
    if o -> f is distinct from n -> f then
      raise exception 'translation: % on % is changed through its RPC only', f, tg_table_name
        using errcode = '42501';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.translation_guard_direct_write() from public, anon, authenticated;

drop trigger if exists translation_sources_guard on public.translation_sources;
create trigger translation_sources_guard before update on public.translation_sources
  for each row execute function public.translation_guard_direct_write('status','id','lang');
drop trigger if exists translation_outreach_guard on public.translation_outreach;
create trigger translation_outreach_guard before update on public.translation_outreach
  for each row execute function public.translation_guard_direct_write(
    'status','approved_by','approved_at','sent_at','answer','answer_at','decision','source_id','kind');

-- ------------------------------------------------------------ RLS
alter table public.translation_sources enable row level security;
alter table public.translation_override_alerts enable row level security;
alter table public.translation_cards enable row level security;
alter table public.translation_outreach enable row level security;

-- Admins read everything; cards and alerts change only through the RPCs (and the service
-- role). Sources and outreach: admins may update harmless fields, trust fields are guarded.
do $$
declare t text;
begin
  foreach t in array array['translation_sources','translation_override_alerts','translation_cards','translation_outreach']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (public.is_admin())',
      t || '_admin_read', t);
  end loop;
end $$;

drop policy if exists translation_sources_admin_update on public.translation_sources;
create policy translation_sources_admin_update on public.translation_sources
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists translation_outreach_admin_update on public.translation_outreach;
create policy translation_outreach_admin_update on public.translation_outreach
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

revoke all on public.translation_sources, public.translation_override_alerts,
  public.translation_cards, public.translation_outreach from anon;
revoke insert, delete, truncate on public.translation_sources, public.translation_override_alerts,
  public.translation_cards, public.translation_outreach from authenticated;
revoke update on public.translation_override_alerts, public.translation_cards from authenticated;

-- ------------------------------------------------------------ RPC: override alerts
create or replace function public.resolve_override_alert(
  p_alert_id uuid, p_resolution text, p_edited_text text default null)
returns public.translation_override_alerts
language plpgsql
security definer
set search_path = ''
as $$
declare r public.translation_override_alerts;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_resolution not in ('kept','adopted','edited') then
    raise exception 'invalid resolution %', p_resolution using errcode = '22023';
  end if;
  if p_resolution = 'edited' and coalesce(btrim(p_edited_text), '') = '' then
    raise exception 'edited needs a text' using errcode = '22023';
  end if;
  update public.translation_override_alerts
     set status = p_resolution,
         edited_text = case when p_resolution = 'edited' then p_edited_text else null end,
         resolved_by = (select auth.uid()),
         resolved_at = now()
   where id = p_alert_id and status = 'open'
   returning * into r;
  if not found then
    raise exception 'alert not found or already resolved' using errcode = 'P0002';
  end if;
  return r;
end $$;

-- ------------------------------------------------------------ RPC: cards
create or replace function public.answer_translation_card(
  p_card_id uuid, p_answer text, p_own_text text default null,
  p_note text default null, p_save_as_rule boolean default false)
returns public.translation_cards
language plpgsql
security definer
set search_path = ''
as $$
declare r public.translation_cards;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_answer not in ('a','b','own') then
    raise exception 'invalid answer %', p_answer using errcode = '22023';
  end if;
  if p_answer = 'own' and coalesce(btrim(p_own_text), '') = '' then
    raise exception 'own answer needs a text' using errcode = '22023';
  end if;
  update public.translation_cards
     set status = 'answered',
         answer = p_answer,
         own_text = case when p_answer = 'own' then p_own_text else null end,
         note = nullif(btrim(coalesce(p_note, '')), ''),
         save_as_rule = coalesce(p_save_as_rule, false),
         points = 10 + round(least(impact, 500) / 10.0)::int,
         answered_by = (select auth.uid()),
         answered_at = now()
   where id = p_card_id and status in ('open','skipped')
   returning * into r;
  if not found then
    raise exception 'card not found or already answered' using errcode = 'P0002';
  end if;
  return r;
end $$;

create or replace function public.skip_translation_card(p_card_id uuid)
returns public.translation_cards
language plpgsql
security definer
set search_path = ''
as $$
declare r public.translation_cards;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.translation_cards
     set status = 'skipped', skipped_at = now()
   where id = p_card_id and status in ('open','skipped')
   returning * into r;
  if not found then
    raise exception 'card not found or already answered' using errcode = 'P0002';
  end if;
  return r;
end $$;

-- Current streak in days (Europe/Berlin calendar): consecutive days with an answer, ending
-- today or yesterday (a streak survives until the day is over).
create or replace function public.translation_card_streak(p_user uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with d as (
    select distinct (answered_at at time zone 'Europe/Berlin')::date as day
      from public.translation_cards
     where status = 'answered' and answered_by = p_user
  ), g as (
    select day, day - (row_number() over (order by day))::int as grp from d
  ), runs as (
    select max(day) as last_day, count(*)::int as len from g group by grp
  )
  select coalesce(
    (select len from runs
      where last_day >= (now() at time zone 'Europe/Berlin')::date - 1
      order by last_day desc limit 1), 0);
$$;
revoke all on function public.translation_card_streak(uuid) from public, anon, authenticated;

create or replace function public.translation_card_leaderboard()
returns table (answered_by uuid, points bigint, answers bigint, streak_days integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
    select c.answered_by, sum(c.points)::bigint, count(*)::bigint,
           public.translation_card_streak(c.answered_by)
      from public.translation_cards c
     where c.status = 'answered' and c.answered_by is not null
     group by c.answered_by
     order by 2 desc, 3 desc;
end $$;

create or replace function public.translation_card_stats(p_lang text default null)
returns table (open_count integer, answered_today integer, streak_days integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  return query
    select
      (select count(*)::int from public.translation_cards c
        where c.status in ('open','skipped') and (p_lang is null or c.lang = p_lang)),
      (select count(*)::int from public.translation_cards c
        where c.status = 'answered' and c.answered_by = (select auth.uid())
          and (c.answered_at at time zone 'Europe/Berlin')::date = (now() at time zone 'Europe/Berlin')::date
          and (p_lang is null or c.lang = p_lang)),
      public.translation_card_streak((select auth.uid()));
end $$;

-- ------------------------------------------------------------ RPC: outreach
-- Approval needs a PROTECTED admin; nothing here (or anywhere) sends a message.
create or replace function public.approve_translation_outreach(p_id uuid)
returns public.translation_outreach
language plpgsql
security definer
set search_path = ''
as $$
declare r public.translation_outreach;
begin
  if not public.is_admin()
     or not exists (select 1 from public.protected_admins where user_id = (select auth.uid())) then
    raise exception 'only a protected admin may approve outreach' using errcode = '42501';
  end if;
  update public.translation_outreach
     set status = 'approved', approved_by = (select auth.uid()), approved_at = now()
   where id = p_id and status = 'draft'
   returning * into r;
  if not found then
    raise exception 'outreach not found or not a draft' using errcode = 'P0002';
  end if;
  return r;
end $$;

-- Manual mark: the admin copied the text and sent it themselves.
create or replace function public.mark_translation_outreach_sent(p_id uuid)
returns public.translation_outreach
language plpgsql
security definer
set search_path = ''
as $$
declare r public.translation_outreach;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  update public.translation_outreach
     set status = 'sent', sent_at = now()
   where id = p_id and status = 'approved'
   returning * into r;
  if not found then
    raise exception 'outreach not found or not approved' using errcode = 'P0002';
  end if;
  return r;
end $$;

-- Logs the maintainer's answer. granted: an awaiting_permission/refused source becomes
-- 'permitted' (a licensed one stays licensed); refused: the source becomes 'refused' and disabled.
create or replace function public.record_translation_outreach_answer(
  p_id uuid, p_answer text, p_decision text)
returns public.translation_outreach
language plpgsql
security definer
set search_path = ''
as $$
declare r public.translation_outreach;
begin
  if not public.is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_decision not in ('granted','refused') then
    raise exception 'invalid decision %', p_decision using errcode = '22023';
  end if;
  update public.translation_outreach
     set status = 'answered', answer = p_answer, answer_at = now(), decision = p_decision
   where id = p_id and status = 'sent'
   returning * into r;
  if not found then
    raise exception 'outreach not found or not sent' using errcode = 'P0002';
  end if;
  if p_decision = 'granted' then
    update public.translation_sources set status = 'permitted'
     where id = r.source_id and status in ('awaiting_permission','refused');
  else
    update public.translation_sources set status = 'refused', enabled = false
     where id = r.source_id;
  end if;
  return r;
end $$;

-- ------------------------------------------------------------ grants
revoke all on function
  public.resolve_override_alert(uuid, text, text),
  public.answer_translation_card(uuid, text, text, text, boolean),
  public.skip_translation_card(uuid),
  public.translation_card_leaderboard(),
  public.translation_card_stats(text),
  public.approve_translation_outreach(uuid),
  public.mark_translation_outreach_sent(uuid),
  public.record_translation_outreach_answer(uuid, text, text)
from public, anon;
grant execute on function
  public.resolve_override_alert(uuid, text, text),
  public.answer_translation_card(uuid, text, text, text, boolean),
  public.skip_translation_card(uuid),
  public.translation_card_leaderboard(),
  public.translation_card_stats(text),
  public.approve_translation_outreach(uuid),
  public.mark_translation_outreach_sent(uuid),
  public.record_translation_outreach_answer(uuid, text, text)
to authenticated;
