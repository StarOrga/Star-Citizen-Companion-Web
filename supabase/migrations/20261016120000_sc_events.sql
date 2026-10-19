-- ============================================================
-- Star Citizen event timeline — SCC-Web owns it, the desktop app consumes it.
--
-- public.sc_events            one row per event (curated columns + extra jsonb)
-- public.sc_events_scrape_runs run log of the sc-events-sync edge function
-- sc_events_feed()            payload in the desktop app's sc-events.json shape
--                             ({schemaVersion:1, updatedAt, events:[…]}) — it
--                             passes modules/shared/sc-events.js
--                             sanitizeEventsPayload() unchanged
-- sc_events_health()          staleness / failure counters for app + web
-- sc_events_upsert_scraped()  the ONLY write path of the scraper (service_role):
--                             never touches locked rows, never downgrades
--                             confirmed → estimated, never deletes
--
-- Read access: role `authenticated` only (the app asks for an SCC-Web sign-in
-- when Events opens). Writes: service_role (bypasses RLS) only.
--
-- Manual curation: set `locked = true` on a row and the scraper leaves it
-- alone forever; set `hidden = true` to drop it from the feed.
--
-- ROLLBACK: select cron.unschedule('sc-events-sync');
--           select cron.unschedule('sc-events-runs-retention');
--           drop function if exists public.sc_events_feed(), public.sc_events_health(),
--             public.sc_events_upsert_scraped(jsonb);
--           drop table if exists public.sc_events_scrape_runs, public.sc_events;
-- ============================================================

create table if not exists public.sc_events (
  id                  text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  series              text not null check (series ~ '^[a-z0-9][a-z0-9-]{0,63}$'),
  kind                text not null check (kind in ('expo', 'showcase', 'seasonal', 'community', 'free-fly')),
  name                text not null check (length(name) between 1 and 120),
  start_date          date not null,
  end_date            date not null,
  date_status         text not null default 'estimated' check (date_status in ('confirmed', 'estimated')),
  status              text not null default 'scheduled' check (status in ('scheduled', 'cancelled')),
  free_fly            boolean not null default false,
  url                 text not null default ''
                      check (url = '' or url ~ '^https://(www\.)?robertsspaceindustries\.com/'),
  summary             jsonb not null default '{}'::jsonb check (jsonb_typeof(summary) = 'object'),
  extra               jsonb not null default '{}'::jsonb check (jsonb_typeof(extra) = 'object'),
  locked              boolean not null default false,
  hidden              boolean not null default false,
  source              text not null default 'manual'
                      check (source in ('seed', 'manual', 'title', 'twisc', 'ai', 'rollforward')),
  source_comm_link_id integer,
  source_published_at timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint sc_events_dates_ordered check (end_date >= start_date)
);
create index if not exists sc_events_series_start_idx on public.sc_events (series, start_date);
create index if not exists sc_events_end_idx on public.sc_events (end_date);

create table if not exists public.sc_events_scrape_runs (
  id             bigint generated always as identity primary key,
  started_at     timestamptz not null default now(),
  finished_at    timestamptz,
  duration_ms    integer,
  source         text not null,
  status         text not null check (status in ('running', 'ok', 'degraded', 'failed')),
  parser_version text not null,
  parsed_count   integer not null default 0,
  matched_count  integer not null default 0,
  written_count  integer not null default 0,
  changes        jsonb not null default '[]'::jsonb,
  needs_review   jsonb not null default '[]'::jsonb,
  skipped        jsonb not null default '[]'::jsonb,
  error          text
);
create index if not exists sc_events_scrape_runs_started_idx on public.sc_events_scrape_runs (started_at desc);

create or replace function public.sc_events_touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.sc_events_touch_updated_at() from public, anon, authenticated;

drop trigger if exists sc_events_touch on public.sc_events;
create trigger sc_events_touch before update on public.sc_events
  for each row execute function public.sc_events_touch_updated_at();

-- RLS: signed-in users read, nobody but service_role writes.
alter table public.sc_events enable row level security;
alter table public.sc_events_scrape_runs enable row level security;
revoke all on public.sc_events, public.sc_events_scrape_runs from anon, authenticated;
grant select on public.sc_events, public.sc_events_scrape_runs to authenticated;

drop policy if exists sc_events_read on public.sc_events;
create policy sc_events_read on public.sc_events for select to authenticated using (true);
drop policy if exists sc_events_runs_read on public.sc_events_scrape_runs;
create policy sc_events_runs_read on public.sc_events_scrape_runs for select to authenticated using (true);

