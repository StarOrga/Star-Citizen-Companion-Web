# Patch Stability Indicator — Design

Date: 2026-09-05 · Branch: `claude/patch-stability-metrics-fe9c09` · Status: approved in conversation, spec pending review

## 1. Goal

Show, per LIVE patch on `/news/patches`, how rough or calm the patch runs — as a
five-level verdict that can go **up and down** over the patch's lifetime, backed
by the community's own voice and CIG's own service/known-issue data. Cumulative
by construction: a problem that survives into the next patch keeps counting
there (it is still an open known issue, still a ticket people link, still an
incident).

Explicitly **not** promised: Issue Council counts (login + backer wall), Reddit
scores (JSON dead since 2026-05-28), any sentiment classification (no LLM — it
costs money and the user declined). The indicator says what it measures.

## 2. Verified data sources (all credential-free, all server-side)

| Source | Endpoint | Gives | History |
|---|---|---|---|
| Spectrum patch-notes forum 190048 | `POST /api/spectrum/forum/channel/threads` (already used) | thread list: `subject`, `slug`, `time_created`, `replies_count`, `votes.count`, `views_count` | full |
| Spectrum thread body | `POST /api/spectrum/forum/thread/nested` (already used by `rsi-roadmap`) | first post as Draft.js blocks + the **25 top-voted replies** with `votes.count`, `time_created`, text. `page` is ignored; `nested_replies_ids` lists all reply ids | live only (top 25 are a snapshot) |
| RSI status page | `https://status.robertsspaceindustries.com/issues/index.json` → `{pages:{…}}` (`is:'issue'`, skip `0001-01-01` sentinel) | `severity` (maintenance/degraded/partial/major/major-outage), `createdAt`, `resolvedAt`, `resolved`, `affected[]` | back to 2020 |
| CIG Known Issues KB | `https://support.robertsspaceindustries.com/api/v2/help_center/en-us/articles/360056254754.json` | one evergreen article, retitled per patch; `h2/h3` entries with stable `h_…` anchor ids under 7 `h1` sections (55 entries for 4.10) | live only (Wayback snapshots are all the stale 3.22 body) |

Thread roles per LIVE patch line: the `… LIVE Release Notes` thread (RN) and the
`… LIVE - Hotfix Central …` thread (HF). HF threads before 4.9 were locked
(0 replies) — HF reply metrics are only comparable from 4.9 on. The HF first
post lists every hotfix as a `blockquote` starting with `►M.D.YYYY:`; STARC ids
appear inline. RN first posts carry the CIG sentence "contains over N bug and
crash fixes … M of which originated from the issue council" — 4.8 and 4.9 have
the identical sentence (copy-paste), so it is displayed as CIG's claim, never
scored.

## 3. Score model

Hotfix *count* is not a state signal (ambiguous, monotonic). Hotfixes are
**event markers** on the timeline only.

Three components, each 0…1, sampled once per day per patch line:

**Community pressure (weight 0.5)** — hard numbers only, no keyword guessing:
- `reply_velocity`: new RN+HF replies per day (delta of `replies_count`
  between samples). Normalised against the same day-offset of earlier patches
  once ≥ 2 patches have daily history; until then against fixed bands
  (< 2 → 0, 2–20 → linear, ≥ 20 → 1).
- `ticket_share`: share of the 50 top replies (25 RN + 25 HF) that link an
  Issue Council ticket (`STARC-\d+` or `issue-council.robertsspaceindustries.com/…/issues/`).
- `ticket_vote_share`: upvotes on ticket-bearing top replies ÷ all top-reply
  upvotes.
- community = 0.4·velocity + 0.3·ticket_share + 0.3·ticket_vote_share

**Service (weight 0.3)**:
- `outage_7d`: unplanned (`severity != maintenance`) minutes per day over the
  trailing 7 days, log-scaled, 300 min/day = 1.
- `open_incident`: 1 if an unresolved unplanned incident exists today, else 0.
- service = 0.7·outage_7d + 0.3·open_incident

**CIG open issues (weight 0.2)**:
- `kb_open`: anchored entries in the KB article, bands 0–20 → 0, 20–80 → linear, ≥ 80 → 1.
- `kb_delta_7d`: net entries added over 7 days, +10 → 1, ≤ 0 → 0.
- cig = 0.7·kb_open + 0.3·kb_delta_7d

**Score** — the worst component dominates, because a patch with 8 days of
degraded servers is unstable no matter how quiet the forum is, and vice versa:

    score = 0.7 · max(components) + 0.3 · weighted mean(components)

