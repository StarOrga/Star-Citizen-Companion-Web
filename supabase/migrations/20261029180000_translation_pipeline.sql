-- Game-string translation pipeline (docs/translation/ARCHITECTURE.md).
--
-- Small relational state for the AI translation of Star Citizen's global.ini:
-- settings (off by default), approved languages, one job per (build, lang),
-- the spend ledger and the admin glossary with a change history. Translation
-- memory and overlays live in R2, not here (500 MB DB budget, storage.md).
--
-- Alpha data policy: new tables only, nothing dropped; every table is
-- admin-only (public.is_admin()), the edge functions use the service role
-- (bypasses RLS). Nothing is readable by anon or plain authenticated users.
--
-- Also: codex_builds.game_build_manifest (the game's build_manifest.id, sent
-- by the uploader on `init`) and a pg_cron tick for translate-orchestrator.
-- pg_cron is already enabled (20260906130000) - never `create extension` it
-- again (2BP01).
--
-- ROLLBACK: select cron.unschedule('translate-orchestrator-tick');
--           drop table public.translation_glossary_history, public.translation_glossary,
--             public.translation_ledger, public.translation_jobs,
--             public.translation_languages, public.translation_settings;
--           drop function public.translation_glossary_audit();
--           alter table public.codex_builds drop column game_build_manifest;

alter table public.codex_builds add column if not exists game_build_manifest jsonb;

-- ------------------------------------------------------------ settings
create table if not exists public.translation_settings (
  id              smallint primary key default 1 check (id = 1),
  enabled         boolean not null default false,
  upload_cap_usd  numeric not null default 20 check (upload_cap_usd >= 0),
  monthly_cap_usd numeric not null default 190 check (monthly_cap_usd >= 0),
  lore_model      text not null default 'claude-opus-5-5',
  rest_model      text not null default 'claude-sonnet-5-5',
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users(id) on delete set null
);
insert into public.translation_settings (id) values (1) on conflict (id) do nothing;

-- ------------------------------------------------------------ languages
create table if not exists public.translation_languages (
  lang        text primary key,
  cig_folder  text not null,
  approved    boolean not null default false,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null
);
-- Seed from FOLDER_LANG_MAP (data-uploader/python/sc_extract/localization.py),
-- English excluded; the first folder candidate per code. Only German is approved.
insert into public.translation_languages (lang, cig_folder, approved, approved_at) values
  ('de',      'german_(germany)',        true,  now()),
  ('fr',      'french_(france)',         false, null),
  ('it',      'italian_(italy)',         false, null),
  ('es',      'spanish_(spain)',         false, null),
  ('es-419',  'spanish_(latin_america)', false, null),
  ('pl',      'polish_(poland)',         false, null),
  ('pt-BR',   'portuguese_(brazil)',     false, null),
  ('zh-Hans', 'chinese_(simplified)',    false, null),
  ('zh-Hant', 'chinese_(traditional)',   false, null),
  ('ja',      'japanese_(japan)',        false, null),
  ('ko',      'korean_(south_korea)',    false, null),
  ('ru',      'russian_(russia)',        false, null),
  ('tr',      'turkish_(turkey)',        false, null)
on conflict (lang) do nothing;

-- ------------------------------------------------------------ jobs
create table if not exists public.translation_jobs (
  id           uuid primary key default gen_random_uuid(),
  build_id     uuid not null references public.codex_builds(id) on delete cascade,
  lang         text not null,
  -- 'delta' = only keys changed vs base_build_id (the only automatic mode);
  -- 'full' = the whole gap, admin-started only. base_build_id null = no previous
  -- build of the channel (the orchestrator marks a delta job skipped).
  mode         text not null default 'delta' check (mode in ('delta','full')),
  base_build_id uuid references public.codex_builds(id) on delete set null,
  status       text not null default 'estimating' check (status in (
    'estimating','awaiting_approval','queued','submitted','validating',
    'post_editing','publishing','published','failed','cancelled','skipped')),
  string_count integer,
  estimate_usd numeric,
  spent_usd    numeric not null default 0,
  batch_ids    jsonb not null default '[]'::jsonb,
  stats        jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  approved_by  uuid references auth.users(id) on delete set null,
  unique (build_id, lang, mode)
);
create index if not exists translation_jobs_open_idx on public.translation_jobs (status)
  where status not in ('published','failed','cancelled','skipped');

