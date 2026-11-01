-- HQ (beta) - community reports + robust median (plan section 3.5, D43).
--
-- Source order for "where do I get it": Log -> Suche -> Community -> OCR. Community data
-- is the MEDIAN of >= 5 reports with outliers removed. Reports come from live
-- `shop.purchase` events (price / stock / location) and are opt-in ("Community-Daten
-- teilen", default OFF - enforced client-side, the server cannot know the toggle; the
-- table accepts only the caller's own rows).
--
-- Alpha-phase data policy: purely additive, nothing dropped.
--
-- Privacy design
--   * Reports are INSERT-only for users: no select policy, no select grant. Nobody can
--     read raw reports (not even their own) - the only read path is the aggregate RPC.
--   * hq_community_median() is SECURITY DEFINER but returns aggregates only, and only for
--     locations with reports from >= 5 DISTINCT users (one user's latest report per
--     location counts once, so a single account cannot create or steer a median).
--   * Outliers: Tukey IQR fences (1.5 x IQR) on the per-user latest values.
--   * Abuse: <= 200 inserts per user per rolling day, <= 3000 rows per user (oldest pruned),
--     90-day window in the RPC, 120-day retention via pg_cron.

create table if not exists public.hq_community_reports (
  id          bigserial   primary key,
  user_id     uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  kind        text        not null,
  class_name  text        not null,
  location    text        not null,
  value       numeric     not null,
  reported_at timestamptz not null default now(),

  constraint hq_community_kind       check (kind in ('price', 'stock', 'location')),
  constraint hq_community_class_len  check (char_length(btrim(class_name)) between 1 and 200),
  constraint hq_community_loc_len    check (char_length(btrim(location)) between 1 and 200),
  constraint hq_community_value      check (value >= 0 and value <= 1000000000000)
);

comment on table public.hq_community_reports is
  'Opt-in community observations (price/stock/location) from live shop events. INSERT-only for users (no select); '
  'read only through hq_community_median(). Retention 120 days (pg_cron hq-community-retention).';
comment on column public.hq_community_reports.value is
  'kind=price: aUEC per unit; kind=stock: units in stock; kind=location: 1 (the item was seen at this location).';

create index if not exists hq_community_lookup_idx
  on public.hq_community_reports (kind, class_name, location, user_id, reported_at desc);
create index if not exists hq_community_user_idx on public.hq_community_reports (user_id, reported_at desc);
create index if not exists hq_community_reported_idx on public.hq_community_reports (reported_at);

-- Server-side clamp (a client must not back-date reports into the window) + rate limit + row cap.
create or replace function public.hq_community_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.reported_at := now();

  perform pg_advisory_xact_lock(hashtextextended('hq_community_reports:' || new.user_id::text, 0));

  if (select count(*) from public.hq_community_reports
       where user_id = new.user_id and reported_at > now() - interval '1 day') >= 200 then
    raise exception 'hq_community_reports: rate limit (200 per day)' using errcode = 'check_violation';
  end if;

  if (select count(*) from public.hq_community_reports where user_id = new.user_id) >= 3000 then
    delete from public.hq_community_reports
     where id in (select id from public.hq_community_reports
                   where user_id = new.user_id order by reported_at asc limit 300);
  end if;

  return new;
end;
$$;
revoke all on function public.hq_community_before_insert() from public, anon, authenticated;

drop trigger if exists hq_community_before_insert on public.hq_community_reports;
create trigger hq_community_before_insert
  before insert on public.hq_community_reports
  for each row execute function public.hq_community_before_insert();

alter table public.hq_community_reports enable row level security;

revoke all on table public.hq_community_reports from anon, authenticated;
grant insert on table public.hq_community_reports to authenticated;
grant usage on sequence public.hq_community_reports_id_seq to authenticated;

drop policy if exists hq_community_insert_own on public.hq_community_reports;
create policy hq_community_insert_own on public.hq_community_reports
  for insert to authenticated with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- hq_community_median(kind, class_name)
--   -> one row per location with >= 5 distinct reporting users in the last 90 days:
--      median (outliers removed), n (reports kept after outlier removal), newest.
-- ---------------------------------------------------------------------------
create or replace function public.hq_community_median(p_kind text, p_class_name text)
returns table (location text, median numeric, n integer, newest timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with latest as materialized (
    -- one (latest) report per user and location
    select distinct on (r.location, r.user_id)
           r.location, r.user_id, r.value, r.reported_at
      from public.hq_community_reports r
     where r.kind = p_kind
       and r.class_name = p_class_name
       and r.reported_at > now() - interval '90 days'
     order by r.location, r.user_id, r.reported_at desc
  ),
  gated as materialized (
    select l.location
      from latest l
     group by l.location
    having count(*) >= 5
  ),
  fences as materialized (
    select l.location,
           percentile_cont(0.25) within group (order by l.value) as q1,
           percentile_cont(0.75) within group (order by l.value) as q3
      from latest l
      join gated g using (location)
     group by l.location
  ),
  kept as (
    select l.location, l.value, l.reported_at
      from latest l
      join fences f using (location)
     where l.value >= f.q1 - 1.5 * (f.q3 - f.q1)
       and l.value <= f.q3 + 1.5 * (f.q3 - f.q1)
  )
  select k.location,
         (percentile_cont(0.5) within group (order by k.value))::numeric as median,
         count(*)::integer as n,
         max(k.reported_at) as newest
    from kept k
   group by k.location
   order by k.location
$$;

revoke all on function public.hq_community_median(text, text) from public, anon;
grant execute on function public.hq_community_median(text, text) to authenticated;

comment on function public.hq_community_median(text, text) is
  'Community median per location. Only locations with reports from >= 5 distinct users (latest per user, last 90 days); '
  'IQR (1.5x) outliers removed; n = reports kept. SECURITY DEFINER, aggregates only.';

-- Retention: nightly 03:40 UTC. ROLLBACK: select cron.unschedule('hq-community-retention');
-- (pg_cron is already enabled - never repeat `create extension pg_cron`, 2BP01.)
select cron.schedule(
  'hq-community-retention',
  '40 3 * * *',
  $job$ delete from public.hq_community_reports where reported_at < now() - interval '120 days' $job$
);
