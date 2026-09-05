# Patch Stability Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A five-level "how rough does this patch run" verdict per LIVE patch on `/news/patches`, sampled daily from Spectrum comment metrics, the RSI status page and CIG's Known-Issues article, with a per-patch day timeline and an all-time comparison.

**Architecture:** A new edge function `patch-stability-sample` writes one row per patch line per day into `patch_stability_samples` (plus a `patch_stability_patches` registry with historical end-states), triggered by `pg_cron` + `pg_net`. The client reads both tables through the existing anon Supabase client, computes score/level in ONE pure module (`patch-stability.ts`) and renders three small components with the CSS-bar grammar the cadence panel already uses.

**Tech Stack:** Angular 21 standalone + signals, ngx-translate, Supabase (Postgres + Deno edge function + pg_cron/pg_net), Karma/Jasmine for client, `node --test` for the function's pure parsers.

Spec: `docs/superpowers/specs/2026-09-05-patch-stability-indicator-design.md`

## Global Constraints

- All user-facing strings via ngx-translate; keys under `news.patch.stability.*` in `public/i18n/de.json` AND `public/i18n/en.json` (the other locale files are not touched).
- Navigations are real anchors (`<a href target="_blank" rel="noopener noreferrer">` for Issue Council links); actions stay `<button>`.
- Colour tokens: level 1 `--sc-success`, 2 `--sc-accent`, 3 `--sc-warning`, 4 `--sc-warn`, 5 `--sc-danger`. `--sc-accent-hot` is NOT used (reserved for elevated access).
- No API keys in the repo or bundle; the sampler uses only public endpoints; the cron migration may contain the PUBLISHABLE key (`sb_publishable_ZWbS9qWheOQB0s77mlWLvw_wEcmTVDQ`, already in `environment.ts`), never the service-role key.
- Standalone components, `ChangeDetectionStrategy.OnPush`, `providedIn: 'root'` services.
- Formula constants live only in `src/app/news/patch-stability.ts`; the edge function stores raw numbers, never levels.
- Score: `0.7 · max(components) + 0.3 · weighted mean` (weights community 0.5 / service 0.3 / cig 0.2, renormalised over present components); level thresholds 0.18 / 0.33 / 0.48 / 0.63; early = `daysLive < 14`; minimum data = ≥ 2 samples and ≥ 10 replies.
- Migration prefixes must be unique against `origin/main` at merge time (see memory `sc-migration-version-collision`); `db:push` runs from the primary checkout, not the worktree.
- Gates before shipping: `npm run typecheck`, `npm run build` (templates only compile here), `npm test`, `node --test supabase/functions/patch-stability-sample/parsers.test.ts`.
- Commit messages end with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File map

| File | Responsibility |
|---|---|
| `src/app/news/patch-stability.ts` (new) | Row types, verdict type, the formula, level/early/min-data rules, day series, end-state verdict |
| `src/app/news/patch-stability.spec.ts` (new) | Unit tests incl. calibration fixture |
| `src/app/news/patch-stability.service.ts` (new) | Loads both tables once, exposes `verdictFor(line)` and `allTime()` |
| `src/app/news/stability-chip.component.ts` (new) | Level pill for the collapsed row |
| `src/app/news/stability-panel.component.ts` (new) | Expanded block: headline, component bars, day timeline, tickets |
| `src/app/news/stability-history.component.ts` (new) | All-time columns, one per LIVE line |
| `src/app/news/patch-entry-row.component.ts` (modify) | Chip after the stage tag; passes verdict to the detail |
| `src/app/news/patch-note-detail.component.ts` (modify) | Optional `verdict` input → panel above the outline |
| `src/app/news/patch-notes-section.component.ts` (modify) | Loads the service, renders the history next to the cadence |
| `public/i18n/de.json`, `public/i18n/en.json` (modify) | `news.patch.stability.*` |
| `supabase/migrations/20260906120000_patch_stability.sql` (new) | Two tables + RLS |
| `supabase/migrations/20260906130000_patch_stability_cron.sql` (new) | pg_cron + pg_net schedule |
| `supabase/functions/patch-stability-sample/parsers.ts` (new) | Pure parsers (threads, hotfix events, CIG sentence, tickets, status window, KB anchors) |
| `supabase/functions/patch-stability-sample/parsers.test.ts` (new) | `node --test` |
| `supabase/functions/patch-stability-sample/index.ts` (new) | Fetch + upsert; `?backfill=1`; self-throttle |
| `supabase/config.toml` (modify) | `[functions.patch-stability-sample] verify_jwt = false` |
| `.claude/deep-knowledge/supabase.md`, `.claude/deep-knowledge/verse-news-sources.md` (modify) | Ledger rows + source notes |

---

### Task 1: Pure scoring module

**Files:**
- Create: `src/app/news/patch-stability.ts`
- Test: `src/app/news/patch-stability.spec.ts`

**Interfaces:**
- Produces: everything below — `StabilityPatchRow`, `StabilitySampleRow`, `StabilityTicket`, `HotfixEvent`, `StabilityLevel`, `StabilityVerdict`, `StabilityDay`, `communityScore`, `serviceScore`, `cigScore`, `combineScore`, `levelOf`, `isEarly`, `daysBetween`, `computeVerdict`, `EARLY_DAYS`, `MIN_SAMPLES`, `MIN_REPLIES`.

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/news/patch-stability.spec.ts
import {
  EARLY_DAYS,
  StabilityPatchRow,
  StabilitySampleRow,
  cigScore,
  combineScore,
  communityScore,
  computeVerdict,
  daysBetween,
  isEarly,
  levelOf,
  serviceScore,
} from './patch-stability';

function patch(line: string, liveAt: string, extra: Partial<StabilityPatchRow> = {}): StabilityPatchRow {
  return {
    patch_line: line,
    live_at: liveAt,
    notes_thread_id: 1,
    notes_slug: `star-citizen-alpha-${line.replace('.', '-')}-live-release-notes`,
    hotfix_thread_id: null,
    hotfix_slug: null,
    cig_fixes: null,
    cig_fixes_ic: null,
    cig_crash_fixes: null,
    cig_exploit_fixes: null,
    final_replies: null,
    final_outage_min_per_day: null,
    final_ticket_share: null,
    final_ticket_vote_share: null,
    ...extra,
  };
}

function sample(line: string, on: string, extra: Partial<StabilitySampleRow> = {}): StabilitySampleRow {
  return {
    patch_line: line,
    sampled_on: on,
    rn_replies: 0,
    rn_votes: 0,
    hf_replies: null,
    hf_votes: null,
    top_ticket_share: 0,
    top_ticket_vote_share: 0,
    top_tickets: [],
    hotfix_events: [],
    outage_min_7d: 0,
    open_incident: false,
    kb_open_total: null,
    kb_by_section: null,
    kb_anchor_ids: null,
    kb_edited_at: null,
    ...extra,
  };
}

describe('patch-stability components', () => {
  it('communityScore: velocity band 2–20, ticket shares linear', () => {
    expect(communityScore({ velocity: 0, ticketShare: 0, ticketVoteShare: 0 })).toBe(0);
    expect(communityScore({ velocity: 20, ticketShare: 1, ticketVoteShare: 1 })).toBeCloseTo(1, 6);
    expect(communityScore({ velocity: 11, ticketShare: 0, ticketVoteShare: 0 })).toBeCloseTo(0.2, 6);
  });

  it('serviceScore: log-scaled outage, capped at 300 min/day, open incident adds 0.3', () => {
    expect(serviceScore({ outageMinPerDay: 0, openIncident: false })).toBe(0);
    expect(serviceScore({ outageMinPerDay: 300, openIncident: false })).toBeCloseTo(0.7, 6);
    expect(serviceScore({ outageMinPerDay: 10_000, openIncident: true })).toBeCloseTo(1, 6);
  });

  it('cigScore: open band 20–80, delta band 0–10', () => {
    expect(cigScore({ open: 10, delta7d: 0 })).toBe(0);
    expect(cigScore({ open: 50, delta7d: 5 })).toBeCloseTo(0.7 * 0.5 + 0.3 * 0.5, 6);
    expect(cigScore({ open: 200, delta7d: 50 })).toBeCloseTo(1, 6);
  });

  it('combineScore: worst component dominates, mean renormalised over present ones', () => {
    expect(combineScore({ community: 0, service: 0.656, cig: null })).toBeCloseTo(0.7 * 0.656 + 0.3 * ((0.3 * 0.656) / 0.8), 6);
    expect(combineScore({ community: null, service: null, cig: null })).toBeNull();
  });

  it('levelOf thresholds 0.18 / 0.33 / 0.48 / 0.63', () => {
    expect(levelOf(0.1)).toBe(1);
    expect(levelOf(0.18)).toBe(2);
    expect(levelOf(0.33)).toBe(3);
    expect(levelOf(0.48)).toBe(4);
    expect(levelOf(0.63)).toBe(5);
  });

  it('isEarly / daysBetween', () => {
    expect(EARLY_DAYS).toBe(14);
    expect(isEarly(13.9)).toBeTrue();
    expect(isEarly(14)).toBeFalse();
    expect(daysBetween('2026-08-26T00:00:00Z', '2026-09-05T12:00:00Z')).toBeCloseTo(10.5, 6);
  });
});

