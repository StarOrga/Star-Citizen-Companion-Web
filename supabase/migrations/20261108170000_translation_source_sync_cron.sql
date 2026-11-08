-- Daily community-source sync (concept 2026-11-08, A5): pg_cron calls translate-orchestrator
-- {"op":"sync_sources"} once a day. Like the 10-minute tick it carries only the publishable key;
-- the op only re-imports enabled licensed|permitted translation_sources whose upstream marker
-- (GitHub commit / release tag / ETag) differs from last_seen_commit, so an idle day is a few
-- API calls. pg_cron is already enabled (20260906130000) - never `create extension` it again (2BP01).
--
-- ROLLBACK: select cron.unschedule('translate-orchestrator-sync-sources');

do $$
begin
  if exists (select 1 from cron.job where jobname = 'translate-orchestrator-sync-sources') then
    perform cron.unschedule('translate-orchestrator-sync-sources');
  end if;
end $$;

-- 04:17 UTC, off the :00/:30 marks the other jobs use.
select cron.schedule(
  'translate-orchestrator-sync-sources',
  '17 4 * * *',
  $job$
  select net.http_post(
    url := 'https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/translate-orchestrator',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ"}'::jsonb,
    body := '{"op":"sync_sources"}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$
);