-- ------------------------------------------------------------ feed
create or replace function public.sc_events_feed()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select jsonb_build_object(
    'schemaVersion', 1,
    'updatedAt', to_char(coalesce(max(e.updated_at), now()) at time zone 'utc', 'YYYY-MM-DD'),
    'events', coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id,
      'series', e.series,
      'kind', e.kind,
      'name', e.name,
      'start', to_char(e.start_date, 'YYYY-MM-DD'),
      'end', to_char(e.end_date, 'YYYY-MM-DD'),
      'dateStatus', e.date_status,
      'status', e.status,
      'freeFly', e.free_fly,
      'url', e.url,
      'summary', jsonb_build_object(
        'en', coalesce(e.summary->>'en', ''),
        'de', coalesce(nullif(e.summary->>'de', ''), e.summary->>'en', ''))
    ) order by e.start_date, e.id), '[]'::jsonb)
  )
  from (
    -- The app keeps at most 200 events; past history beyond ~13 months is noise.
    select * from public.sc_events
    where not hidden and end_date >= current_date - 400
    order by start_date desc
    limit 200
  ) e;
$$;

-- ------------------------------------------------------------ health
create or replace function public.sc_events_health()
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with last_ok as (
    select max(finished_at) as t from public.sc_events_scrape_runs where status = 'ok'
  ), last_run as (
    select * from public.sc_events_scrape_runs where status <> 'running'
    order by started_at desc limit 1
  )
  select jsonb_build_object(
    'lastRunAt', (select finished_at from last_run),
    'lastRunStatus', (select status from last_run),
    'lastRunError', (select error from last_run),
    'parserVersion', (select parser_version from last_run),
    'lastOkAt', (select t from last_ok),
    'lastOkAgeHours', (select round((extract(epoch from now() - t) / 3600.0)::numeric, 1) from last_ok),
    'consecutiveFailures', (
      select count(*) from public.sc_events_scrape_runs r
      where r.status in ('degraded', 'failed')
        and r.started_at > coalesce((select t from last_ok), '-infinity'::timestamptz)),
    'stale', coalesce((select now() - t > interval '48 hours' from last_ok), true),
    'needsReview', coalesce((select jsonb_array_length(needs_review) from last_run), 0),
    'eventCount', (select count(*) from public.sc_events where not hidden),
    'updatedAt', (select max(updated_at) from public.sc_events)
  );
$$;

revoke all on function public.sc_events_feed() from public, anon;
revoke all on function public.sc_events_health() from public, anon;
grant execute on function public.sc_events_feed() to authenticated;
grant execute on function public.sc_events_health() to authenticated;

-- ------------------------------------------------------------ scraper write path
create or replace function public.sc_events_upsert_scraped(p_events jsonb)
returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  n integer;
begin
  if jsonb_typeof(p_events) <> 'array' then
    raise exception 'p_events must be a json array';
  end if;
  insert into public.sc_events as e
    (id, series, kind, name, start_date, end_date, date_status, free_fly, url, summary,
     source, source_comm_link_id, source_published_at)
  select r.id, r.series, r.kind, r.name, r.start_date, r.end_date, r.date_status,
         coalesce(r.free_fly, false), coalesce(r.url, ''), coalesce(r.summary, '{}'::jsonb),
         r.source, r.source_comm_link_id, r.source_published_at
  from jsonb_to_recordset(p_events) as r(
    id text, series text, kind text, name text, start_date date, end_date date,
    date_status text, free_fly boolean, url text, summary jsonb,
    source text, source_comm_link_id integer, source_published_at timestamptz)
  on conflict (id) do update set
    start_date          = excluded.start_date,
    end_date            = excluded.end_date,
    date_status         = excluded.date_status,
    url                 = case when excluded.url <> '' then excluded.url else e.url end,
    free_fly            = e.free_fly or excluded.free_fly,
    -- An estimated row's text ("dates not announced yet") is outdated once
    -- confirmed; curated text of confirmed rows is kept.
    summary             = case when e.date_status = 'estimated' and excluded.summary <> '{}'::jsonb
                               then excluded.summary else e.summary end,
    source              = excluded.source,
    source_comm_link_id = excluded.source_comm_link_id,
    source_published_at = excluded.source_published_at
  where e.locked = false
    and not (e.date_status = 'confirmed' and excluded.date_status = 'estimated')
    and (e.start_date, e.end_date, e.date_status, e.url)
        is distinct from (excluded.start_date, excluded.end_date, excluded.date_status,
                          case when excluded.url <> '' then excluded.url else e.url end);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.sc_events_upsert_scraped(jsonb) from public, anon, authenticated;