-- ------------------------------------------------------------ ledger
create table if not exists public.translation_ledger (
  id         bigint generated always as identity primary key,
  job_id     uuid not null references public.translation_jobs(id) on delete cascade,
  month      date not null check (month = date_trunc('month', month)::date),
  usd        numeric not null,
  created_at timestamptz not null default now()
);
create index if not exists translation_ledger_month_idx on public.translation_ledger (month);
create index if not exists translation_ledger_job_idx on public.translation_ledger (job_id);

-- ------------------------------------------------------------ glossary
create table if not exists public.translation_glossary (
  id                uuid primary key default gen_random_uuid(),
  lang              text not null,
  source_term       text not null,
  target_term       text not null,
  category          text not null default 'term' check (category in ('term','label','unit','dnt')),
  origin            text not null default 'ai' check (origin in ('cig','ai','admin')),
  locked            boolean not null default false,
  needs_retranslate boolean not null default false,
  updated_by        uuid references auth.users(id) on delete set null,
  updated_at        timestamptz not null default now()
);
create unique index if not exists translation_glossary_term_uidx
  on public.translation_glossary (lang, lower(source_term));

create table if not exists public.translation_glossary_history (
  id          bigint generated always as identity primary key,
  glossary_id uuid not null,   -- no FK: the history outlives a deleted entry
  before      jsonb,
  after       jsonb,
  actor       uuid,
  at          timestamptz not null default now()
);
create index if not exists translation_glossary_history_entry_idx
  on public.translation_glossary_history (glossary_id, at desc);

-- SECURITY DEFINER so the audit row is written regardless of the caller's RLS.
create or replace function public.translation_glossary_audit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    insert into public.translation_glossary_history (glossary_id, before, after, actor)
    values (old.id, to_jsonb(old), to_jsonb(new), coalesce((select auth.uid()), new.updated_by));
    return new;
  end if;
  insert into public.translation_glossary_history (glossary_id, before, after, actor)
  values (old.id, to_jsonb(old), null, (select auth.uid()));
  return old;
end $$;
revoke all on function public.translation_glossary_audit() from public, anon, authenticated;

drop trigger if exists translation_glossary_audit on public.translation_glossary;
create trigger translation_glossary_audit
  after update or delete on public.translation_glossary
  for each row execute function public.translation_glossary_audit();

-- ------------------------------------------------------------ RLS
-- Admin-only for every table; the service role bypasses RLS. The history is
-- written by the trigger only, so admins get select there and nothing else.
alter table public.translation_settings enable row level security;
alter table public.translation_languages enable row level security;
alter table public.translation_jobs enable row level security;
alter table public.translation_ledger enable row level security;
alter table public.translation_glossary enable row level security;
alter table public.translation_glossary_history enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'translation_settings','translation_languages','translation_jobs',
    'translation_ledger','translation_glossary']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format(
      'create policy %I on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t || '_admin_all', t);
  end loop;
end $$;

drop policy if exists translation_glossary_history_admin_read on public.translation_glossary_history;
create policy translation_glossary_history_admin_read on public.translation_glossary_history
  for select to authenticated using (public.is_admin());

revoke all on public.translation_settings, public.translation_languages,
  public.translation_jobs, public.translation_ledger, public.translation_glossary,
  public.translation_glossary_history from anon;

-- ------------------------------------------------------------ schedule
-- Every 10 minutes. Like sc-events-sync the cron call carries only the
-- publishable key; {"op":"tick"} is idempotent (compare-and-set on job status)
-- and spends nothing unless translation_settings.enabled and a job is open.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'translate-orchestrator-tick') then
    perform cron.unschedule('translate-orchestrator-tick');
  end if;
end $$;

select cron.schedule(
  'translate-orchestrator-tick',
  '*/10 * * * *',
  $job$
  select net.http_post(
    url := 'https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/translate-orchestrator',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ"}'::jsonb,
    body := '{"op":"tick"}'::jsonb,
    timeout_milliseconds := 120000
  );
  $job$
);
