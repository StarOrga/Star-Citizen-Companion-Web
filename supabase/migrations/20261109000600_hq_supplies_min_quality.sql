-- HQ Bestand concept (docs/concepts/20261108-2135-hq-bestand), checklist I15:
-- "wünschen + einplanen" carries the searched minimum quality ("Eisen Q >= 700") into the Nachschub line.
-- Until now the value lived per line in the browser (localStorage); this column makes it sync across devices.
-- Additive only: a line without it behaves exactly as before. Rollback:
--   alter table public.hq_supplies drop column if exists min_quality;

alter table public.hq_supplies add column if not exists min_quality smallint;
alter table public.hq_supplies drop constraint if exists hq_supplies_min_quality;
alter table public.hq_supplies add constraint hq_supplies_min_quality
  check (min_quality is null or min_quality between 1 and 1000);
comment on column public.hq_supplies.min_quality is
  'Minimum quality 1..1000 the supply must meet (e.g. Eisen Q >= 700); null = any quality.';
