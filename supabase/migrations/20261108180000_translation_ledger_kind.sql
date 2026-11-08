-- Translation ledger: job-less rows for learning spend.
--
-- Until now translation_ledger.job_id was NOT NULL, so arbiter / learning / web-research spend was
-- booked on the newest translation job and the web-research cap was summed from R2 files. Now:
--   * job_id is nullable (learning has no job),
--   * kind says what the row paid for: job (default, every existing row) | learn | arbiter | align |
--     haiku | web,
--   * lang names the language of a job-less row (job rows keep it on the job).
-- monthCommitted still sums every row of the month, so the monthly cap includes all kinds; the web
-- cap sums kind = 'web'.
--
-- Alpha policy: old learning spend booked on carrier jobs stays kind 'job' (not reclassified).
-- ROLLBACK: delete from public.translation_ledger where job_id is null;
--           alter table public.translation_ledger drop constraint translation_ledger_kind_check,
--             drop constraint translation_ledger_job_kind_check,
--             drop column kind, drop column lang, alter column job_id set not null;
--           drop index if exists public.translation_ledger_month_kind_idx;

alter table public.translation_ledger alter column job_id drop not null;
alter table public.translation_ledger add column if not exists kind text not null default 'job';
alter table public.translation_ledger add column if not exists lang text;

alter table public.translation_ledger drop constraint if exists translation_ledger_kind_check;
alter table public.translation_ledger add constraint translation_ledger_kind_check
  check (kind in ('job', 'learn', 'arbiter', 'align', 'haiku', 'web'));
-- A row has a job, or it is a job-less learning row that names its language.
alter table public.translation_ledger drop constraint if exists translation_ledger_job_kind_check;
alter table public.translation_ledger add constraint translation_ledger_job_kind_check
  check (job_id is not null or (kind <> 'job' and lang is not null));

create index if not exists translation_ledger_month_kind_idx on public.translation_ledger (month, kind);