grant execute on function public.sc_events_upsert_scraped(jsonb) to service_role;

-- ------------------------------------------------------------ schedule
-- Every 6 h at :17. The function self-throttles (one run per 5 min) and is
-- JWT-less like patch-stability-sample, so the publishable key is enough.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sc-events-sync') then
    perform cron.unschedule('sc-events-sync');
  end if;
  if exists (select 1 from cron.job where jobname = 'sc-events-runs-retention') then
    perform cron.unschedule('sc-events-runs-retention');
  end if;
end $$;

select cron.schedule(
  'sc-events-sync',
  '17 */6 * * *',
  $job$
  select net.http_post(
    url := 'https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/sc-events-sync',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);

select cron.schedule(
  'sc-events-runs-retention',
  '40 4 * * *',
  $job$ delete from public.sc_events_scrape_runs where started_at < now() - interval '180 days'; $job$
);

-- ------------------------------------------------------------ seed
-- From the desktop app's bundled modules/desktop/resources/sc-events.json
-- (updatedAt 2026-10-16). Hand-verified confirmed rows are locked; estimated
-- rows stay open for the scraper to confirm.
insert into public.sc_events (id, series, kind, name, start_date, end_date, date_status, status, free_fly, url, summary, locked, source) values
  ('dotv-2955', 'day-of-the-vara', 'seasonal', 'Day of the Vara 2955', '2025-10-01'::date, '2025-11-03'::date, 'confirmed', 'scheduled', false, 'https://robertsspaceindustries.com/comm-link/transmission/20855-This-Week-In-Star-Citizen', '{"en":"Halloween-style festival with contests, Kill Collector mode and themed paints.","de":"Halloween-artiges Fest mit Wettbewerben, Kill-Collector-Modus und Themen-Lackierungen."}'::jsonb, true, 'seed'),
  ('cc-2955', 'citizencon', 'showcase', 'CitizenCon Direct 2955', '2025-10-11'::date, '2025-10-11'::date, 'confirmed', 'scheduled', false, 'https://robertsspaceindustries.com/comm-link/transmission/20722-CitizenCon-Direct-Watch-Parties-2025', '{"en":"Two-hour livestreamed showcase from CIG Manchester, with Bar Citizen watch parties.","de":"Zweistündiger Livestream-Showcase aus dem CIG-Studio Manchester, mit Bar-Citizen-Watchpartys."}'::jsonb, true, 'seed'),
  ('iae-2955', 'iae', 'expo', 'Intergalactic Aerospace Expo 2955', '2025-11-20'::date, '2025-12-03'::date, 'confirmed', 'scheduled', true, 'https://robertsspaceindustries.com/comm-link/transmission/20861-Intergalactic-Aerospace-Expo-2955-Free-Fly-And-Manufacturer-Schedule', '{"en":"Annual ship expo in Orison with daily manufacturer halls and a Free Fly.","de":"Jährliche Schiffsmesse in Orison mit täglichen Herstellerhallen und Free Fly."}'::jsonb, true, 'seed'),
  ('lum-2955', 'luminalia', 'seasonal', 'Luminalia 2955', '2025-12-10'::date, '2025-12-22'::date, 'confirmed', 'scheduled', false, 'https://robertsspaceindustries.com/comm-link/transmission/20916-Luminalia-2955', '{"en":"Winter festival with the \"13 Days of Luminalia\" gift calendar.","de":"Winterfest mit dem Geschenkekalender „13 Days of Luminalia“."}'::jsonb, true, 'seed'),
  ('cor-2956', 'coramor', 'seasonal', 'Coramor 2956', '2026-02-11'::date, '2026-02-23'::date, 'confirmed', 'scheduled', true, 'https://robertsspaceindustries.com/comm-link/transmission/21010-This-Week-In-Star-Citizen', '{"en":"Valentine-style celebration with Lovestruck paints and a Free Fly from 12 February.","de":"Valentins-Fest mit Lovestruck-Lackierungen und Free Fly ab dem 12. Februar."}'::jsonb, true, 'seed'),
  ('red-2956', 'red-festival', 'seasonal', 'Red Festival 2956', '2026-02-17'::date, '2026-03-03'::date, 'confirmed', 'scheduled', false, 'https://robertsspaceindustries.com/comm-link/transmission/21027-This-Week-In-Star-Citizen', '{"en":"Lunar New Year red-envelope hunt across Stanton with zodiac paints.","de":"Mondneujahr: Jagd nach roten Umschlägen in Stanton mit Tierkreis-Lackierungen."}'::jsonb, true, 'seed'),
  ('sf-2956', 'stella-fortuna', 'seasonal', 'Stella Fortuna 2956', '2026-03-12'::date, '2026-03-30'::date, 'confirmed', 'scheduled', false, 'https://robertsspaceindustries.com/comm-link/transmission/21077-This-Week-In-Star-Citizen', '{"en":"Green-and-gold festival of luck and racing.","de":"Grün-goldenes Fest rund um Glück und Rennen."}'::jsonb, true, 'seed'),
  ('coi-2956', 'captains-of-industry', 'expo', 'Captains of Industry', '2026-04-08'::date, '2026-04-27'::date, 'confirmed', 'scheduled', true, 'https://robertsspaceindustries.com/comm-link/transmission/21123-This-Week-In-Star-Citizen', '{"en":"Industrial careers event — hauling, mining, salvage — with a Free Fly from 9 to 20 April.","de":"Event für Industrie-Berufe — Fracht, Bergbau, Bergung — mit Free Fly vom 9. bis 20. April."}'::jsonb, true, 'seed'),
  ('dc-2956', 'invictus', 'expo', 'Drake DefenseCon 2956', '2026-05-14'::date, '2026-05-27'::date, 'confirmed', 'scheduled', true, 'https://robertsspaceindustries.com/comm-link/transmission/21129-DefenseCon-2956-Schedule', '{"en":"Military ship expo in Area18 in place of Invictus Launch Week, which was pulled back to Sol. Free Fly from 18 May.","de":"Militär-Schiffsmesse in Area18 anstelle der Invictus Launch Week, die nach Sol zurückverlegt wurde. Free Fly ab dem 18. Mai."}'::jsonb, true, 'seed'),
  ('aw-2956', 'alien-week', 'seasonal', 'Alien Week 2956', '2026-06-17'::date, '2026-07-06'::date, 'confirmed', 'scheduled', false, 'https://robertsspaceindustries.com/comm-link/transmission/21219-This-Week-In-Star-Citizen', '{"en":"Banu, Xi''an and Tevarin celebration with the Xeno Craft Challenge.","de":"Fest der Banu, Xi''an und Tevarin mit der Xeno Craft Challenge."}'::jsonb, true, 'seed'),
  ('ss-2956', 'ship-showdown', 'community', 'Ship Showdown 2956', '2026-07-28'::date, '2026-09-02'::date, 'confirmed', 'scheduled', false, 'https://robertsspaceindustries.com/en/ship-showdown-2956/winners', '{"en":"Community vote for the favourite ship of the year — the RSI Perseus won.","de":"Community-Abstimmung über das Lieblingsschiff des Jahres — gewonnen hat die RSI Perseus."}'::jsonb, true, 'seed'),
  ('ff-2956', 'foundation-festival', 'community', 'Foundation Festival 2956', '2026-07-29'::date, '2026-08-12'::date, 'confirmed', 'scheduled', true, 'https://robertsspaceindustries.com/comm-link/transmission/21287-This-Week-In-Star-Citizen', '{"en":"Welcome event for new players with Guide System rewards and a Free Fly until 10 August.","de":"Willkommens-Event für neue Spieler mit Belohnungen im Guide-System und Free Fly bis zum 10. August."}'::jsonb, true, 'seed'),
  ('pw-2956', 'pirate-week', 'seasonal', 'Pirate Week 2956', '2026-09-09'::date, '2026-09-23'::date, 'estimated', 'scheduled', false, 'https://robertsspaceindustries.com/comm-link/transmission/21285-Pirate-Week-2026', '{"en":"Pirate-themed paints and a doubloon treasure hunt. Start confirmed, end estimated.","de":"Piraten-Lackierungen und eine Dublonen-Schatzsuche. Start bestätigt, Ende geschätzt."}'::jsonb, false, 'seed'),
  ('dotv-2956', 'day-of-the-vara', 'seasonal', 'Day of the Vara 2956', '2026-10-21'::date, '2026-11-03'::date, 'estimated', 'scheduled', false, '', '{"en":"Yearly Halloween-style festival around 27 October. RSI has not announced the 2956 dates yet; 2955 ran until 3 November.","de":"Jährliches Halloween-Fest rund um den 27. Oktober. RSI hat die Termine für 2956 noch nicht angekündigt; 2955 lief es bis zum 3. November."}'::jsonb, false, 'seed'),
  ('discovery-2956', 'rsi-discovery-month', 'showcase', 'RSI Discovery Month 2956', '2026-10-14'::date, '2026-10-27'::date, 'confirmed', 'scheduled', false, 'https://robertsspaceindustries.com/en/comm-link/transmission/21374-This-Week-In-Star-Citizen', '{"en":"RSI and Constellation celebration with Twitch Drops (Phoenix insignia display) and Constellation history installations in Stanton.","de":"RSI- und Constellation-Feier mit Twitch Drops (Phoenix-Insignien-Display) und Constellation-Ausstellungen in Stanton."}'::jsonb, true, 'seed'),
  ('s42-preview-2026', 'squadron-42', 'showcase', 'Squadron 42 backer preview', '2026-10-09'::date, '2026-10-10'::date, 'confirmed', 'scheduled', false, 'https://robertsspaceindustries.com/comm-link/transmission/21301', '{"en":"Hands-on preview of Squadron 42 for a small group of original backers and long-time content creators.","de":"Anspiel-Vorschau auf Squadron 42 für eine kleine Gruppe früher Unterstützer und langjähriger Content Creator."}'::jsonb, true, 'seed'),
  ('cc-2956', 'citizencon', 'showcase', 'CitizenCon 2956', '2026-10-10'::date, '2026-10-10'::date, 'estimated', 'cancelled', false, '', '{"en":"According to CIG on Inside Star Citizen (7 May 2026) there is no CitizenCon this year — neither on site nor digital.","de":"Laut CIG in Inside Star Citizen (7. Mai 2026) gibt es dieses Jahr keine CitizenCon — weder vor Ort noch digital."}'::jsonb, false, 'seed'),
  ('iae-2956', 'iae', 'expo', 'Intergalactic Aerospace Expo 2956', '2026-11-20'::date, '2026-12-03'::date, 'estimated', 'scheduled', true, '', '{"en":"Annual ship expo with a Free Fly. Confirmed for this year, dates follow the usual pattern (two weeks around US Thanksgiving).","de":"Jährliche Schiffsmesse mit Free Fly. Für dieses Jahr bestätigt, Termine nach dem üblichen Muster (zwei Wochen rund um Thanksgiving)."}'::jsonb, false, 'seed'),
  ('lum-2956', 'luminalia', 'seasonal', 'Luminalia 2956', '2026-12-10'::date, '2026-12-22'::date, 'estimated', 'scheduled', false, '', '{"en":"Winter festival with a daily gift calendar.","de":"Winterfest mit täglichem Geschenkekalender."}'::jsonb, false, 'seed'),
  ('cor-2957', 'coramor', 'seasonal', 'Coramor 2957', '2027-02-11'::date, '2027-02-23'::date, 'estimated', 'scheduled', true, '', '{"en":"Valentine-style celebration; usually comes with a Free Fly.","de":"Valentins-Fest; meist mit Free Fly."}'::jsonb, false, 'seed'),
  ('red-2957', 'red-festival', 'seasonal', 'Red Festival 2957', '2027-02-04'::date, '2027-02-18'::date, 'estimated', 'scheduled', false, '', '{"en":"Lunar New Year festival (Lunar New Year 2027: 6 February).","de":"Mondneujahrsfest (Mondneujahr 2027: 6. Februar)."}'::jsonb, false, 'seed'),
  ('sf-2957', 'stella-fortuna', 'seasonal', 'Stella Fortuna 2957', '2027-03-11'::date, '2027-03-29'::date, 'estimated', 'scheduled', false, '', '{"en":"Festival of luck and racing around 15 March.","de":"Fest rund um Glück und Rennen um den 15. März."}'::jsonb, false, 'seed'),
  ('inv-2957', 'invictus', 'expo', 'Invictus Launch Week / DefenseCon 2957', '2027-05-14'::date, '2027-05-27'::date, 'estimated', 'scheduled', true, '', '{"en":"Military ship expo in mid-May with a Free Fly; whether Invictus returns or DefenseCon repeats is open.","de":"Militär-Schiffsmesse Mitte Mai mit Free Fly; ob Invictus zurückkehrt oder die DefenseCon wiederholt wird, ist offen."}'::jsonb, false, 'seed'),
  ('aw-2957', 'alien-week', 'seasonal', 'Alien Week 2957', '2027-06-16'::date, '2027-07-05'::date, 'estimated', 'scheduled', false, '', '{"en":"Celebration of the alien species of the ''verse in mid-June.","de":"Fest der außerirdischen Spezies des Verse Mitte Juni."}'::jsonb, false, 'seed')
on conflict (id) do nothing;
