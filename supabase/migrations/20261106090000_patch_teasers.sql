-- AI teaser titles for the Verse hero's patch story ("Neues in 4.10.3" is the
-- fallback, a teaser replaces it where one exists).
--
-- verse_digest() is deliberately NOT touched: its newest definition
-- (20261028120000_patch_channel_builds.sql) already carries the full versions
-- (patch.channels, build:<channel>:<version> item keys), the client builds the
-- title text from those. Teasers are a separate, tiny public-read table the
-- client reads once; written only by the patch-teaser edge function (service role).
--
-- Alpha policy: new table, nothing dropped.
-- ROLLBACK: drop table public.patch_teasers; (+ the sweep rollback below)

create table if not exists public.patch_teasers (
  version       text primary key,
  title_de      text not null check (char_length(title_de) between 1 and 44),
  title_en      text not null check (char_length(title_en) between 1 and 44),
  model         text,
  generated_at  timestamptz not null default now()
);

alter table public.patch_teasers enable row level security;

drop policy if exists patch_teasers_public_read on public.patch_teasers;
create policy patch_teasers_public_read on public.patch_teasers
  for select using (true);

revoke insert, update, delete, truncate on public.patch_teasers from anon, authenticated;
grant select on public.patch_teasers to anon, authenticated;

comment on table public.patch_teasers is
  'AI teaser titles (<= 44 chars, DE + EN) per full patch version, written by patch-teaser. Fallback in the client: "Neues in <version>".';


-- Attempt log of the sweep: a version tried within the last 6 h (success or
-- failure) is not tried again, so an open call to the sweep cannot burn tokens.
-- Server-side only: RLS on, no policies, nothing granted to anon / authenticated.
create table if not exists public.patch_teaser_tries (
  version   text primary key,
  tried_at  timestamptz not null default now()
);
alter table public.patch_teaser_tries enable row level security;
revoke all on public.patch_teaser_tries from anon, authenticated;

-- Daily sweep, 30 min after the patch-stability sampler (06:00) has refreshed
-- patch_channel_builds. Same recipe as 20260906130000_patch_stability_cron.sql;
-- pg_cron / pg_net are already enabled there, so no create extension here.
-- The request carries the publishable key only; the sweep needs nothing more.
-- DEPLOY ORDER: deploy the patch-teaser edge function before applying this.
-- ROLLBACK: select cron.unschedule('patch-teaser-sweep'); drop table public.patch_teaser_tries;
do $$
begin
  if exists (select 1 from cron.job where jobname = 'patch-teaser-sweep') then
    perform cron.unschedule('patch-teaser-sweep');
  end if;
end $$;

select cron.schedule(
  'patch-teaser-sweep',
  '30 6 * * *',
  $job$
  select net.http_post(
    url     := 'https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/patch-teaser',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ"}'::jsonb,
    body    := '{"sweep":true}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);

notify pgrst, 'reload schema';
