-- Patch stability indicator (spec: docs/superpowers/specs/2026-09-05-patch-stability-indicator-design.md).
--
-- Two tables the `patch-stability-sample` edge function writes once a day and
-- the patch board reads: which LIVE patch lines exist (with the Spectrum
-- threads they live in and, for lines older than the sampler, their measured
-- end-state), and one sample row per line per day with the raw numbers the
-- client turns into a five-level verdict.
--
-- RAW NUMBERS ONLY. No level, no score is stored: the formula lives in
-- src/app/news/patch-stability.ts and must exist in exactly one place.
--
-- Public data (Spectrum comment counts, the RSI status page, CIG's Known
-- Issues article), so anon may read. Writes are service-role only.
-- Alpha data policy: both tables are new, nothing is dropped.

create table if not exists public.patch_stability_patches (
  patch_line               text primary key,
  live_at                  timestamptz not null,
  notes_thread_id          bigint not null,
  notes_slug               text not null,
  hotfix_thread_id         bigint,
  hotfix_slug              text,
  cig_fixes                int,
  cig_fixes_ic             int,
  cig_crash_fixes          int,
  cig_exploit_fixes        int,
  final_replies            int,
  final_outage_min_per_day numeric,
  final_ticket_share       numeric,
  final_ticket_vote_share  numeric,
  updated_at               timestamptz not null default now()
);

comment on table public.patch_stability_patches is
  'One row per LIVE patch line (4.10, 4.9, …): its Spectrum release-notes and '
  'Hotfix-Central threads, the fix counts CIG states in the notes (display '
  'only — 4.8 and 4.9 carry the identical copy-pasted sentence), and for lines '
  'that predate the sampler the measured end-state (final_*). Written by the '
  'patch-stability-sample edge function only.';

create table if not exists public.patch_stability_samples (
  patch_line            text not null references public.patch_stability_patches (patch_line) on delete cascade,
  sampled_on            date not null,
  sampled_at            timestamptz not null default now(),
  rn_replies            int not null,
  rn_votes              int not null,
  hf_replies            int,
  hf_votes              int,
  top_ticket_share      numeric not null,
  top_ticket_vote_share numeric not null,
  top_tickets           jsonb not null default '[]'::jsonb,
  hotfix_events         jsonb not null default '[]'::jsonb,
  outage_min_7d         numeric not null,
  open_incident         boolean not null,
  kb_open_total         int,
  kb_by_section         jsonb,
  kb_anchor_ids         text[],
  kb_edited_at          timestamptz,
  primary key (patch_line, sampled_on)
);

comment on table public.patch_stability_samples is
  'Daily raw sample per patch line: Spectrum reply/vote counts of the two LIVE '
  'threads, Issue-Council ticket density of the 50 top replies, hotfix events '
  'parsed from Hotfix Central, unplanned status-page minutes over the trailing '
  '7 days, and the CIG Known-Issues article (null when the article names a '
  'different patch). The client computes the level; nothing derived is stored.';

comment on column public.patch_stability_samples.sampled_at is
  'Wall-clock time of the run — the edge function skips a run when the newest '
  'row is younger than 6 h, so an unauthenticated trigger cannot cause load.';

create index if not exists patch_stability_samples_line_day_idx
  on public.patch_stability_samples (patch_line, sampled_on desc);

alter table public.patch_stability_patches enable row level security;
alter table public.patch_stability_samples enable row level security;

drop policy if exists patch_stability_patches_public_read on public.patch_stability_patches;
create policy patch_stability_patches_public_read on public.patch_stability_patches
  for select to anon, authenticated using (true);

drop policy if exists patch_stability_samples_public_read on public.patch_stability_samples;
create policy patch_stability_samples_public_read on public.patch_stability_samples
  for select to anon, authenticated using (true);

revoke insert, update, delete, truncate on public.patch_stability_patches from anon, authenticated;
revoke insert, update, delete, truncate on public.patch_stability_samples from anon, authenticated;
grant select on public.patch_stability_patches to anon, authenticated;
grant select on public.patch_stability_samples to anon, authenticated;