with weights community 0.5, service 0.3, cig 0.2, the mean renormalised over
the components that have data (historical patches have no CIG component; a
patch with no HF thread uses RN only). Velocity band is 2–20 replies/day.
**Level** = 1 if score < 0.18, 2 < 0.33, 3 < 0.48, 4 < 0.63, else 5.

Worked calibration (end-state inputs from the 2026-09-05 probes):

| line | velocity | ticket share | ticket vote share | outage min/day | kb open | score | level |
|---|---|---|---|---|---|---|---|
| 4.7 | 4.3 | 0.16 | 0.10 | 5 | – | 0.20 | 2 |
| 4.8 | 3.4 | 0.00 | 0.00 | 209 | – | 0.53 | 4 |
| 4.9 | 2.3 | 0.18 | 0.59 | 0 | – | 0.21 | 2 |
| 4.10 (day 10) | 35 | 0.20 | 0.11 | 0 | 55 | 0.44 | 3 |

**Minimum data rule**: no level is shown unless the patch has ≥ 2 daily samples
and ≥ 10 total replies; the UI shows "zu wenig Daten" instead.

**Early flag**: `days_live < 14` (hotfix bursts ended at day 14 / 32 / 48 for
4.9 / 4.7 / 4.8; 14 is the floor). Rendered as dashed chip border, hatched
zone on the timeline, and the caption "Tag X von 14".

Calibration against the hand-classified reality check (2026-09-05): 4.7 → 2,
4.8 → 4 (service), 4.9 → 2, 4.10 → 3 early. The component
weights are constants in one place and must reproduce this ordering in the
unit tests.

### Levels (mobiGlas ship-status vocabulary)

| Level | de | en | colour token |
|---|---|---|---|
| 1 | Alle Systeme nominal | All systems nominal | `--sc-success` |
| 2 | Leichte Turbulenzen | Minor turbulence | `--sc-accent` |
| 3 | Systeme beeinträchtigt | Systems degraded | `--sc-warning` |
| 4 | Instabil | Unstable | `--sc-warn` (`--sc-accent-hot` stays reserved for elevated access) |
| 5 | Kritisch | Critical | `--sc-danger` |

## 4. Data model (Supabase)

```sql
create table patch_stability_patches (
  patch_line        text primary key,           -- '4.10'
  live_at           timestamptz not null,        -- RN thread time_created
  notes_thread_id   bigint not null,
  notes_slug        text not null,
  hotfix_thread_id  bigint,
  hotfix_slug       text,
  cig_fixes         int,                         -- from the CIG sentence, display only
  cig_fixes_ic      int,
  cig_crash_fixes   int,
  cig_exploit_fixes int,
  -- historical end-state, filled by backfill for patches that predate the
  -- sampler. RAW numbers only: the level is computed client-side with the same
  -- formula as the daily series, so the formula lives in exactly one place.
  final_replies     int,
  final_outage_min_per_day numeric,
  final_ticket_share numeric,
  final_ticket_vote_share numeric,
  updated_at        timestamptz not null default now()
);

create table patch_stability_samples (
  patch_line        text not null references patch_stability_patches,
  sampled_on        date not null,
  rn_replies        int not null,
  rn_votes          int not null,
  hf_replies        int,
  hf_votes          int,
  top_ticket_share  numeric not null,            -- 0..1 over the 50 top replies
  top_ticket_vote_share numeric not null,
  top_tickets       jsonb not null default '[]', -- [{id:'STARC-…', votes:n, excerpt:text}] max 10, for the "was die Community meldet" list
  hotfix_events     jsonb not null default '[]', -- [{date:'2026-09-03', build:'12572603', text:'…'}] parsed from the HF first post
  outage_min_7d     numeric not null,
  open_incident     boolean not null,
  kb_open_total     int,                         -- null when the KB article names another patch
  kb_by_section     jsonb,
  kb_anchor_ids     text[],
  kb_edited_at      timestamptz,
  primary key (patch_line, sampled_on)
);
```

RLS: anon + authenticated `select`, writes service-role only (same pattern as
`rsi_patch_cache`). Alpha data policy: both tables are new, nothing dropped.

## 5. Sampler edge function `patch-stability-sample`

`verify_jwt = false`, service role inside. Self-throttled: returns
`{skipped:true}` when the newest sample for the current patch line is younger
than 6 h, so an unauthenticated trigger cannot cause upstream load. One run:

