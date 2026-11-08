-- Events als Nachschub, wave 2 - schedule the sheet extraction (edge function sc-event-sheet, concept C2).
-- Every 6 h at :37 (sc-events-sync runs at :17, so fresh comm-links are already matched). The function decides per
-- event whether a pass is due (new comm-link, running event once a day, upcoming event every 3 days, one last pass after
-- the end), skips unchanged source text without an LLM call and caps itself at 3 LLM calls per run. pg_cron is already
-- installed by 20261016120000_sc_events.sql - the extension is NOT created again here (2BP01).
-- ROLLBACK: select cron.unschedule('sc-event-sheet');
do $$
begin
  if exists (select 1 from cron.job where jobname = 'sc-event-sheet') then
    perform cron.unschedule('sc-event-sheet');
  end if;
end $$;

select cron.schedule(
  'sc-event-sheet',
  '37 */6 * * *',
  $job$
  select net.http_post(
    url := 'https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/sc-event-sheet',
    headers := '{"Content-Type":"application/json","apikey":"sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 150000
  );
  $job$
);
