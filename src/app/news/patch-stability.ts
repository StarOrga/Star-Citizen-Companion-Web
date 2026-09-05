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
  const raw = Number.isNaN(s.outageMinPerDay) ? 0 : s.outageMinPerDay;
  const capped = Math.min(Math.max(raw, 0), OUTAGE_CAP_MIN_PER_DAY);
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