describe('computeVerdict — calibration against the 2026-09-05 reality check', () => {
  const NOW = '2026-09-05T12:00:00Z';

  it('historical end-states reproduce 4.7 → 2, 4.8 → 4, 4.9 → 2', () => {
    const p47 = patch('4.7', '2026-03-25T00:00:00Z', { final_replies: 180, final_outage_min_per_day: 5, final_ticket_share: 0.16, final_ticket_vote_share: 0.10 });
    const p48 = patch('4.8', '2026-05-13T00:00:00Z', { final_replies: 143, final_outage_min_per_day: 209, final_ticket_share: 0, final_ticket_vote_share: 0 });
    // final_replies is the RELEASE-NOTES thread only: Hotfix Central was locked before 4.9,
    // so RN is the one count comparable across every line (4.9's HF thread had 289 more).
    const p49 = patch('4.9', '2026-07-15T00:00:00Z', { final_replies: 98, final_outage_min_per_day: 0, final_ticket_share: 0.18, final_ticket_vote_share: 0.59 });
    // live days are measured up to the NEXT line's live date, passed in by the caller
    const v47 = computeVerdict(p47, [], { now: NOW, endAt: '2026-05-13T00:00:00Z' });
    const v48 = computeVerdict(p48, [], { now: NOW, endAt: '2026-07-15T00:00:00Z' });
    const v49 = computeVerdict(p49, [], { now: NOW, endAt: '2026-08-26T00:00:00Z' });
    expect(v47.historical).toBeTrue();
    expect(v47.level).toBe(2);
    expect(v48.level).toBe(4);
    expect(v49.level).toBe(2);
    expect(v47.early).toBeFalse();
  });

  it('a young patch with daily samples: 4.10 at day 10 → 3, early', () => {
    const p410 = patch('4.10', '2026-08-26T14:15:00Z', { hotfix_thread_id: 2, hotfix_slug: 'hf' });
    const samples = [
      sample('4.10', '2026-09-04', { rn_replies: 70, hf_replies: 240, top_ticket_share: 0.2, top_ticket_vote_share: 0.11, kb_open_total: 55 }),
      sample('4.10', '2026-09-05', { rn_replies: 78, hf_replies: 271, top_ticket_share: 0.2, top_ticket_vote_share: 0.11, kb_open_total: 55,
        hotfix_events: [{ date: '2026-09-03', build: '12572603', text: 'Client Hotfix' }] }),
    ];
    const v = computeVerdict(p410, samples, { now: NOW, endAt: null });
    expect(v.historical).toBeFalse();
    expect(v.insufficient).toBeFalse();
    expect(v.early).toBeTrue();
    expect(v.level).toBe(3);
    expect(v.days.length).toBe(2);
    // day 2 velocity = (78+271) − (70+240) = 39 replies over 1 day → band saturates
    expect(v.days[1].velocity).toBeCloseTo(39, 6);
    // the 09-03 hotfix predates the first sample → it lands on the first column, not the second
    expect(v.days[0].hotfixes.length).toBe(1);
    expect(v.days[1].hotfixes.length).toBe(0);
    expect(v.components.cig).not.toBeNull();
  });

  it('minimum-data rule: one sample or fewer than 10 replies → insufficient, no level', () => {
    const p = patch('4.11', '2026-10-01T00:00:00Z');
    const v = computeVerdict(p, [sample('4.11', '2026-10-01', { rn_replies: 3 })], { now: '2026-10-02T00:00:00Z', endAt: null });
    expect(v.insufficient).toBeTrue();
    expect(v.level).toBeNull();
  });

  it('first sample velocity falls back to replies ÷ live days', () => {
    const p = patch('4.11', '2026-10-01T00:00:00Z');
    const v = computeVerdict(p, [
      sample('4.11', '2026-10-03', { rn_replies: 40 }),
      sample('4.11', '2026-10-04', { rn_replies: 44 }),
    ], { now: '2026-10-04T12:00:00Z', endAt: null });
    expect(v.days[0].velocity).toBeCloseTo(20, 6);
    expect(v.days[1].velocity).toBeCloseTo(4, 6);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='src/app/news/patch-stability.spec.ts'`
Expected: compile error, `./patch-stability` not found.

- [ ] **Step 3: Implement the module**

```ts
// src/app/news/patch-stability.ts
/**
 * Patch stability — the one place the "how rough does this patch run" verdict
 * is computed (spec: docs/superpowers/specs/2026-09-05-patch-stability-indicator-design.md).
 *
 * Inputs are raw rows the `patch-stability-sample` edge function writes; the
 * function stores numbers, never levels, so this module is the single source
 * of the formula for the daily series AND for the historical end-states.
 *
 * Three components, each 0…1:
 *   community — how loud the Spectrum threads are (reply velocity, Issue
 *               Council ticket density and the upvote weight behind it);
 *   service   — unplanned degraded minutes per day over the trailing week;
 *   cig       — how many Known Issues CIG itself lists, and the 7-day delta.
 *
 * The WORST component dominates: a patch with a week of degraded servers is
 * unstable no matter how quiet the forum is, and vice versa. Hotfixes are
 * event markers only — a count can only go up, so it cannot say "better now".
 */

export type StabilityLevel = 1 | 2 | 3 | 4 | 5;

export interface StabilityTicket {
  /** 'STARC-218134' */
  id: string;
  votes: number;
  /** First ~120 chars of the reply that linked it. */
  excerpt: string;
}

export interface HotfixEvent {
  /** ISO date 'YYYY-MM-DD' as written in the Hotfix Central post. */
  date: string;
  /** Build/CL number when the line carries one, else ''. */
  build: string;
  /** The rest of the line, trimmed. */
  text: string;
}

/** Row of public.patch_stability_patches. */
export interface StabilityPatchRow {
  patch_line: string;
  live_at: string;
  notes_thread_id: number;
  notes_slug: string;
  hotfix_thread_id: number | null;
  hotfix_slug: string | null;
  cig_fixes: number | null;
  cig_fixes_ic: number | null;
  cig_crash_fixes: number | null;
  cig_exploit_fixes: number | null;
  final_replies: number | null;
  final_outage_min_per_day: number | null;
  final_ticket_share: number | null;
  final_ticket_vote_share: number | null;
}

/** Row of public.patch_stability_samples. */
export interface StabilitySampleRow {
  patch_line: string;
  sampled_on: string;
  rn_replies: number;
  rn_votes: number;
  hf_replies: number | null;
  hf_votes: number | null;
  top_ticket_share: number;
  top_ticket_vote_share: number;
  top_tickets: StabilityTicket[];
  hotfix_events: HotfixEvent[];
  outage_min_7d: number;
  open_incident: boolean;
  kb_open_total: number | null;
  kb_by_section: Record<string, number> | null;
  kb_anchor_ids: string[] | null;
  kb_edited_at: string | null;
}

export interface StabilityComponents {
  community: number | null;
  service: number | null;
  cig: number | null;
}

export interface StabilityDay {
  date: string;
  /** New replies per day since the previous sample. */
  velocity: number;
  score: number;
  level: StabilityLevel;
  components: StabilityComponents;
  /** Hotfixes dated this day (markers on the timeline). */
  hotfixes: HotfixEvent[];
}

export interface StabilityVerdict {
  line: string;
  liveAt: string;
  daysLive: number;
  /** Null when `insufficient`. */
  level: StabilityLevel | null;
  score: number | null;
  components: StabilityComponents;
  early: boolean;
  /** Fewer than MIN_SAMPLES samples or MIN_REPLIES replies — no verdict. */
  insufficient: boolean;
  /** No daily samples at all: the end-state from the backfill is shown instead. */
  historical: boolean;
  days: StabilityDay[];
  tickets: StabilityTicket[];
  kbOpen: number | null;
  hotfixes: HotfixEvent[];
}

/** Below this many live days the verdict is provisional (hatched in the UI). */
export const EARLY_DAYS = 14;
export const MIN_SAMPLES = 2;
export const MIN_REPLIES = 10;

const DAY_MS = 24 * 60 * 60 * 1000;
const WEIGHTS = { community: 0.5, service: 0.3, cig: 0.2 } as const;
const VELOCITY_BAND: [number, number] = [2, 20];
const OUTAGE_CAP_MIN_PER_DAY = 300;
const KB_OPEN_BAND: [number, number] = [20, 80];
const KB_DELTA_BAND: [number, number] = [0, 10];
const LEVEL_THRESHOLDS = [0.18, 0.33, 0.48, 0.63] as const;

/** Linear ramp: 0 at `lo` and below, 1 at `hi` and above. */
export function band(value: number, [lo, hi]: [number, number]): number {
  if (!Number.isFinite(value) || value <= lo) return 0;
  if (value >= hi) return 1;
  return (value - lo) / (hi - lo);
}

export function communityScore(c: { velocity: number; ticketShare: number; ticketVoteShare: number }): number {
  return 0.4 * band(c.velocity, VELOCITY_BAND) + 0.3 * clamp01(c.ticketShare) + 0.3 * clamp01(c.ticketVoteShare);
}

export function serviceScore(s: { outageMinPerDay: number; openIncident: boolean }): number {
  const capped = Math.min(Math.max(s.outageMinPerDay, 0), OUTAGE_CAP_MIN_PER_DAY);
  const outage = Math.log10(1 + capped) / Math.log10(1 + OUTAGE_CAP_MIN_PER_DAY);
  return 0.7 * outage + 0.3 * (s.openIncident ? 1 : 0);
}

export function cigScore(k: { open: number; delta7d: number }): number {
  return 0.7 * band(k.open, KB_OPEN_BAND) + 0.3 * band(k.delta7d, KB_DELTA_BAND);
}

/** 0.7 · worst + 0.3 · weighted mean over the components that have data; null when none do. */
export function combineScore(c: StabilityComponents): number | null {
  const present = (Object.keys(WEIGHTS) as (keyof StabilityComponents)[]).filter((k) => c[k] !== null);
  if (present.length === 0) return null;
  const worst = Math.max(...present.map((k) => c[k] as number));
  const weightSum = present.reduce((s, k) => s + WEIGHTS[k], 0);
  const mean = present.reduce((s, k) => s + WEIGHTS[k] * (c[k] as number), 0) / weightSum;
  return 0.7 * worst + 0.3 * mean;
}

export function levelOf(score: number): StabilityLevel {
  let level = 1;
  for (const t of LEVEL_THRESHOLDS) if (score >= t) level++;
  return level as StabilityLevel;
}

export function isEarly(daysLive: number): boolean {
  return daysLive < EARLY_DAYS;
}

export function daysBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS;
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

function totalReplies(s: StabilitySampleRow): number {
  return s.rn_replies + (s.hf_replies ?? 0);
}

/** Sample dated at most 7 days before `s`, for the KB delta; null when there is none. */
function sampleWeekBefore(samples: StabilitySampleRow[], i: number): StabilitySampleRow | null {
  const target = Date.parse(samples[i].sampled_on) - 7 * DAY_MS;
  for (let j = i - 1; j >= 0; j--) {
    if (Date.parse(samples[j].sampled_on) <= target) return samples[j];
  }
  return null;
}

export interface VerdictContext {
  /** ISO timestamp of "now". */
  now: string;
  /** When the NEXT line went live, or null while this one is the newest. */
  endAt: string | null;
}

/**
 * The whole verdict for one patch line.
 *
 * With daily samples: a day series, the newest day's level, and the early /
 * minimum-data flags. Without samples (patches that predate the sampler): the
 * end-state from the registry's `final_*` numbers, marked `historical`.
 */
export function computeVerdict(
  patch: StabilityPatchRow,
  samplesIn: StabilitySampleRow[],
  ctx: VerdictContext,
): StabilityVerdict {
  const samples = [...samplesIn].sort((a, b) => a.sampled_on.localeCompare(b.sampled_on));
  const endAt = ctx.endAt ?? ctx.now;
  const daysLive = Math.max(0, daysBetween(patch.live_at, endAt));
  const base = {
    line: patch.patch_line,
    liveAt: patch.live_at,
    daysLive,
    early: ctx.endAt === null && isEarly(daysBetween(patch.live_at, ctx.now)),
  };

  if (samples.length === 0) {
    const replies = patch.final_replies ?? 0;
    const components: StabilityComponents = {
      community: patch.final_ticket_share === null && patch.final_ticket_vote_share === null && patch.final_replies === null
        ? null
        : communityScore({
            velocity: replies / Math.max(1, daysLive),
            ticketShare: patch.final_ticket_share ?? 0,
            ticketVoteShare: patch.final_ticket_vote_share ?? 0,
          }),
      service: patch.final_outage_min_per_day === null
        ? null
        : serviceScore({ outageMinPerDay: patch.final_outage_min_per_day, openIncident: false }),
      cig: null,
    };
    const score = combineScore(components);
    const insufficient = score === null || replies < MIN_REPLIES;
    return {
      ...base,
      level: insufficient ? null : levelOf(score as number),
      score: insufficient ? null : score,
      components,
      insufficient,
      historical: true,
      days: [],
      tickets: [],
      kbOpen: null,
      hotfixes: [],
    };
  }

  // Hotfix Central is a living list, so the NEWEST sample carries every event;
  // each day column gets the events dated since the previous sample (the first
  // column also collects everything before sampling began — one tick, many titles).
  const allEvents = samples[samples.length - 1].hotfix_events;
  const days: StabilityDay[] = samples.map((s, i) => {
    const prev = i > 0 ? samples[i - 1] : null;
    const velocity = prev
      ? (totalReplies(s) - totalReplies(prev)) / Math.max(1 / 24, daysBetween(prev.sampled_on, s.sampled_on))
      : totalReplies(s) / Math.max(1, daysBetween(patch.live_at, s.sampled_on + 'T00:00:00Z'));
    const weekAgo = sampleWeekBefore(samples, i);
    const components: StabilityComponents = {
      community: communityScore({ velocity, ticketShare: s.top_ticket_share, ticketVoteShare: s.top_ticket_vote_share }),
      service: serviceScore({ outageMinPerDay: s.outage_min_7d / 7, openIncident: s.open_incident }),
      cig: s.kb_open_total === null
        ? null
        : cigScore({
            open: s.kb_open_total,
            delta7d: weekAgo && weekAgo.kb_open_total !== null ? s.kb_open_total - weekAgo.kb_open_total : 0,
          }),
    };
    const score = combineScore(components) as number;
    return {
      date: s.sampled_on,
      velocity,
      score,
      level: levelOf(score),
      components,
      hotfixes: allEvents.filter((h) => h.date <= s.sampled_on && (!prev || h.date > prev.sampled_on)),
    };
  });

  const latest = samples[samples.length - 1];
  const last = days[days.length - 1];
  const insufficient = samples.length < MIN_SAMPLES || totalReplies(latest) < MIN_REPLIES;
  return {
    ...base,
    level: insufficient ? null : last.level,
    score: insufficient ? null : last.score,
    components: last.components,
    insufficient,
    historical: false,
    days,
    tickets: latest.top_tickets,
    kbOpen: latest.kb_open_total,
    hotfixes: latest.hotfix_events,
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='src/app/news/patch-stability.spec.ts'`
Expected: all specs PASS. If a calibration level is off by one, the inputs in the spec table (section 3) are the contract — fix the constant, not the fixture.

- [ ] **Step 5: Commit**

```bash
git add src/app/news/patch-stability.ts src/app/news/patch-stability.spec.ts
git commit -m "feat(news): patch stability formula and verdict model

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Schema migration

**Files:**
- Create: `supabase/migrations/20260906120000_patch_stability.sql`
- Modify: `.claude/deep-knowledge/supabase.md` (ledger table, after the `20260904040000_feedback_attachment_types.sql` row)

**Interfaces:**
- Produces: tables `public.patch_stability_patches`, `public.patch_stability_samples` with exactly the columns of `StabilityPatchRow` / `StabilitySampleRow` (Task 1) plus `updated_at` / `sampled_at`.

- [ ] **Step 1: Write the migration**

```sql
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
```

- [ ] **Step 2: Add the ledger row to `.claude/deep-knowledge/supabase.md`**

Insert after the `20260904040000_feedback_attachment_types.sql` row:

```markdown
| `20260906120000_patch_stability.sql` | Patch stability indicator: `patch_stability_patches` (one row per LIVE line, Spectrum thread ids, CIG fix-count sentence, `final_*` end-state for pre-sampler lines) + `patch_stability_samples` (PK `(patch_line, sampled_on)`, raw daily numbers). Anon read, service-role write. The level formula lives in `src/app/news/patch-stability.ts` only |
| `20260906130000_patch_stability_cron.sql` | `pg_cron` + `pg_net`: job `patch-stability-sample` POSTs the edge function daily at 06:00 UTC with the publishable key. The function self-throttles (skips when the newest sample is < 6 h old) |
```

- [ ] **Step 3: Verify the SQL parses**

Run (from the worktree; no DB needed): `node -e "const s=require('fs').readFileSync('supabase/migrations/20260906120000_patch_stability.sql','utf8'); if(!/create table if not exists public\.patch_stability_samples/.test(s)) process.exit(1); console.log('ok')"`
Expected: `ok`. The real apply happens at ship time from the PRIMARY checkout (`npm run db:push`), see memory `sc-worktree-supabase-unlinked-dbpush`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260906120000_patch_stability.sql .claude/deep-knowledge/supabase.md
git commit -m "feat(db): patch stability tables

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Sampler parsers (pure, node-testable)

**Files:**
- Create: `supabase/functions/patch-stability-sample/parsers.ts`
- Test: `supabase/functions/patch-stability-sample/parsers.test.ts`

**Interfaces:**
- Produces: `ThreadRow`, `detectLiveThreads(rows) → LivePatch[]`, `parseHotfixEvents(contentBlocks) → HotfixEvent[]`, `parseCigFixSentence(text) → CigFixes | null`, `ticketIdsOf(text) → string[]`, `topReplyMetrics(replies) → TopReplyMetrics`, `statusWindow(issues, fromIso, toIso) → StatusWindow`, `kbSnapshot(article) → KbSnapshot | null`, `patchLineOfTitle(subject) → string`, `draftBlocksOf(contentBlocks) → DraftBlock[]`.

- [ ] **Step 1: Write the failing tests**

```ts
// supabase/functions/patch-stability-sample/parsers.test.ts
// Pure logic, no Deno APIs — runs under `node --test` and `deno test` alike:
//   node --test supabase/functions/patch-stability-sample/parsers.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectLiveThreads,
  kbSnapshot,
  parseCigFixSentence,
  parseHotfixEvents,
  patchLineOfTitle,
  statusWindow,
  ticketIdsOf,
  topReplyMetrics,
} from './parsers.ts';

const block = (type: string, text: string) => ({ type, text, depth: 0, inlineStyleRanges: [], entityRanges: [] });
const container = (blocks: unknown[]) => [{ type: 'text', data: { blocks, entityMap: {} } }];

test('patchLineOfTitle: first two segments of the Alpha version', () => {
  assert.equal(patchLineOfTitle('Star Citizen Alpha 4.10 LIVE Release Notes'), '4.10');
  assert.equal(patchLineOfTitle('Star Citizen Alpha 4.7.2 LIVE - Hotfix Central [Updated 4.27.2026]'), '4.7');
  assert.equal(patchLineOfTitle('Star Citizen Alpha 4.1 LIVE 9650658 Release Notes'), '4.1');
  assert.equal(patchLineOfTitle('[All Backer PTU] Star Citizen Alpha 4.7 RC1 11506930 PTU Patch Notes'), '4.7');
  assert.equal(patchLineOfTitle('Something else'), '');
});

test('detectLiveThreads: RN + Hotfix Central per line, PTU/hotfix point releases ignored', () => {
  const rows = [
    { id: 568266, slug: 'hf410', subject: 'Star Citizen Alpha 4.10 LIVE - Hotfix Central  (Updated 9.3.2026)', time_created: 1787900000, replies_count: 271, votes: { count: 159 } },
    { id: 568009, slug: 'rn410', subject: 'Star Citizen Alpha 4.10 LIVE Release Notes', time_created: 1787820000, replies_count: 78, votes: { count: 89 } },
    { id: 1, slug: 'ptu', subject: '[Wave 1 PTU] Star Citizen Alpha 4.10 11429312 PTU Patch Notes', time_created: 1787000000, replies_count: 5, votes: { count: 1 } },
    { id: 542278, slug: 'hf47', subject: 'Star Citizen Alpha 4.7.2 LIVE - Hotfix Central [Updated 4.27.2026]', time_created: 1774500000, replies_count: 0, votes: { count: 1 } },
    { id: 542069, slug: 'rn47', subject: 'Star Citizen Alpha 4.7 LIVE Release Notes', time_created: 1774400000, replies_count: 180, votes: { count: 84 } },
    { id: 557337, slug: 'hf481', subject: 'Star Citizen Alpha 4.8.1 LIVE - Hotfix 11952564', time_created: 1780700000, replies_count: 765, votes: { count: 10 } },
    { id: 9, slug: 'old', subject: 'Star Citizen Alpha 3.24.1 9324446 LIVE Patch Notes', time_created: 1726200000, replies_count: 188, votes: { count: 2 } },
  ];
  const lines = detectLiveThreads(rows);
  assert.deepEqual(lines.map((l) => l.line), ['4.10', '4.7', '3.24']);
  assert.equal(lines[0].notes.id, 568009);
  assert.equal(lines[0].hotfix?.id, 568266);
  assert.equal(lines[1].hotfix?.id, 542278);
  assert.equal(lines[2].hotfix, null);
  assert.equal(lines[0].liveAt, new Date(1787820000 * 1000).toISOString());
});

test('parseHotfixEvents: ► dated blockquotes, M.D.YYYY → ISO, build number when present', () => {
  const blocks = container([
    block('header-one', 'Current 4.10 LIVE Status | 9.3.2026'),
    block('blockquote', '►9.3.2026: Client Hotfix 12572603 - Client side now on LIVE'),
    block('unordered-list-item', 'The HOTFIX channel is currently up with a client side crash fix'),
    block('blockquote', '► 8.28.2026: Hotfix 12545750 now on LIVE'),
    block('blockquote', '► 8.27.2026: Hotfix 12535871  is now on the HOTFIX channel and select shards on LIVE'),
    block('blockquote', 'Ships & Vehicles'),
  ]);
  const events = parseHotfixEvents(blocks);
  assert.deepEqual(events, [
    { date: '2026-09-03', build: '12572603', text: 'Client Hotfix 12572603 - Client side now on LIVE' },
    { date: '2026-08-28', build: '12545750', text: 'Hotfix 12545750 now on LIVE' },
    { date: '2026-08-27', build: '12535871', text: 'Hotfix 12535871 is now on the HOTFIX channel and select shards on LIVE' },
  ]);
});

test('parseCigFixSentence: both phrasings CIG has used', () => {
  assert.deepEqual(
    parseCigFixSentence('This release closes 479 bug fixes, with 101 of them originating from the issue council. This includes work to fix 47 crash and stability issues and 17 exploits.'),
    { fixes: 479, fromIssueCouncil: 101, crashFixes: 47, exploitFixes: 17 },
  );
  assert.deepEqual(
    parseCigFixSentence('Star Citizen Alpha 4.9 contains over 166 bug and crash fixes since 4.8 went live. 73 of which originated from the issue council.'),
    { fixes: 166, fromIssueCouncil: 73, crashFixes: null, exploitFixes: null },
  );
  assert.equal(parseCigFixSentence('no numbers here'), null);
});

test('ticketIdsOf: STARC ids inline and inside issue-council urls, de-duplicated', () => {
  assert.deepEqual(
    ticketIdsOf('#STARC-218134 and https://issue-council.robertsspaceindustries.com/projects/STAR-CITIZEN/issues/STARC-214936#contribution:x and STARC-218134 again'),
    ['STARC-218134', 'STARC-214936'],
  );
  assert.deepEqual(ticketIdsOf('nothing'), []);
});

test('topReplyMetrics: share of ticket-bearing replies, vote share, top tickets by votes', () => {
  const reply = (votes: number, text: string, t = 1787900000) => ({
    votes: { count: votes }, time_created: t,
    content_blocks: container([block('unstyled', text)]),
  });
  const m = topReplyMetrics([
    reply(82, 'Thank you for the potential Linux fix'),
    reply(16, 'Fix distro centers https://issue-council.robertsspaceindustries.com/projects/STAR-CITIZEN/issues/STARC-214936'),
    reply(13, 'Could you please fix #STARC-218134 Battaglia Story Mission 2'),
    reply(9, 'Med gun is still desynced. STARC-218272'),
  ]);
  assert.equal(m.count, 4);
  assert.equal(m.ticketShare, 0.75);
  assert.equal(m.ticketVoteShare, (16 + 13 + 9) / (82 + 16 + 13 + 9));
  assert.deepEqual(m.tickets.map((t) => t.id), ['STARC-214936', 'STARC-218134', 'STARC-218272']);
  assert.equal(m.tickets[0].votes, 16);
  assert.ok(m.tickets[0].excerpt.startsWith('Fix distro centers'));
  const empty = topReplyMetrics([]);
  assert.deepEqual(empty, { count: 0, ticketShare: 0, ticketVoteShare: 0, tickets: [] });
});

test('statusWindow: unplanned minutes inside the window, open incident flag, maintenance ignored', () => {
  const issues = [
    { is: 'issue', title: 'Live Deployment', createdAt: '2026-08-26 14:15:00 +0000 UTC', severity: 'maintenance', resolved: true, resolvedAt: '2026-08-26 18:30:00', affected: ['Persistent Universe'] },
    { is: 'issue', title: 'Live Services Disruption', createdAt: '2026-06-09 00:30:00 +0000 UTC', severity: 'degraded', resolved: true, resolvedAt: '2026-06-17 14:50:00', affected: ['Persistent Universe'] },
    { is: 'issue', title: 'Live Services Disruption', createdAt: '2026-06-17 17:30:00 +0000 UTC', severity: 'degraded', resolved: false, resolvedAt: '', affected: ['Persistent Universe'] },
    { is: 'page', title: 'not an issue', createdAt: '0001-01-01 00:00:00 +0000 UTC', severity: '', resolved: true, resolvedAt: '', affected: [] },
  ];
  const w = statusWindow(issues, '2026-06-01T00:00:00Z', '2026-06-18T00:00:00Z');
  // 2026-06-09 00:30 → 06-17 14:50 = 8 d 14 h 20 m = 12380 min; the open one counts until the window end: 06-17 17:30 → 06-18 00:00 = 390 min
  assert.equal(w.unplannedMinutes, 12380 + 390);
  assert.equal(w.unplannedCount, 2);
  assert.equal(w.openIncident, true);
  // An UNRESOLVED incident is ongoing: it fills every later window until it resolves.
  const later = statusWindow(issues, '2026-08-20T00:00:00Z', '2026-09-05T00:00:00Z');
  assert.equal(later.unplannedMinutes, 16 * 24 * 60);
  assert.equal(later.openIncident, true);
  // Without it, the same window is clean.
  const laterClean = statusWindow(issues.slice(0, 2), '2026-08-20T00:00:00Z', '2026-09-05T00:00:00Z');
  assert.equal(laterClean.unplannedMinutes, 0);
  assert.equal(laterClean.openIncident, false);
});

test('kbSnapshot: anchored entries per h1 section, null when the title names another patch', () => {
  const article = {
    title: 'Star Citizen Alpha 4.10 Known Issues',
    edited_at: '2026-09-01T19:04:24Z',
    body: '<p>intro</p><h1>Technical Issues</h1><h2 id="h_01A">Error 403</h2><h3 id="h_01B">Error 41013</h3><h1>Ship Issues</h1><h2 id="h_02A">Docked Ships</h2><h2>no anchor</h2>',
  };
  const snap = kbSnapshot(article, '4.10');
  assert.deepEqual(snap, {
    openTotal: 3,
    bySection: { 'Technical Issues': 2, 'Ship Issues': 1 },
    anchorIds: ['h_01A', 'h_01B', 'h_02A'],
    editedAt: '2026-09-01T19:04:24Z',
  });
  assert.equal(kbSnapshot(article, '4.9'), null);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test supabase/functions/patch-stability-sample/parsers.test.ts`
Expected: fails — `parsers.ts` not found.

- [ ] **Step 3: Implement the parsers**

```ts
// supabase/functions/patch-stability-sample/parsers.ts
// Pure parsers for the patch-stability sampler. No Deno APIs, no fetch — so
// the whole file is testable with `node --test` and shares nothing but shapes
// with index.ts. Sources and quirks are documented in
// .claude/deep-knowledge/patch-stability.md.

export interface ThreadRow {
  id: number;
  slug: string;
  subject: string;
  time_created: number;
  replies_count: number;
  votes?: { count?: number };
}

export interface LivePatch {
  line: string;
  liveAt: string;
  notes: ThreadRow;
  hotfix: ThreadRow | null;
}

export interface HotfixEvent { date: string; build: string; text: string; }
export interface CigFixes { fixes: number; fromIssueCouncil: number; crashFixes: number | null; exploitFixes: number | null; }
export interface Ticket { id: string; votes: number; excerpt: string; }
export interface TopReplyMetrics { count: number; ticketShare: number; ticketVoteShare: number; tickets: Ticket[]; }
export interface StatusWindow { unplannedMinutes: number; unplannedCount: number; openIncident: boolean; }
export interface KbSnapshot { openTotal: number; bySection: Record<string, number>; anchorIds: string[]; editedAt: string | null; }

export interface DraftBlock { type: string; text: string; depth?: number; }

const ALPHA_VERSION = /\balpha\s+v?(\d{1,2}(?:\.\d{1,2}){1,2})(?![\d.])/i;

/** 'Star Citizen Alpha 4.7.2 LIVE - Hotfix Central' → '4.7'; '' when no version. */
export function patchLineOfTitle(subject: string): string {
  const m = ALPHA_VERSION.exec(subject);
  return m ? m[1].split('.').slice(0, 2).join('.') : '';
}

const IS_LIVE_NOTES = (s: string) => /\bLIVE\b/.test(s) && /(Release|Patch) Notes/i.test(s) && !/\bPTU\b|Hotfix/i.test(s);
const IS_HOTFIX_CENTRAL = (s: string) => /\bLIVE\b/.test(s) && /Hotfix Central/i.test(s);

/**
 * Pair every LIVE release-notes thread with its line's Hotfix Central thread.
 * Newest line first. Point-release hotfix threads ("4.8.1 LIVE - Hotfix
 * 11952564") are neither — they are ordinary rows on the board.
 */
export function detectLiveThreads(rows: ThreadRow[]): LivePatch[] {
  const byLine = new Map<string, LivePatch>();
  for (const row of rows) {
    if (!IS_LIVE_NOTES(row.subject)) continue;
    const line = patchLineOfTitle(row.subject);
    if (!line || byLine.has(line)) continue;
    byLine.set(line, { line, liveAt: new Date(row.time_created * 1000).toISOString(), notes: row, hotfix: null });
  }
  for (const row of rows) {
    if (!IS_HOTFIX_CENTRAL(row.subject)) continue;
    const line = patchLineOfTitle(row.subject);
    const patch = byLine.get(line);
    if (patch && !patch.hotfix) patch.hotfix = row;
  }
  return [...byLine.values()].sort((a, b) => b.notes.time_created - a.notes.time_created);
}

/** Draft.js blocks of every `text` container, in reading order. */
export function draftBlocksOf(contentBlocks: unknown): DraftBlock[] {
  const out: DraftBlock[] = [];
  if (!Array.isArray(contentBlocks)) return out;
  for (const c of contentBlocks) {
    const rec = c && typeof c === 'object' ? (c as Record<string, unknown>) : null;
    if (!rec || rec['type'] !== 'text') continue;
    const data = rec['data'] && typeof rec['data'] === 'object' ? (rec['data'] as Record<string, unknown>) : null;
    const blocks = data ? data['blocks'] : null;
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks) {
      const rb = b && typeof b === 'object' ? (b as Record<string, unknown>) : null;
      if (!rb) continue;
      out.push({ type: String(rb['type'] ?? ''), text: typeof rb['text'] === 'string' ? rb['text'] : '', depth: Number(rb['depth']) || 0 });
    }
  }
  return out;
}

const HOTFIX_LINE = /^►\s*(\d{1,2})\.(\d{1,2})\.(\d{4})\s*:?\s*(.*)$/;

/**
 * Hotfix Central lists every hotfix as a blockquote "►M.D.YYYY: …". The date is
 * CIG's (US) calendar date, taken as-is; the build/CL number is the first
 * 7–9 digit run when there is one.
 */
export function parseHotfixEvents(contentBlocks: unknown): HotfixEvent[] {
  const events: HotfixEvent[] = [];
  for (const b of draftBlocksOf(contentBlocks)) {
    const m = HOTFIX_LINE.exec(b.text.trim());
    if (!m) continue;
    const [, mo, d, y, rest] = m;
    const text = rest.replace(/\s+/g, ' ').trim();
    const build = /\b(\d{7,9})\b/.exec(text)?.[1] ?? '';
    events.push({ date: `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`, build, text });
  }
  return events;
}

/**
 * "closes 479 bug fixes, with 101 of them originating from the issue council …
 * 47 crash and stability issues and 17 exploits" (4.10) or "contains over 166
 * bug and crash fixes … 73 of which originated from the issue council" (4.7–4.9).
 */
export function parseCigFixSentence(text: string): CigFixes | null {
  const flat = text.replace(/\s+/g, ' ');
  const fixes = /(?:closes|contains over)\s+(\d+)\s+bug/i.exec(flat);
  const ic = /(\d+)\s+of\s+(?:them|which)\s+originat/i.exec(flat);
  if (!fixes || !ic) return null;
  const crash = /(\d+)\s+crash and stability/i.exec(flat);
  const exploits = /(\d+)\s+exploits?/i.exec(flat);
  return {
    fixes: Number(fixes[1]),
    fromIssueCouncil: Number(ic[1]),
    crashFixes: crash ? Number(crash[1]) : null,
    exploitFixes: exploits ? Number(exploits[1]) : null,
  };
}

/** Distinct STARC ids in reading order — bare `STARC-123` or inside an issue-council url. */
export function ticketIdsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/STARC-\d{3,7}/g)) if (!out.includes(m[0])) out.push(m[0]);
  return out;
}

export interface ReplyRow {
  votes?: { count?: number };
  time_created?: number;
  content_blocks?: unknown;
}

const EXCERPT_CHARS = 120;
const MAX_TICKETS = 10;

/** The community metrics of one thread's top-voted replies (the API returns at most 25). */
export function topReplyMetrics(replies: ReplyRow[]): TopReplyMetrics {
  if (replies.length === 0) return { count: 0, ticketShare: 0, ticketVoteShare: 0, tickets: [] };
  let withTicket = 0;
  let votesAll = 0;
  let votesTicket = 0;
  const tickets: Ticket[] = [];
  for (const r of replies) {
    const votes = Number(r.votes?.count ?? 0) || 0;
    const text = draftBlocksOf(r.content_blocks).map((b) => b.text).join(' ').replace(/\s+/g, ' ').trim();
    const ids = ticketIdsOf(text);
    votesAll += votes;
    if (ids.length > 0) {
      withTicket++;
      votesTicket += votes;
      const excerpt = text.length > EXCERPT_CHARS ? text.slice(0, EXCERPT_CHARS).trimEnd() + '…' : text;
      for (const id of ids) if (!tickets.some((t) => t.id === id)) tickets.push({ id, votes, excerpt });
    }
  }
  tickets.sort((a, b) => b.votes - a.votes);
  return {
    count: replies.length,
    ticketShare: withTicket / replies.length,
    ticketVoteShare: votesAll > 0 ? votesTicket / votesAll : 0,
    tickets: tickets.slice(0, MAX_TICKETS),
  };
}

export interface StatusIssue {
  is?: string;
  title?: string;
  createdAt?: string;
  severity?: string;
  resolved?: boolean;
  resolvedAt?: string;
  affected?: string[];
}

/** cState writes '2026-08-26 14:15:00 +0000 UTC' (createdAt) and '2026-08-26 18:30:00' (resolvedAt, UTC). */
export function parseCstateDate(s: string | undefined): number {
  if (!s) return NaN;
  const iso = s.replace(/ \+0000 UTC$/, 'Z').replace(/ UTC$/, 'Z').replace(' ', 'T');
  const t = Date.parse(/[Z+-]\d{0,4}$/.test(iso) ? iso : iso + 'Z');
  return t;
}

/**
 * Unplanned (`severity != maintenance`) incident minutes overlapping
 * [fromIso, toIso), clipped to the window; an unresolved incident runs to the
 * window end and flips `openIncident`.
 */
export function statusWindow(issues: StatusIssue[], fromIso: string, toIso: string): StatusWindow {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  let minutes = 0;
  let count = 0;
  let open = false;
  for (const p of issues) {
    if (p.is !== 'issue' || !p.createdAt || p.createdAt.startsWith('0001')) continue;
    if (!p.severity || p.severity === 'maintenance') continue;
    const start = parseCstateDate(p.createdAt);
    if (!Number.isFinite(start)) continue;
    const resolvedAt = p.resolved === false || !p.resolvedAt ? NaN : parseCstateDate(p.resolvedAt);
    const end = Number.isFinite(resolvedAt) ? resolvedAt : to;
    if (end <= from || start >= to) continue;
    count++;
    if (!Number.isFinite(resolvedAt) && end >= to) open = true;
    minutes += Math.max(0, Math.min(end, to) - Math.max(start, from)) / 60_000;
  }
  return { unplannedMinutes: Math.round(minutes), unplannedCount: count, openIncident: open };
}

export interface KbArticle { title?: string; edited_at?: string; body?: string; }

/**
 * CIG's Known Issues article: one evergreen page retitled per patch. Entries
 * are the anchored h2/h3 under h1 sections. Null when the title does not name
 * `line` — the sampler then stores null instead of another patch's list.
 */
export function kbSnapshot(article: KbArticle, line: string): KbSnapshot | null {
  const title = article.title ?? '';
  if (!new RegExp(`\\bAlpha\\s+${line.replace('.', '\\.')}(?![\\d.])`, 'i').test(title)) return null;
  const body = article.body ?? '';
  const bySection: Record<string, number> = {};
  const anchorIds: string[] = [];
  let section = '';
  const tag = /<(h1|h2|h3)\b([^>]*)>([\s\S]*?)<\/\1>/gi;
  for (const m of body.matchAll(tag)) {
    const [, level, attrs, inner] = m;
    if (level.toLowerCase() === 'h1') {
      section = inner.replace(/<[^>]+>/g, '').trim();
      if (section && !(section in bySection)) bySection[section] = 0;
      continue;
    }
    const id = /\bid="(h_[^"]+)"/i.exec(attrs)?.[1];
    if (!id) continue;
    anchorIds.push(id);
    if (section) bySection[section] = (bySection[section] ?? 0) + 1;
  }
  return { openTotal: anchorIds.length, bySection, anchorIds, editedAt: article.edited_at ?? null };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test supabase/functions/patch-stability-sample/parsers.test.ts`
Expected: all 8 tests pass. (`statusWindow` test: 12380 + 390 = 12770.)

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/patch-stability-sample/parsers.ts supabase/functions/patch-stability-sample/parsers.test.ts
git commit -m "feat(functions): patch-stability parsers

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: Sampler edge function

**Files:**
- Create: `supabase/functions/patch-stability-sample/index.ts`
- Modify: `supabase/config.toml` (append after the `[functions.api]` block)

**Interfaces:**
- Consumes: everything from `parsers.ts` (Task 3); tables from Task 2.
- Produces: `GET/POST /patch-stability-sample` → `{ ok: true, lines: string[], skipped?: true }`; `?backfill=1` → `{ ok: true, registered: number }`; `?force=1` bypasses the 6-h throttle.

- [ ] **Step 1: Write the function**

```ts
// supabase/functions/patch-stability-sample/index.ts
// patch-stability-sample — the daily sampler behind the patch board's
// stability indicator (spec: docs/superpowers/specs/2026-09-05-patch-stability-indicator-design.md).
//
// One run, once a day (pg_cron → pg_net → here):
//   1. Spectrum forum 190048 thread list → which LIVE lines exist, their
//      release-notes and Hotfix-Central threads → upsert patch_stability_patches.
//   2. For the newest line AND the one before it (its threads still receive
//      comments): both threads' nested payload → reply/vote counts, the 25
//      top-voted replies' Issue-Council ticket metrics, hotfix events.
//   3. status.robertsspaceindustries.com/issues/index.json → unplanned minutes
//      over the trailing 7 days, open incident.
//   4. CIG Known Issues article (Zendesk Help Center API) → entry count per
//      section, when its title names the line.
//   → one row per line in patch_stability_samples (upsert on the day).
//
// `?backfill=1` registers every LIVE line the forum still lists (6 pages ≈ two
// years) with its measured END-STATE, for lines that predate the sampler.
//
// verify_jwt=false (config.toml): public data, no user data. Self-throttled:
// a run is skipped when the newest sample is younger than 6 h, so a stray
// unauthenticated trigger costs one cheap query and nothing upstream.
//
// The formula is NOT here. Raw numbers only — see src/app/news/patch-stability.ts.

import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  LivePatch,
  ReplyRow,
  StatusIssue,
  ThreadRow,
  detectLiveThreads,
  draftBlocksOf,
  kbSnapshot,
  parseCigFixSentence,
  parseHotfixEvents,
  statusWindow,
  topReplyMetrics,
} from './parsers.ts';

const RSI_BASE = 'https://robertsspaceindustries.com';
const SPECTRUM_LIST_URL = `${RSI_BASE}/api/spectrum/forum/channel/threads`;
const SPECTRUM_THREAD_URL = `${RSI_BASE}/api/spectrum/forum/thread/nested`;
const PATCH_NOTES_CHANNEL_ID = 190048;
const STATUS_URL = 'https://status.robertsspaceindustries.com/issues/index.json';
const KB_URL = 'https://support.robertsspaceindustries.com/api/v2/help_center/en-us/articles/360056254754.json';
const USER_AGENT = 'SC-Companion/0.6 (+patch-stability)';

const LIST_PAGES_DAILY = 2;
const LIST_PAGES_BACKFILL = 6;
const THROTTLE_MS = 6 * 60 * 60 * 1000;
const WINDOW_DAYS = 7;
const TIMEOUT_MS = 15_000;
const DAY_MS = 24 * 60 * 60 * 1000;

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

function admin() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

async function fetchJson(url: string, init: RequestInit): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const spectrumHeaders = {
  'Content-Type': 'application/json',
  'Accept': 'application/json',
  'X-Tavern-Id': '1',
  'User-Agent': USER_AGENT,
};

async function listThreads(pages: number): Promise<ThreadRow[]> {
  const rows: ThreadRow[] = [];
  const seen = new Set<number>();
  for (let page = 1; page <= pages; page++) {
    const json = await fetchJson(SPECTRUM_LIST_URL, {
      method: 'POST',
      headers: spectrumHeaders,
      body: JSON.stringify({ channel_id: PATCH_NOTES_CHANNEL_ID, page, sort: 'newest' }),
    }) as { data?: { threads?: unknown[] } };
    const threads = json?.data?.threads ?? [];
    if (threads.length === 0) break;
    for (const t of threads) {
      const r = t as Record<string, unknown>;
      const id = Number(r['id']);
      if (!Number.isFinite(id) || seen.has(id)) continue; // pinned threads repeat on every page
      seen.add(id);
      rows.push({
        id,
        slug: String(r['slug'] ?? ''),
        subject: String(r['subject'] ?? ''),
        time_created: Number(r['time_created']) || 0,
        replies_count: Number(r['replies_count']) || 0,
        votes: r['votes'] as { count?: number } | undefined,
      });
    }
  }
  return rows;
}

interface ThreadPayload {
  replies_count: number;
  votes: number;
  replies: ReplyRow[];
  content_blocks: unknown;
}

async function fetchThread(slug: string): Promise<ThreadPayload | null> {
  try {
    const json = await fetchJson(SPECTRUM_THREAD_URL, {
      method: 'POST',
      headers: spectrumHeaders,
      body: JSON.stringify({ slug, channel_id: String(PATCH_NOTES_CHANNEL_ID), sort: 'votes', page: 1 }),
    }) as { data?: Record<string, unknown> };
    const d = json?.data;
    if (!d) return null;
    return {
      replies_count: Number(d['replies_count']) || 0,
      votes: Number((d['votes'] as { count?: number } | undefined)?.count) || 0,
      replies: Array.isArray(d['replies']) ? (d['replies'] as ReplyRow[]) : [],
      content_blocks: d['content_blocks'],
    };
  } catch (err) {
    console.error(`patch-stability: thread ${slug} failed:`, err);
    return null;
  }
}

async function fetchStatusIssues(): Promise<StatusIssue[] | null> {
  try {
    const json = await fetchJson(STATUS_URL, { headers: { 'User-Agent': USER_AGENT } }) as { pages?: Record<string, StatusIssue> };
    return json?.pages ? Object.values(json.pages) : [];
  } catch (err) {
    console.error('patch-stability: status fetch failed:', err);
    return null;
  }
}

async function fetchKbArticle(): Promise<{ title?: string; edited_at?: string; body?: string } | null> {
  try {
    const json = await fetchJson(KB_URL, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } }) as { article?: Record<string, unknown> };
    const a = json?.article;
    return a ? { title: String(a['title'] ?? ''), edited_at: String(a['edited_at'] ?? ''), body: String(a['body'] ?? '') } : null;
  } catch (err) {
    console.error('patch-stability: KB fetch failed:', err);
    return null;
  }
}

/** Merge the top-25 replies of both threads into one 50-reply population. */
function communityOf(rn: ThreadPayload | null, hf: ThreadPayload | null) {
  const replies = [...(rn?.replies ?? []), ...(hf?.replies ?? [])];
  return topReplyMetrics(replies);
}

async function upsertPatch(patch: LivePatch, rn: ThreadPayload | null, extra: Record<string, unknown> = {}) {
  const text = rn ? draftBlocksOf(rn.content_blocks).map((b) => b.text).join('\n') : '';
  const cig = text ? parseCigFixSentence(text) : null;
  const { error } = await admin().from('patch_stability_patches').upsert({
    patch_line: patch.line,
    live_at: patch.liveAt,
    notes_thread_id: patch.notes.id,
    notes_slug: patch.notes.slug,
    hotfix_thread_id: patch.hotfix?.id ?? null,
    hotfix_slug: patch.hotfix?.slug ?? null,
    cig_fixes: cig?.fixes ?? null,
    cig_fixes_ic: cig?.fromIssueCouncil ?? null,
    cig_crash_fixes: cig?.crashFixes ?? null,
    cig_exploit_fixes: cig?.exploitFixes ?? null,
    updated_at: new Date().toISOString(),
    ...extra,
  }, { onConflict: 'patch_line' });
  if (error) throw new Error(`patches upsert ${patch.line}: ${error.message}`);
}

async function sampleLine(patch: LivePatch, issues: StatusIssue[] | null, kb: Awaited<ReturnType<typeof fetchKbArticle>>, now: Date) {
  const [rn, hf] = await Promise.all([
    fetchThread(patch.notes.slug),
    patch.hotfix ? fetchThread(patch.hotfix.slug) : Promise.resolve(null),
  ]);
  if (!rn) throw new Error(`release-notes thread unavailable for ${patch.line}`);
  await upsertPatch(patch, rn);

  const community = communityOf(rn, hf);
  const window = issues
    ? statusWindow(issues, new Date(now.getTime() - WINDOW_DAYS * DAY_MS).toISOString(), now.toISOString())
    : { unplannedMinutes: 0, unplannedCount: 0, openIncident: false };
  const snap = kb ? kbSnapshot(kb, patch.line) : null;

  const { error } = await admin().from('patch_stability_samples').upsert({
    patch_line: patch.line,
    sampled_on: now.toISOString().slice(0, 10),
    sampled_at: now.toISOString(),
    rn_replies: rn.replies_count,
    rn_votes: rn.votes,
    hf_replies: hf?.replies_count ?? null,
    hf_votes: hf?.votes ?? null,
    top_ticket_share: community.ticketShare,
    top_ticket_vote_share: community.ticketVoteShare,
    top_tickets: community.tickets,
    hotfix_events: hf ? parseHotfixEvents(hf.content_blocks) : [],
    outage_min_7d: window.unplannedMinutes,
    open_incident: window.openIncident,
    kb_open_total: snap?.openTotal ?? null,
    kb_by_section: snap?.bySection ?? null,
    kb_anchor_ids: snap?.anchorIds ?? null,
    kb_edited_at: snap?.editedAt ?? null,
  }, { onConflict: 'patch_line,sampled_on' });
  if (error) throw new Error(`samples upsert ${patch.line}: ${error.message}`);
}

async function newestSampleAt(): Promise<number> {
  const { data } = await admin()
    .from('patch_stability_samples')
    .select('sampled_at')
    .order('sampled_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  const t = data ? Date.parse(String((data as { sampled_at: string }).sampled_at)) : NaN;
  return Number.isFinite(t) ? t : 0;
}

async function runDaily(force: boolean): Promise<Response> {
  const now = new Date();
  if (!force && now.getTime() - (await newestSampleAt()) < THROTTLE_MS) {
    return json({ ok: true, skipped: true });
  }
  const rows = await listThreads(LIST_PAGES_DAILY);
  const lines = detectLiveThreads(rows).slice(0, 2); // newest + previous
  const [issues, kb] = await Promise.all([fetchStatusIssues(), fetchKbArticle()]);
  const done: string[] = [];
  for (const patch of lines) {
    try {
      await sampleLine(patch, issues, kb, now);
      done.push(patch.line);
    } catch (err) {
      console.error(`patch-stability: line ${patch.line} failed:`, err);
    }
  }
  return json({ ok: true, lines: done });
}

/**
 * End-state for every LIVE line on the board: replies and top-reply ticket
 * metrics of both threads, unplanned status minutes per live day over the
 * line's whole window (live_at → next line's live_at, or now).
 */
async function runBackfill(): Promise<Response> {
  const now = new Date();
  const rows = await listThreads(LIST_PAGES_BACKFILL);
  const lines = detectLiveThreads(rows); // newest first
  const issues = await fetchStatusIssues();
  let registered = 0;
  for (let i = 0; i < lines.length; i++) {
    const patch = lines[i];
    const endIso = i === 0 ? now.toISOString() : lines[i - 1].liveAt;
    const days = Math.max(1, (Date.parse(endIso) - Date.parse(patch.liveAt)) / DAY_MS);
    try {
      const [rn, hf] = await Promise.all([
        fetchThread(patch.notes.slug),
        patch.hotfix ? fetchThread(patch.hotfix.slug) : Promise.resolve(null),
      ]);
      if (!rn) continue;
      const community = communityOf(rn, hf);
      const window = issues ? statusWindow(issues, patch.liveAt, endIso) : null;
      await upsertPatch(patch, rn, {
        // RN only: Hotfix Central threads were locked before 4.9, so the RN
        // count is the one comparable across every line.
        final_replies: rn.replies_count,
        final_outage_min_per_day: window ? window.unplannedMinutes / days : null,
        final_ticket_share: community.ticketShare,
        final_ticket_vote_share: community.ticketVoteShare,
      });
      registered++;
    } catch (err) {
      console.error(`patch-stability backfill ${patch.line} failed:`, err);
    }
  }
  return json({ ok: true, registered });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS_HEADERS });
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: 'service role not configured' }, 500);
  const url = new URL(req.url);
  try {
    if (url.searchParams.get('backfill') === '1') return await runBackfill();
    return await runDaily(url.searchParams.get('force') === '1');
  } catch (err) {
    console.error('patch-stability-sample failed:', err);
    return json({ ok: false, error: String(err) }, 500);
  }
});
```

- [ ] **Step 2: Register the function in `supabase/config.toml`**

Append after the `[functions.api]` block:

```toml
[functions.patch-stability-sample]
# JWT verification OFF (same rationale as fetch-verse-news): the daily sampler
# behind the patch board's stability indicator only mirrors public data
# (Spectrum comment counts, the RSI status page, CIG's Known Issues article)
# into two anon-readable tables via the service role. It is triggered by
# pg_cron/pg_net without a JWT and self-throttles (skips when the newest sample
# is < 6 h old), so an unauthenticated call cannot cause upstream load.
verify_jwt = false
```

- [ ] **Step 3: Type-check with Deno and dry-run locally**

Run: `deno check supabase/functions/patch-stability-sample/index.ts`
Expected: no errors. (Deno is installed with the Supabase CLI toolchain; if `deno` is missing, `npx supabase functions serve patch-stability-sample --no-verify-jwt` performs the same check on start.)

Then, with the local stack or against cloud (needs `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` in `supabase/functions/.env` — never committed):

```bash
npx supabase functions serve patch-stability-sample --no-verify-jwt --env-file supabase/functions/.env
```
and in a second shell:
```bash
curl -s "http://127.0.0.1:54321/functions/v1/patch-stability-sample?force=1"
```
Expected: `{"ok":true,"lines":["4.10","4.9"]}` and two rows in `patch_stability_samples`. Skip this step if no local stack is available; the deploy gate at ship time covers it (CI deploys the function, then a manual `?force=1` call verifies).

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/patch-stability-sample/index.ts supabase/config.toml
git commit -m "feat(functions): patch-stability-sample daily sampler

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Scheduler migration

**Files:**
- Create: `supabase/migrations/20260906130000_patch_stability_cron.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Daily trigger for the patch-stability sampler.
--
-- The repo had no scheduler until now (no pg_cron, no GitHub schedule). pg_cron
-- + pg_net is the in-repo option: nothing to babysit on the dev PC, no second
-- CI secret, and the job definition is versioned here.
--
-- DEPLOY ORDER: the edge function must exist before this job fires — CI deploys
-- `patch-stability-sample` on merge (edge-functions-deploy.yml); apply this
-- migration afterwards (`npm run db:push` from the primary checkout).
--
-- The request carries the PUBLISHABLE key only (it is already in the client
-- bundle). The function does its own throttling; see its header.

create extension if not exists pg_cron;
create extension if not exists pg_net;

grant usage on schema cron to postgres;

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
    body    := '{}'::jsonb
  );
  $job$
);
```

- [ ] **Step 2: Verify the prefix is unique against `origin/main`**

Run: `git fetch -q origin && git ls-tree --name-only origin/main supabase/migrations/ | grep -c 20260906`
Expected: `0`. If not, renumber both new migrations (filename + supabase.md rows) — see memory `sc-migration-version-collision`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260906130000_patch_stability_cron.sql
git commit -m "feat(db): schedule the patch-stability sampler via pg_cron

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: Client service

**Files:**
- Create: `src/app/news/patch-stability.service.ts`
- Test: `src/app/news/patch-stability.service.spec.ts`

**Interfaces:**
- Consumes: `computeVerdict`, `StabilityPatchRow`, `StabilitySampleRow`, `StabilityVerdict` (Task 1); `SupabaseClientProvider.client` (`src/app/core/supabase.client.ts`).
- Produces: `PatchStabilityService` with `load(): Promise<void>`, `verdictFor(line: string): StabilityVerdict | null`, `allTime: Signal<StabilityVerdict[]>` (oldest first), `loaded: Signal<boolean>`, `unavailable: Signal<boolean>`; pure helper `buildVerdicts(patches, samples, nowIso): Map<string, StabilityVerdict>`.

- [ ] **Step 1: Write the failing test for the pure helper**

```ts
// src/app/news/patch-stability.service.spec.ts
import { buildVerdicts } from './patch-stability.service';
import { StabilityPatchRow, StabilitySampleRow } from './patch-stability';

const row = (line: string, liveAt: string, replies: number): StabilityPatchRow => ({
  patch_line: line, live_at: liveAt, notes_thread_id: 1, notes_slug: 's', hotfix_thread_id: null, hotfix_slug: null,
  cig_fixes: null, cig_fixes_ic: null, cig_crash_fixes: null, cig_exploit_fixes: null,
  final_replies: replies, final_outage_min_per_day: 0, final_ticket_share: 0.1, final_ticket_vote_share: 0.1,
});
const smp = (line: string, on: string, replies: number): StabilitySampleRow => ({
  patch_line: line, sampled_on: on, rn_replies: replies, rn_votes: 0, hf_replies: null, hf_votes: null,
  top_ticket_share: 0, top_ticket_vote_share: 0, top_tickets: [], hotfix_events: [], outage_min_7d: 0, open_incident: false,
  kb_open_total: null, kb_by_section: null, kb_anchor_ids: null, kb_edited_at: null,
});

describe('buildVerdicts', () => {
  it('windows each line up to the next line’s live date and only the newest is early', () => {
    const verdicts = buildVerdicts(
      [row('4.9', '2026-07-15T00:00:00Z', 300), row('4.10', '2026-08-26T00:00:00Z', 0)],
      [smp('4.10', '2026-09-04', 60), smp('4.10', '2026-09-05', 78)],
      '2026-09-05T12:00:00Z',
    );
    const v49 = verdicts.get('4.9')!;
    const v410 = verdicts.get('4.10')!;
    expect(v49.daysLive).toBeCloseTo(42, 6);
    expect(v49.historical).toBeTrue();
    expect(v49.early).toBeFalse();
    expect(v410.historical).toBeFalse();
    expect(v410.early).toBeTrue();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='src/app/news/patch-stability.service.spec.ts'`
Expected: compile error, module not found.

- [ ] **Step 3: Implement the service**

```ts
// src/app/news/patch-stability.service.ts
import { Injectable, computed, inject, signal } from '@angular/core';
import { SupabaseClientProvider } from '../core/supabase.client';
import { StabilityPatchRow, StabilitySampleRow, StabilityVerdict, computeVerdict } from './patch-stability';

/** How many days of samples the board loads per line — the timeline never needs more. */
const SAMPLE_DAYS = 120;

/**
 * Rows → verdicts, one per patch line. Each line's window ends where the next
 * line went live; only the newest line can be "early".
 */
export function buildVerdicts(
  patches: StabilityPatchRow[],
  samples: StabilitySampleRow[],
  nowIso: string,
): Map<string, StabilityVerdict> {
  const sorted = [...patches].sort((a, b) => Date.parse(a.live_at) - Date.parse(b.live_at));
  const byLine = new Map<string, StabilitySampleRow[]>();
  for (const s of samples) {
    const list = byLine.get(s.patch_line) ?? [];
    list.push(s);
    byLine.set(s.patch_line, list);
  }
  const out = new Map<string, StabilityVerdict>();
  sorted.forEach((p, i) => {
    const next = sorted[i + 1];
    out.set(p.patch_line, computeVerdict(p, byLine.get(p.patch_line) ?? [], {
      now: nowIso,
      endAt: next ? next.live_at : null,
    }));
  });
  return out;
}

/**
 * The patch board's stability data: both tables, loaded once per visit through
 * the anon client (RLS grants public read). Quiet on failure — `unavailable`
 * flips and every consumer hides itself; a reader cannot act on "the sampler's
 * tables are unreachable".
 */
@Injectable({ providedIn: 'root' })
export class PatchStabilityService {
  private readonly sb = inject(SupabaseClientProvider);

  private readonly patches = signal<StabilityPatchRow[]>([]);
  private readonly samples = signal<StabilitySampleRow[]>([]);
  private readonly now = signal(new Date().toISOString());
  private inFlight: Promise<void> | null = null;

  readonly loaded = signal(false);
  readonly unavailable = signal(false);

  private readonly verdicts = computed(() => buildVerdicts(this.patches(), this.samples(), this.now()));

  /** Every line with a verdict, oldest first — the all-time chart's columns. */
  readonly allTime = computed<StabilityVerdict[]>(() =>
    [...this.verdicts().values()].sort((a, b) => Date.parse(a.liveAt) - Date.parse(b.liveAt)),
  );

  verdictFor(line: string): StabilityVerdict | null {
    return this.verdicts().get(line) ?? null;
  }

  /** Load once; concurrent callers share the same request. */
  load(): Promise<void> {
    if (this.loaded()) return Promise.resolve();
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.fetchAll().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async fetchAll(): Promise<void> {
    const since = new Date(Date.now() - SAMPLE_DAYS * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const client = this.sb.client;
    const [p, s] = await Promise.all([
      client.from('patch_stability_patches').select('*'),
      client.from('patch_stability_samples').select('*').gte('sampled_on', since).order('sampled_on', { ascending: true }),
    ]);
    if (p.error || s.error) {
      this.unavailable.set(true);
      return;
    }
    this.patches.set((p.data ?? []) as StabilityPatchRow[]);
    this.samples.set((s.data ?? []) as StabilitySampleRow[]);
    this.now.set(new Date().toISOString());
    this.unavailable.set(false);
    this.loaded.set(true);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='src/app/news/patch-stability.service.spec.ts'`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/news/patch-stability.service.ts src/app/news/patch-stability.service.spec.ts
git commit -m "feat(news): load patch stability rows into verdicts

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: i18n keys

**Files:**
- Modify: `public/i18n/de.json` (inside `news.patch`, after the `"detail": { … }` object that ends at line ≈1393)
- Modify: `public/i18n/en.json` (same position)

- [ ] **Step 1: Add the German block**

Insert after the closing `}` of `news.patch.detail` (the line containing `"collapseAll": "Alle Notes einklappen"` and its `}`), adding a comma to that `}`:

```json
      "stability": {
        "title": "Stabilität",
        "chipAria": "Stabilität von Patch {{version}}: {{level}}",
        "earlyShort": "früh",
        "early": "Tag {{day}} von {{threshold}} – Einordnung noch vorläufig",
        "insufficient": "Noch zu wenig Daten für eine Einordnung.",
        "historical": "Endstand – kein Tagesverlauf, der Patch lief vor dem Start der täglichen Messung.",
        "score": "Index {{score}} / 100",
        "component": {
          "community": "Community",
          "service": "Dienste",
          "cig": "CIG Known Issues",
          "none": "keine Daten"
        },
        "componentHint": {
          "community": "Neue Antworten pro Tag auf Notes- und Hotfix-Thread, Anteil und Upvote-Gewicht der Antworten mit Issue-Council-Ticket",
          "service": "Ungeplante Störungsminuten pro Tag laut RSI-Status (7 Tage), plus offene Störung",
          "cig": "Offene Einträge im Known-Issues-Artikel von CIG und deren Zuwachs über 7 Tage"
        },
        "level": {
          "1": "Alle Systeme nominal",
          "2": "Leichte Turbulenzen",
          "3": "Systeme beeinträchtigt",
          "4": "Instabil",
          "5": "Kritisch"
        },
        "timeline": "Verlauf seit LIVE",
        "timelineAria": "Stabilität pro Tag seit LIVE, {{days}} Messpunkte",
        "dayTitle": "{{date}}: {{level}} ({{score}}), {{velocity}} neue Antworten/Tag",
        "hotfixMark": "Hotfix {{build}} am {{date}}",
        "hotfixes": "{{count}} Hotfixes",
        "tickets": {
          "title": "Was die Community meldet",
          "hint": "Issue-Council-Tickets aus den höchstbewerteten Antworten",
          "votes": "{{count}} Stimmen",
          "empty": "Keine Tickets in den Top-Antworten."
        },
        "kb": "{{count}} offene Known Issues laut CIG",
        "cigFixes": "CIG: {{fixes}} Fixes in diesem Patch, {{ic}} davon aus dem Issue Council",
        "source": "Quellen: Spectrum-Kommentare, RSI-Status, CIG Known Issues. Keine Issue-Council-Zahlen (Login-Pflicht).",
        "history": {
          "title": "Stabilität je Patch",
          "hint": "Endstand je LIVE-Patch; der aktuelle ist schraffiert, solange er früh ist",
          "colAria": "Patch {{version}}: {{level}}",
          "noData": "ohne Einordnung"
        }
      }
```

- [ ] **Step 2: Add the English block at the same position in `en.json`**

```json
      "stability": {
        "title": "Stability",
        "chipAria": "Stability of patch {{version}}: {{level}}",
        "earlyShort": "early",
        "early": "Day {{day}} of {{threshold}} – verdict still provisional",
        "insufficient": "Not enough data for a verdict yet.",
        "historical": "Final state – no daily timeline, this patch ran before daily sampling started.",
        "score": "Index {{score}} / 100",
        "component": {
          "community": "Community",
          "service": "Services",
          "cig": "CIG known issues",
          "none": "no data"
        },
        "componentHint": {
          "community": "New replies per day on the notes and hotfix threads, share and upvote weight of replies carrying an Issue Council ticket",
          "service": "Unplanned degraded minutes per day per RSI Status (7 days), plus any open incident",
          "cig": "Open entries in CIG's Known Issues article and their 7-day growth"
        },
        "level": {
          "1": "All systems nominal",
          "2": "Minor turbulence",
          "3": "Systems degraded",
          "4": "Unstable",
          "5": "Critical"
        },
        "timeline": "Since LIVE",
        "timelineAria": "Stability per day since LIVE, {{days}} samples",
        "dayTitle": "{{date}}: {{level}} ({{score}}), {{velocity}} new replies/day",
        "hotfixMark": "Hotfix {{build}} on {{date}}",
        "hotfixes": "{{count}} hotfixes",
        "tickets": {
          "title": "What the community reports",
          "hint": "Issue Council tickets from the top-voted replies",
          "votes": "{{count}} votes",
          "empty": "No tickets in the top replies."
        },
        "kb": "{{count}} open known issues per CIG",
        "cigFixes": "CIG: {{fixes}} fixes in this patch, {{ic}} of them from the Issue Council",
        "source": "Sources: Spectrum comments, RSI Status, CIG Known Issues. No Issue Council counts (login required).",
        "history": {
          "title": "Stability per patch",
          "hint": "Final state per LIVE patch; the current one is hatched while early",
          "colAria": "Patch {{version}}: {{level}}",
          "noData": "no verdict"
        }
      }
```

- [ ] **Step 3: Validate both files parse and carry the same keys**

Run:
```bash
node -e "const d=require('./public/i18n/de.json').news.patch.stability,e=require('./public/i18n/en.json').news.patch.stability;const k=o=>Object.keys(o).flatMap(x=>typeof o[x]==='object'?Object.keys(o[x]).map(y=>x+'.'+y):[x]).sort();console.log(JSON.stringify(k(d))===JSON.stringify(k(e))?'keys match':'MISMATCH')"
```
Expected: `keys match`.

- [ ] **Step 4: Commit**

```bash
git add public/i18n/de.json public/i18n/en.json
git commit -m "feat(i18n): patch stability strings

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Chip component + row integration

**Files:**
- Create: `src/app/news/stability-chip.component.ts`
- Modify: `src/app/news/patch-entry-row.component.ts`
- Test: `src/app/news/stability-chip.component.spec.ts`

**Interfaces:**
- Consumes: `StabilityVerdict`, `EARLY_DAYS` (Task 1); `PatchStabilityService.verdictFor` (Task 6); `patchLineOf` from `./patch-notes`.
- Produces: `<sc-stability-chip [verdict]>`; `PatchEntryRowComponent.verdict` computed signal passed to the detail as `[verdict]` (Task 9 adds that input).

- [ ] **Step 1: Write the failing component test**

```ts
// src/app/news/stability-chip.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { StabilityChipComponent } from './stability-chip.component';
import { StabilityVerdict } from './patch-stability';

function verdict(extra: Partial<StabilityVerdict>): StabilityVerdict {
  return {
    line: '4.10', liveAt: '2026-08-26T00:00:00Z', daysLive: 10, level: 3, score: 0.44,
    components: { community: 0.49, service: 0, cig: 0.31 }, early: true, insufficient: false, historical: false,
    days: [], tickets: [], kbOpen: 55, hotfixes: [], ...extra,
  };
}

describe('StabilityChipComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [StabilityChipComponent, TranslateModule.forRoot()] }));

  function render(v: StabilityVerdict | null) {
    const f = TestBed.createComponent(StabilityChipComponent);
    f.componentRef.setInput('verdict', v);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('renders the level with its data attribute and the early marker', () => {
    const el = render(verdict({}));
    const chip = el.querySelector('.chip')!;
    expect(chip.getAttribute('data-level')).toBe('3');
    expect(chip.classList.contains('early')).toBeTrue();
  });

  it('renders nothing when insufficient or null', () => {
    expect(render(verdict({ insufficient: true, level: null })).querySelector('.chip')).toBeNull();
    expect(render(null).querySelector('.chip')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='src/app/news/stability-chip.component.spec.ts'`
Expected: compile error, module not found.

- [ ] **Step 3: Implement the chip**

```ts
// src/app/news/stability-chip.component.ts
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslateModule } from '@ngx-translate/core';
import { EARLY_DAYS, StabilityVerdict } from './patch-stability';

/**
 * The five-level stability pill on a collapsed LIVE row. Dashed while the
 * patch is younger than EARLY_DAYS — the verdict is provisional and the
 * border says so before the tooltip does. Hidden when there is no verdict:
 * an empty chip would read as "nominal".
 */
@Component({
  selector: 'sc-stability-chip',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (verdict(); as v) {
      @if (v.level !== null) {
        <span class="chip" [attr.data-level]="v.level" [class.early]="v.early"
              [attr.title]="v.early ? ('news.patch.stability.early' | translate:{ day: day(), threshold: threshold }) : null"
              [attr.aria-label]="'news.patch.stability.chipAria' | translate:{ version: v.line, level: (levelKey() | translate) }">
          <span class="dot" aria-hidden="true"></span>
          <span>{{ levelKey() | translate }}</span>
          @if (v.early) {
            <span class="early-mark">{{ 'news.patch.stability.earlyShort' | translate }}</span>
          }
        </span>
      }
    }
  `,
  styles: [`
    :host { display: inline-flex; }
    .chip {
      display: inline-flex; align-items: center; gap: 5px;
      padding: 1px 7px; border-radius: 999px;
      font-size: max(0.64rem, var(--sc-fs-floor)); font-weight: 700;
      letter-spacing: 0.02em; white-space: nowrap;
      color: var(--level); border: 1px solid color-mix(in srgb, var(--level) 55%, transparent);
    }
    .chip.early { border-style: dashed; }
    .dot { width: 6px; height: 6px; border-radius: 50%; background: var(--level); }
    .early-mark { font-weight: 500; color: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.07em; }
    .chip[data-level='1'] { --level: var(--sc-success); }
    .chip[data-level='2'] { --level: var(--sc-accent); }
    .chip[data-level='3'] { --level: var(--sc-warning); }
    .chip[data-level='4'] { --level: var(--sc-warn); }
    .chip[data-level='5'] { --level: var(--sc-danger); }
  `],
})
export class StabilityChipComponent {
  readonly verdict = input<StabilityVerdict | null>(null);
  readonly threshold = EARLY_DAYS;
  readonly levelKey = computed(() => `news.patch.stability.level.${this.verdict()?.level ?? 1}`);
  readonly day = computed(() => Math.max(1, Math.ceil(this.verdict()?.daysLive ?? 0)));
}
```

- [ ] **Step 4: Wire it into the entry row**

In `src/app/news/patch-entry-row.component.ts`:

Imports — add:
```ts
import { PatchNoteEntry, patchLineOf } from './patch-notes';
import { PatchStabilityService } from './patch-stability.service';
import { StabilityChipComponent } from './stability-chip.component';
```
(replace the existing `import { PatchNoteEntry } from './patch-notes';`).

`imports:` — add `StabilityChipComponent`.

Template — directly after the hotfix tag block (`@if (!compact() && entry().hotfix) { … }`) insert:
```html
            @if (verdict(); as v) {
              <sc-stability-chip [verdict]="v" />
            }
```
and change the detail line to pass the verdict:
```html
      <sc-patch-note-detail [slug]="slug()" [url]="entry().item.url" [tokens]="tokens()" [verdict]="verdict()" />
```

Class — add after `private readonly svc = inject(RoadmapService);`:
```ts
  private readonly stability = inject(PatchStabilityService);

  /**
   * Only the LIVE release-notes row carries the verdict: it is the one row a
   * reader identifies with "the patch". Hotfix threads and PTU waves stay bare.
   */
  readonly verdict = computed(() => {
    const e = this.entry();
    if (e.stage !== 'live' || e.hotfix || !e.version) return null;
    return this.stability.verdictFor(patchLineOf(e.version));
  });
```

- [ ] **Step 5: Run the chip test and the typecheck**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='src/app/news/stability-chip.component.spec.ts' && npm run typecheck`
Expected: PASS; typecheck will fail on `[verdict]` of the detail until Task 9 — that is expected, proceed to Task 9 before building.

- [ ] **Step 6: Commit**

```bash
git add src/app/news/stability-chip.component.ts src/app/news/stability-chip.component.spec.ts src/app/news/patch-entry-row.component.ts
git commit -m "feat(news): stability chip on LIVE patch rows

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: Panel component + detail integration

**Files:**
- Create: `src/app/news/stability-panel.component.ts`
- Modify: `src/app/news/patch-note-detail.component.ts`
- Test: `src/app/news/stability-panel.component.spec.ts`

**Interfaces:**
- Consumes: `StabilityVerdict`, `StabilityDay`, `EARLY_DAYS` (Task 1); i18n keys (Task 7).
- Produces: `<sc-stability-panel [verdict] [cigFixes] [cigFixesIc]>`; `PatchNoteDetailComponent.verdict` input.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/news/stability-panel.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { StabilityPanelComponent } from './stability-panel.component';
import { StabilityVerdict } from './patch-stability';

const base: StabilityVerdict = {
  line: '4.10', liveAt: '2026-08-26T00:00:00Z', daysLive: 10, level: 3, score: 0.437,
  components: { community: 0.49, service: 0, cig: 0.31 }, early: true, insufficient: false, historical: false,
  days: [
    { date: '2026-09-04', velocity: 30, score: 0.4, level: 3, components: { community: 0.4, service: 0, cig: 0.3 }, hotfixes: [] },
    { date: '2026-09-05', velocity: 39, score: 0.437, level: 3, components: { community: 0.49, service: 0, cig: 0.31 },
      hotfixes: [{ date: '2026-09-05', build: '12572603', text: 'Client Hotfix' }] },
  ],
  tickets: [{ id: 'STARC-218134', votes: 13, excerpt: 'Battaglia Story Mission 2 does not show up' }],
  kbOpen: 55, hotfixes: [],
};

describe('StabilityPanelComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [StabilityPanelComponent, TranslateModule.forRoot()] }));

  function render(v: StabilityVerdict) {
    const f = TestBed.createComponent(StabilityPanelComponent);
    f.componentRef.setInput('verdict', v);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('renders headline, three component bars, a column per day with hotfix marks, and ticket anchors', () => {
    const el = render(base);
    expect(el.querySelector('.headline')!.getAttribute('data-level')).toBe('3');
    expect(el.querySelectorAll('.comp').length).toBe(3);
    expect(el.querySelectorAll('.col').length).toBe(2);
    expect(el.querySelectorAll('.col.hotfix').length).toBe(1);
    expect(el.querySelectorAll('.col.early').length).toBe(2);
    const a = el.querySelector('a.ticket') as HTMLAnchorElement;
    expect(a.href).toContain('issue-council.robertsspaceindustries.com/projects/STAR-CITIZEN/issues/STARC-218134');
    expect(a.getAttribute('target')).toBe('_blank');
    expect(a.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('historical verdict: headline + end-state note, no timeline', () => {
    const el = render({ ...base, historical: true, early: false, days: [], tickets: [], kbOpen: null });
    expect(el.querySelector('.headline')).not.toBeNull();
    expect(el.querySelector('.chart')).toBeNull();
    expect(el.querySelector('.state.historical')).not.toBeNull();
  });

  it('insufficient verdict: only the "not enough data" state', () => {
    const el = render({ ...base, insufficient: true, level: null, score: null });
    expect(el.querySelector('.headline')).toBeNull();
    expect(el.querySelector('.state.insufficient')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='src/app/news/stability-panel.component.spec.ts'`
Expected: module not found.

- [ ] **Step 3: Implement the panel**

```ts
// src/app/news/stability-panel.component.ts
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { EARLY_DAYS, StabilityComponents, StabilityDay, StabilityVerdict } from './patch-stability';

const ISSUE_URL = 'https://issue-council.robertsspaceindustries.com/projects/STAR-CITIZEN/issues/';
type CompKey = keyof StabilityComponents;
const COMP_KEYS: CompKey[] = ['community', 'service', 'cig'];

/**
 * The stability block inside an expanded LIVE note: the verdict, what it is
 * made of, how it moved since LIVE, and which tickets the community is loudest
 * about. Same CSS-bar grammar as the cadence panel (no chart library).
 *
 * The first EARLY_DAYS columns are hatched: a verdict from day 3 is a guess
 * that the next hotfix may overturn, and the chart says so without a footnote.
 * Hotfixes are ticks under the columns, never part of the bar height.
 */
@Component({
  selector: 'sc-stability-panel',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (verdict(); as v) {
      <section class="sp" [attr.aria-label]="'news.patch.stability.title' | translate">
        @if (v.insufficient) {
          <p class="state insufficient">{{ 'news.patch.stability.insufficient' | translate }}</p>
        } @else {
          <div class="headline" [attr.data-level]="v.level">
            <span class="dot" aria-hidden="true"></span>
            <span class="lvl">{{ ('news.patch.stability.level.' + v.level) | translate }}</span>
            <span class="score">{{ 'news.patch.stability.score' | translate:{ score: pct(v.score) } }}</span>
            @if (v.early) {
              <span class="early">{{ 'news.patch.stability.early' | translate:{ day: day(), threshold: threshold } }}</span>
            }
          </div>

          <ul class="comps">
            @for (k of compKeys; track k) {
              <li class="comp" [attr.title]="('news.patch.stability.componentHint.' + k) | translate">
                <span class="comp-name">{{ ('news.patch.stability.component.' + k) | translate }}</span>
                <span class="comp-bar" aria-hidden="true">
                  @if (v.components[k] !== null) {
                    <span class="comp-fill" [style.width.%]="pct(v.components[k])"></span>
                  }
                </span>
                <span class="comp-val">
                  {{ v.components[k] === null ? ('news.patch.stability.component.none' | translate) : pct(v.components[k]) }}
                </span>
              </li>
            }
          </ul>

          @if (v.historical) {
            <p class="state historical">{{ 'news.patch.stability.historical' | translate }}</p>
          } @else {
            <div class="chart-wrap">
              <p class="chart-title">{{ 'news.patch.stability.timeline' | translate }}</p>
              <div class="chart" role="img" [attr.aria-label]="'news.patch.stability.timelineAria' | translate:{ days: v.days.length }">
                @for (d of v.days; track d.date) {
                  <span class="col" [class.early]="isEarlyDay(v, d)" [class.hotfix]="d.hotfixes.length > 0"
                        [attr.data-level]="d.level" [attr.title]="dayTitle(d)">
                    <span class="col-bar" [style.height.%]="pct(d.score)"></span>
                    @if (d.hotfixes.length > 0) {
                      <span class="tick" [attr.title]="hotfixTitle(d)" aria-hidden="true"></span>
                    }
                  </span>
                }
              </div>
              <div class="chart-axis" aria-hidden="true">
                <span>{{ v.days[0]?.date }}</span>
                <span>{{ v.days[v.days.length - 1]?.date }}</span>
              </div>
            </div>
          }

          <div class="facts">
            @if (v.kbOpen !== null) {
              <span>{{ 'news.patch.stability.kb' | translate:{ count: v.kbOpen } }}</span>
            }
            @if (v.hotfixes.length > 0) {
              <span>{{ 'news.patch.stability.hotfixes' | translate:{ count: v.hotfixes.length } }}</span>
            }
            @if (cigFixes() !== null && cigFixesIc() !== null) {
              <span>{{ 'news.patch.stability.cigFixes' | translate:{ fixes: cigFixes(), ic: cigFixesIc() } }}</span>
            }
          </div>

          @if (!v.historical) {
            <div class="tickets">
              <p class="tk-title">{{ 'news.patch.stability.tickets.title' | translate }}
                <span class="tk-hint">{{ 'news.patch.stability.tickets.hint' | translate }}</span></p>
              @if (v.tickets.length === 0) {
                <p class="state">{{ 'news.patch.stability.tickets.empty' | translate }}</p>
              } @else {
                <ul class="tk-list">
                  @for (t of v.tickets; track t.id) {
                    <li>
                      <!-- The ticket lives on the Issue Council → real anchor, new tab. -->
                      <a class="ticket" [href]="issueUrl + t.id" target="_blank" rel="noopener noreferrer">
                        <span class="tk-id">{{ t.id }}</span>
                        <span class="tk-votes">{{ 'news.patch.stability.tickets.votes' | translate:{ count: t.votes } }}</span>
                        <span class="tk-text">{{ t.excerpt }}</span>
                      </a>
                    </li>
                  }
                </ul>
              }
            </div>
          }
          <p class="source">{{ 'news.patch.stability.source' | translate }}</p>
        }
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .sp {
      display: flex; flex-direction: column; gap: 10px;
      padding: 10px 12px; margin-bottom: 4px;
      border: 1px solid color-mix(in srgb, var(--sc-border) 70%, transparent); border-radius: 8px;
      background: color-mix(in srgb, var(--sc-bg-1) 60%, transparent);
    }
    .state { margin: 0; color: var(--sc-fg-2); font-size: max(0.76rem, var(--sc-fs-floor)); }
    .headline {
      display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
      font-family: var(--sc-font-display); font-size: max(0.95rem, var(--sc-fs-floor));
      color: var(--level);
    }
    .headline .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--level); }
    .headline .score, .headline .early { font-family: inherit; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .headline .early { border: 1px dashed color-mix(in srgb, var(--sc-fg-2) 60%, transparent); border-radius: 999px; padding: 0 7px; }
    [data-level='1'] { --level: var(--sc-success); }
    [data-level='2'] { --level: var(--sc-accent); }
    [data-level='3'] { --level: var(--sc-warning); }
    [data-level='4'] { --level: var(--sc-warn); }
    [data-level='5'] { --level: var(--sc-danger); }

    .comps { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; }
    .comp { display: grid; grid-template-columns: 9rem 1fr 3rem; align-items: center; gap: 8px; font-size: max(0.72rem, var(--sc-fs-floor)); }
    .comp-name { color: var(--sc-fg-1); }
    .comp-bar { height: 6px; border-radius: 3px; background: color-mix(in srgb, var(--sc-fg-2) 20%, transparent); overflow: hidden; }
    .comp-fill { display: block; height: 100%; background: var(--sc-accent); }
    .comp-val { text-align: right; color: var(--sc-fg-2); font-variant-numeric: tabular-nums; }

    /* ---- Bars: same grammar as the cadence panel ---- */
    .chart-wrap { display: flex; flex-direction: column; gap: 4px; }
    .chart-title { margin: 0; font-size: max(0.7rem, var(--sc-fs-floor)); color: var(--sc-fg-2); text-transform: uppercase; letter-spacing: 0.07em; }
    .chart { position: relative; display: flex; align-items: flex-end; gap: 2px; height: 72px; padding: 0 2px 6px; border-bottom: 1px solid var(--sc-border); }
    .col { position: relative; flex: 1 1 0; min-width: 3px; max-width: 18px; display: flex; align-items: flex-end; height: 100%; }
    .col-bar { width: 100%; border-radius: 2px 2px 0 0; background: var(--level); transition: height 0.3s ease; }
    .col.early .col-bar {
      background: repeating-linear-gradient(135deg, var(--level) 0 2px, transparent 2px 5px);
      outline: 1px dashed color-mix(in srgb, var(--level) 70%, transparent);
    }
    .tick { position: absolute; left: 50%; bottom: -6px; width: 2px; height: 6px; background: var(--sc-fg-1); transform: translateX(-50%); }
    .chart-axis { display: flex; justify-content: space-between; gap: 8px; font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    .facts { display: flex; flex-wrap: wrap; gap: 6px 14px; font-size: max(0.72rem, var(--sc-fs-floor)); color: var(--sc-fg-1); }

    .tickets { display: flex; flex-direction: column; gap: 4px; }
    .tk-title { margin: 0; font-size: max(0.72rem, var(--sc-fs-floor)); font-weight: 700; color: var(--sc-fg-1); }
    .tk-hint { font-weight: 400; color: var(--sc-fg-2); margin-left: 6px; }
    .tk-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 2px; }
    .ticket {
      display: grid; grid-template-columns: auto auto 1fr; gap: 8px; align-items: baseline;
      min-height: var(--sc-tap-min); padding: 2px 4px; border-radius: 4px;
      color: inherit; text-decoration: none; font-size: max(0.74rem, var(--sc-fs-floor));
    }
    .ticket:hover { background: color-mix(in srgb, var(--sc-accent) 10%, transparent); }
    .ticket:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: -2px; }
    .tk-id { color: var(--sc-accent); font-weight: 700; }
    .tk-votes { color: var(--sc-fg-2); font-variant-numeric: tabular-nums; white-space: nowrap; }
    .tk-text { color: var(--sc-fg-1); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .source { margin: 0; font-size: max(0.66rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }

    @media (max-width: 480px) {
      .comp { grid-template-columns: 6.5rem 1fr 2.5rem; }
      .ticket { grid-template-columns: auto 1fr; }
      .tk-text { grid-column: 1 / -1; white-space: normal; }
    }
  `],
})
export class StabilityPanelComponent {
  private readonly t = inject(TranslateService);

  readonly verdict = input<StabilityVerdict | null>(null);
  /** CIG's own fix count from the notes (display only). */
  readonly cigFixes = input<number | null>(null);
  readonly cigFixesIc = input<number | null>(null);

  readonly compKeys = COMP_KEYS;
  readonly threshold = EARLY_DAYS;
  readonly issueUrl = ISSUE_URL;

  readonly day = computed(() => Math.max(1, Math.ceil(this.verdict()?.daysLive ?? 0)));

  pct(v: number | null): number {
    return v === null ? 0 : Math.round(Math.min(1, Math.max(0, v)) * 100);
  }

  isEarlyDay(v: StabilityVerdict, d: StabilityDay): boolean {
    return (Date.parse(d.date + 'T00:00:00Z') - Date.parse(v.liveAt)) / 86_400_000 < EARLY_DAYS;
  }

  dayTitle(d: StabilityDay): string {
    return this.t.instant('news.patch.stability.dayTitle', {
      date: d.date,
      level: this.t.instant(`news.patch.stability.level.${d.level}`),
      score: this.pct(d.score),
      velocity: Math.round(d.velocity),
    });
  }

  hotfixTitle(d: StabilityDay): string {
    return d.hotfixes.map((h) => this.t.instant('news.patch.stability.hotfixMark', { build: h.build || '—', date: h.date })).join(' · ');
  }
}
```

- [ ] **Step 4: Add the `verdict` input to the detail and render the panel**

In `src/app/news/patch-note-detail.component.ts`:

Imports — add:
```ts
import { StabilityVerdict } from './patch-stability';
import { PatchStabilityService } from './patch-stability.service';
import { StabilityPanelComponent } from './stability-panel.component';
```
`imports:` — add `StabilityPanelComponent`.

Template — as the FIRST child inside `<div class="pn">`:
```html
      @if (verdict(); as v) {
        <sc-stability-panel [verdict]="v" [cigFixes]="cigFixes()" [cigFixesIc]="cigFixesIc()" />
      }
```

Class — add after `readonly tokens = input<readonly string[]>([]);`:
```ts
  /** The line's stability verdict; null for PTU/hotfix rows (no panel). */
  readonly verdict = input<StabilityVerdict | null>(null);

  private readonly stability = inject(PatchStabilityService);
  private readonly patchRow = computed(() => {
    const v = this.verdict();
    return v ? this.stability.patchRowFor(v.line) : null;
  });
  readonly cigFixes = computed(() => this.patchRow()?.cig_fixes ?? null);
  readonly cigFixesIc = computed(() => this.patchRow()?.cig_fixes_ic ?? null);
```

And in `src/app/news/patch-stability.service.ts` add the accessor the detail needs (below `verdictFor`):
```ts
  patchRowFor(line: string): StabilityPatchRow | null {
    return this.patches().find((p) => p.patch_line === line) ?? null;
  }
```

- [ ] **Step 5: Run the panel test, then typecheck**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='src/app/news/stability-panel.component.spec.ts' && npm run typecheck`
Expected: PASS, typecheck clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/news/stability-panel.component.ts src/app/news/stability-panel.component.spec.ts src/app/news/patch-note-detail.component.ts src/app/news/patch-stability.service.ts
git commit -m "feat(news): stability panel inside the expanded LIVE note

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: All-time history + section wiring

**Files:**
- Create: `src/app/news/stability-history.component.ts`
- Modify: `src/app/news/patch-notes-section.component.ts`
- Test: `src/app/news/stability-history.component.spec.ts`

**Interfaces:**
- Consumes: `StabilityVerdict` (Task 1), `PatchStabilityService.allTime`/`load`/`unavailable` (Task 6), `PatchNotesSectionComponent.focusLine(line: string)` (exists, used by the roadmap band).
- Produces: `<sc-stability-history [verdicts] (showLine)>`.

- [ ] **Step 1: Write the failing test**

```ts
// src/app/news/stability-history.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { StabilityHistoryComponent } from './stability-history.component';
import { StabilityVerdict } from './patch-stability';

function v(line: string, level: 1 | 2 | 3 | 4 | 5 | null, early = false): StabilityVerdict {
  return {
    line, liveAt: '2026-01-01T00:00:00Z', daysLive: 30, level, score: level === null ? null : level / 5,
    components: { community: 0, service: 0, cig: null }, early, insufficient: level === null, historical: true,
    days: [], tickets: [], kbOpen: null, hotfixes: [],
  };
}

describe('StabilityHistoryComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [StabilityHistoryComponent, TranslateModule.forRoot()] }));

  it('one button column per verdict, hatched when early, emits the line on click', () => {
    const f = TestBed.createComponent(StabilityHistoryComponent);
    f.componentRef.setInput('verdicts', [v('4.8', 4), v('4.9', 2), v('4.10', 3, true)]);
    const emitted: string[] = [];
    f.componentInstance.showLine.subscribe((l) => emitted.push(l));
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const cols = el.querySelectorAll('button.col');
    expect(cols.length).toBe(3);
    expect(cols[2].classList.contains('early')).toBeTrue();
    (cols[0] as HTMLButtonElement).click();
    expect(emitted).toEqual(['4.8']);
  });

  it('renders nothing with fewer than two verdicts', () => {
    const f = TestBed.createComponent(StabilityHistoryComponent);
    f.componentRef.setInput('verdicts', [v('4.10', 3)]);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.chart')).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx ng test --watch=false --browsers=ChromeHeadless --include='src/app/news/stability-history.component.spec.ts'`
Expected: module not found.

- [ ] **Step 3: Implement the history**

```ts
// src/app/news/stability-history.component.ts
import { ChangeDetectionStrategy, Component, computed, inject, input, output } from '@angular/core';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { StabilityVerdict } from './patch-stability';

/**
 * All-time comparison: one column per LIVE line, height = score, colour =
 * level, the newest line hatched while early. A column is a BUTTON because
 * clicking it expands that line on this page (an action), not a navigation.
 * Hidden below two columns — a bar chart of one bar compares nothing.
 */
@Component({
  selector: 'sc-stability-history',
  standalone: true,
  imports: [TranslateModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (shown().length >= 2) {
      <section class="sh" [attr.aria-label]="'news.patch.stability.history.title' | translate">
        <div class="head">
          <h4>{{ 'news.patch.stability.history.title' | translate }}</h4>
          <span class="hint">{{ 'news.patch.stability.history.hint' | translate }}</span>
        </div>
        <div class="chart">
          @for (v of shown(); track v.line) {
            <button type="button" class="col" [class.early]="v.early" [class.none]="v.level === null"
                    [attr.data-level]="v.level ?? 0" [attr.aria-label]="colAria(v)" [attr.title]="colAria(v)"
                    (click)="showLine.emit(v.line)">
              <span class="col-bar" [style.height.%]="v.level === null ? 8 : pct(v.score)"></span>
              <span class="col-label">{{ v.line }}</span>
            </button>
          }
        </div>
      </section>
    }
  `,
  styles: [`
    :host { display: block; }
    .sh { display: flex; flex-direction: column; gap: 6px; padding: 10px 12px; border: 1px solid color-mix(in srgb, var(--sc-border) 70%, transparent); border-radius: 8px; }
    .head { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
    h4 { margin: 0; font-size: max(0.8rem, var(--sc-fs-floor)); font-family: var(--sc-font-display); color: var(--sc-fg-0); }
    .hint { font-size: max(0.68rem, var(--sc-fs-floor)); color: var(--sc-fg-2); }
    .chart { display: flex; align-items: flex-end; gap: 4px; height: 110px; padding: 0 2px; border-bottom: 1px solid var(--sc-border); overflow-x: auto; }
    .col {
      flex: 1 1 0; min-width: 28px; max-width: 56px; height: 100%;
      display: flex; flex-direction: column; justify-content: flex-end; align-items: stretch; gap: 3px;
      padding: 0; background: transparent; border: 0; cursor: pointer; color: var(--sc-fg-2); font-family: inherit;
    }
    .col:hover .col-bar { filter: brightness(1.15); }
    .col:focus-visible { outline: 2px solid var(--sc-accent); outline-offset: 2px; border-radius: 4px; }
    .col-bar { width: 100%; border-radius: 2px 2px 0 0; background: var(--level, var(--sc-fg-2)); transition: height 0.3s ease; }
    .col.none .col-bar { background: color-mix(in srgb, var(--sc-fg-2) 25%, transparent); }
    .col.early .col-bar { background: repeating-linear-gradient(135deg, var(--level) 0 2px, transparent 2px 5px); outline: 1px dashed color-mix(in srgb, var(--level) 70%, transparent); }
    .col-label { font-size: max(0.62rem, var(--sc-fs-floor)); text-align: center; white-space: nowrap; }
    [data-level='1'] { --level: var(--sc-success); }
    [data-level='2'] { --level: var(--sc-accent); }
    [data-level='3'] { --level: var(--sc-warning); }
    [data-level='4'] { --level: var(--sc-warn); }
    [data-level='5'] { --level: var(--sc-danger); }
  `],
})
export class StabilityHistoryComponent {
  private readonly t = inject(TranslateService);

  /** Oldest first, as the service delivers them. */
  readonly verdicts = input<readonly StabilityVerdict[]>([]);
  readonly showLine = output<string>();

  /** Lines that have any verdict OR are the newest (which may still be insufficient). */
  readonly shown = computed(() => {
    const all = this.verdicts();
    return all.filter((v, i) => v.level !== null || i === all.length - 1);
  });

  pct(score: number | null): number {
    return score === null ? 0 : Math.round(Math.min(1, Math.max(0, score)) * 100);
  }

  colAria(v: StabilityVerdict): string {
    const level = v.level === null
      ? this.t.instant('news.patch.stability.history.noData')
      : this.t.instant(`news.patch.stability.level.${v.level}`);
    return this.t.instant('news.patch.stability.history.colAria', { version: v.line, level });
  }
}
```

- [ ] **Step 4: Wire it into the section**

In `src/app/news/patch-notes-section.component.ts`:

Imports — add:
```ts
import { PatchStabilityService } from './patch-stability.service';
import { StabilityHistoryComponent } from './stability-history.component';
```
`imports:` — add `StabilityHistoryComponent`.

Template — directly after `<sc-patch-cadence [groups]="svc.patchLines()" />`:
```html
      <!-- All-time stability, one column per LIVE line. Fed by the sampler's
           tables; hides itself when they are unreachable or hold < 2 lines. -->
      @if (!stability.unavailable()) {
        <sc-stability-history [verdicts]="stability.allTime()" (showLine)="focusLine($event)" />
      }
```

Class — after `readonly roadmap = inject(RoadmapService);`:
```ts
  readonly stability = inject(PatchStabilityService);
```
and after the `loadRoadmapOnce` effect:
```ts
  /** Same shape as the roadmap: the section is what renders the verdicts, so it asks for them. */
  private readonly loadStabilityOnce = effect(() => {
    void this.stability.load();
  });
```

- [ ] **Step 5: Run the history test, then the full gates**

Run:
```bash
npx ng test --watch=false --browsers=ChromeHeadless --include='src/app/news/stability-history.component.spec.ts'
npm run typecheck
npm run build
npm test
```
Expected: all green. `npm run build` is the only gate that compiles the templates (memory `sc-typecheck-misses-templates`). If `prebuild` dirties the release-notes file, discard it (`git checkout -- <file>`), never commit it.

- [ ] **Step 6: Commit**

```bash
git add src/app/news/stability-history.component.ts src/app/news/stability-history.component.spec.ts src/app/news/patch-notes-section.component.ts
git commit -m "feat(news): all-time stability history on the patch board

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 11: Deep-knowledge docs + browser verification

**Files:**
- Create: `.claude/deep-knowledge/patch-stability.md`
- Modify: `.claude/deep-knowledge/verse-news-sources.md` (append a pointer under "Secondary: RSI status")
- Modify: `CLAUDE.md` (Deep Knowledge list — add one line)

- [ ] **Step 1: Write `.claude/deep-knowledge/patch-stability.md`**

```markdown
# Patch Stability Indicator — sources, quirks, formula location

Spec: `docs/superpowers/specs/2026-09-05-patch-stability-indicator-design.md`.
Sampler: `supabase/functions/patch-stability-sample/` (daily via pg_cron, migration `20260906130000`).
Formula: `src/app/news/patch-stability.ts` — the ONLY place. The DB stores raw numbers.

## Sources (all public, verified 2026-09-05)

- **Spectrum forum 190048**: every LIVE patch has a `… LIVE Release Notes` thread and a
  `… LIVE - Hotfix Central …` thread. `POST /api/spectrum/forum/thread/nested` returns the
  first post (Draft.js) plus the **25 top-voted replies** with `votes.count`; the `page`
  parameter is IGNORED (every page returns the same 25), `nested_replies_ids` lists all ids.
  Hotfix Central lists each hotfix as a `blockquote` beginning `►M.D.YYYY:`; STARC ids inline.
  Hotfix Central threads before 4.9 were locked (0 replies) → HF reply metrics comparable
  from 4.9 on only. The release notes carry "contains over N bug and crash fixes … M of which
  originated from the issue council" — **4.8 and 4.9 have the identical sentence** (copy-paste),
  so it is display-only, never scored.
- **RSI status**: `https://status.robertsspaceindustries.com/issues/index.json` → `{pages:{…}}`,
  entries with `is:'issue'`; skip the `0001-01-01` sentinel. `severity` ∈ maintenance / degraded /
  partial / major / major-outage; `createdAt` is `'YYYY-MM-DD HH:MM:SS +0000 UTC'`, `resolvedAt`
  is `'YYYY-MM-DD HH:MM:SS'` (UTC). History back to 2020. "Live Deployment" maintenance rows mark
  exact deploy times.
- **CIG Known Issues**: Zendesk Help Center API
  `https://support.robertsspaceindustries.com/api/v2/help_center/en-us/articles/360056254754.json`
  — ONE evergreen article retitled per patch; entries are anchored `h2/h3` (`id="h_…"`) under
  `h1` sections. Not backfillable: Wayback snapshots all return the stale 3.22 body.

## Dead ends (don't retry without new evidence)

- Issue Council: login + backer wall, SPA shell, no JSON, no mirrors.
- Reddit `.json`: 403 for server IPs since 2026-05-28; `new.rss` still 200 but titles only.
- Comm-Link "full notes" page: SPA shell; wiki API 404s for patch-note ids.
- RSI telemetry XHR: not found; KB article about it is 401.
- No LLM classification (costs money — user decision 2026-09-05). Keyword sentiment was
  tried and rejected: "thank you for the fix" counted as a complaint.

## Operating

- `curl "$SUPABASE_URL/functions/v1/patch-stability-sample?force=1"` → run now.
- `…?backfill=1` → (re)register every LIVE line with its end-state (idempotent).
- The board shows a chip only with ≥ 2 samples and ≥ 10 replies; "early" = < 14 live days.
```

- [ ] **Step 2: Pointer in `verse-news-sources.md`**

Append at the end of the "Secondary: RSI status" section:
```markdown
> The stability sampler reads the richer `issues/index.json` (severity, resolvedAt, full
> history) instead of the RSS — see `patch-stability.md`. Candidate for replacing the RSS
> parse here too.
```

- [ ] **Step 3: One line in `CLAUDE.md` under "Deep Knowledge"**

```markdown
- `.claude/deep-knowledge/patch-stability.md` — stability indicator sources (Spectrum replies, status JSON, CIG KB), API quirks, where the formula lives
```

- [ ] **Step 4: Browser verification with data**

The tables are empty until the function has run. Sequence at ship time (after the function is deployed by CI and the migration applied from the primary checkout):

Both operator paths (`?backfill=1`, `?force=1`) require the service-role
bearer token — get it from `supabase secrets` / the dashboard, never from the
repo:
```bash
curl -s "https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/patch-stability-sample?backfill=1" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
curl -s "https://hcnqhvzlavdycidqyaai.supabase.co/functions/v1/patch-stability-sample?force=1" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
```
Expected: `{"ok":true,"registered":N}` (N ≈ 20) then `{"ok":true,"lines":["4.10","4.9"]}`.

Then open `/news/patches` via `preview_start` (name from `.claude/launch.json`) and verify with `read_page`:
- the history block shows one column per line with 4.8 at level 4 and 4.9 at level 2 (calibration);
- the 4.10 LIVE row has NO chip yet (one sample → insufficient by the minimum-data rule); it appears after the second daily run. Do not lower the rule for the demo;
- expanding the 4.10 row shows the panel's "not enough data" state; expanding 4.9 shows the historical end-state headline.
Take a screenshot for the ship summary.

- [ ] **Step 5: Commit**

```bash
git add .claude/deep-knowledge/patch-stability.md .claude/deep-knowledge/verse-news-sources.md CLAUDE.md
git commit -m "docs: patch stability sources and operating notes

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Ship checklist (after all tasks)

1. `git fetch origin && git merge origin/main` — re-run all gates if main moved.
2. Migration prefixes still unique vs `origin/main` (Task 5 Step 2).
3. `/ship` → PR + merge via `ship_release`; CI deploys `patch-stability-sample`.
4. From the PRIMARY checkout: `npm run db:push` (both migrations; the cron one last).
5. Run the two `curl` calls from Task 11 Step 4; confirm rows in both tables.
6. Update the admin-feedback / shipped notes if this came from a feedback item.