1. Thread list (2 pages of forum 190048) → detect LIVE RN/HF threads, upsert
   `patch_stability_patches` (new patch line = new row; CIG sentence parsed
   from the RN first post).
2. For the current patch line **and the previous one** (its threads still
   receive comments): fetch RN + HF nested threads → reply counts, votes, top-25
   ticket metrics, hotfix events.
3. Status `issues/index.json` → `outage_min_7d`, `open_incident`.
4. KB article → `kb_*` (only if the title names the current patch line, else null).
5. Insert today's sample rows (upsert on `(patch_line, sampled_on)`).

`?backfill=1` (one-shot, idempotent): registers every LIVE patch since 3.24.1
with `live_at`, thread ids, CIG sentence, `final_replies` (release-notes thread
only — Hotfix Central was locked before 4.9, so RN is the count comparable
across every line),
`final_outage_min_per_day`, `final_ticket_share` and `final_ticket_vote_share`
(from the top replies of RN + HF). The client turns those into the end-state
level (velocity = replies ÷ live days, no CIG component).

Scheduling: `pg_cron` + `pg_net` migration, daily 06:00 UTC, `net.http_post`
to the function URL with no secret (the function is self-throttled and only
mirrors public data). Both extensions enabled in the migration. Deploy order:
function first, then migration (documented in the migration header).

## 6. Client

**Pure module `src/app/news/patch-stability.ts`** — types, the score/level
formula, early flag, minimum-data rule, day-series → level-series, all-time
end-state list. Fully unit-tested without TestBed (like `patch-stats.ts`),
including the calibration fixture (4.7/4.8/4.9/4.10 sample rows → expected
levels).

**`PatchStabilityService`** (`providedIn: 'root'`): loads both tables via
`supabase.from(...)` on first use, exposes `series(line)`, `latest(line)`,
`allTime()` signals. No service-worker data group needed (rows are small; the
`freshness` SW strategy for functions does not apply to REST).

**UI, three layers, all with the existing CSS-bar grammar
(`patch-cadence.component.ts` `.chart/.col/.col-bar/.avg-rule`):**

1. `patch-entry-row` — a `<sc-stability-chip>` after the stage tag for LIVE
   entries only: level word, colour token, dashed border + "Tag X/14" when early,
   hidden when the minimum-data rule fails.
2. `patch-note-detail` (expanded row) — `<sc-stability-panel>` block above the
   outline sections: headline (level word + score), three component bars
   (Community / Dienste / CIG) with the raw numbers in the tooltip, a daily
   strip chart (one column per sampled day, height = score, colour = level,
   hatched background for days < 14, hotfix events as tick marks with the build
   number on hover), and "Was die Community meldet": the top tickets as
   `<a href target=_blank rel=noopener>` links to the Issue Council with their
   vote count. Historical patches (no samples) show the end-state level plus the
   caption "Endstand, kein Tagesverlauf (vor Sampler-Start)".
3. `patch-notes-section` — `<sc-stability-history>` next to the cadence KPIs:
   one column per LIVE patch line (all-time), height = final or current score,
   colour = level, the current line hatched while early; each column is an
   anchor that expands that patch's row.

All strings under `news.patch.stability.*` in `de.json`/`en.json`, level names
under `news.patch.stability.level.<1..5>`.

## 7. Error handling

- Sampler: every upstream call has its own try/catch; a failed source leaves
  its columns null and the sample row is still written (partial data is
  better than a gap). Function logs which source failed.
- Client: missing tables/rows → chip hidden, panel shows "keine Daten"; never
  blocks the patch board.
- Score: components with null inputs are dropped and the weights renormalised;
  a sample with zero available components yields no level.

## 8. Testing

- `patch-stability.spec.ts`: formula, renormalisation, bands, level thresholds,
  early flag, minimum-data rule, calibration fixture ordering.
- Sampler: Deno unit tests for the pure parsers (hotfix `►` blocks, CIG
  sentence, STARC extraction, status window maths, KB anchor count) with
  fixtures captured from the 2026-09-05 probes.
- Component specs: chip visibility rules (early / insufficient data / non-LIVE),
  panel renders end-state fallback.
- Gates: `npm run typecheck`, `npm run build` (templates!), `npm test`.

## 9. Out of scope (later)

Reddit RSS keyword rate (titles only, no scores), same-day-offset baseline once
≥ 2 patches have daily history (the code path exists, the data does not yet),
deriving the 14-day threshold from data, a shareable per-patch route.
