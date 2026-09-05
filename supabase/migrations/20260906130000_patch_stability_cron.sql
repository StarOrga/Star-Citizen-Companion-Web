-- Daily trigger for the patch-stability sampler.
--
-- The repo had no scheduler until now (no pg_cron, no GitHub schedule). pg_cron
-- + pg_net is the in-repo option: nothing to babysit on the dev PC, no second
-- CI secret, and the job definition is versioned here.
--
-- DEPLOY ORDER: the edge function must exist before this job fires -- CI deploys
-- `patch-stability-sample` on merge (edge-functions-deploy.yml); apply this
-- migration afterwards (`npm run db:push` from the primary checkout).
--
-- The request carries the PUBLISHABLE key only (it is already in the client
-- bundle). The function does its own throttling; see its header.
--
-- ROLLBACK: `select cron.unschedule('patch-stability-sample');` -- the
-- pg_cron/pg_net extensions can stay enabled, they are harmless.

create extension if not exists pg_cron;
create extension if not exists pg_net;

grant usage on schema cron to postgres;
-- The DO block below reads cron.job directly; USAGE alone does not grant SELECT
-- (Supabase's documented pg_cron + pg_net recipe pairs both grants).
grant all privileges on all tables in schema cron to postgres;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'patch-stability-sample') then
    perform cron.unschedule('patch-stability-sample');
  end if;
end $$;

select cron.schedule(
  'patch-stability-sample',
  '0 6 * * *',
  $job$
  select net.http_post(
    url     := 'https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/patch-stability-sample',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ"}'::jsonb,
    body    := '{}'::jsonb,
    timeout_milliseconds := 60000
  );
  $job$
);
