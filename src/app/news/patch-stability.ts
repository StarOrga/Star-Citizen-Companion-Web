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
 *
 * READING DIRECTION (owner, 2026-09-05): every component above measures BAD
 * NEWS, so a high number used to mean a rough patch — and a chart whose tall
 * bars are the broken patches reads backwards to everyone who did not build
 * it. The stored numbers keep their meaning (`score` is the penalty), but the
 * UI-facing figure is `stability = 1 − score`: **every patch starts at 100 %
 * and only bad news subtracts.** Colour follows a traffic light rather than a
 * five-step ramp, so the verdict lands before the label is read.
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
  /** The PENALTY, 0…1 — internal. Everything user-facing reads `stability`. */
  score: number | null;
  /** 100 = nothing went wrong; bad news subtracts. Null when `insufficient`. */
  stability: number | null;
  /** Traffic light for `level`. Null when `insufficient`. */
  tone: StabilityTone | null;
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
  /** Spectrum replies (release notes + hotfix thread) of the newest sample; null on an end-state. */
  replies?: number | null;
  /** Spectrum threads behind `replies`. */
  threads?: number;
  /** Unplanned degraded minutes of the last 7 days per RSI Status; null on an end-state. */
  outageMin7d?: number | null;
}

/** Below this many live days the verdict is provisional (hatched in the UI). */
export const EARLY_DAYS = 14;
/**
 * One sample is enough for a verdict. It used to be two, because the daily
 * velocity is a difference between consecutive samples — but the FIRST sample
 * already carries a velocity (replies over the days since LIVE, the same
 * average the historical path uses), so demanding a second only meant a fresh
 * patch showed nothing on the day people look hardest. `early` already says
 * the reading is provisional.
 */
export const MIN_SAMPLES = 1;
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

/**
 * The traffic light. Five levels are the right granularity for a sentence
 * ("Leichte Turbulenzen") and the wrong one for a colour: nobody reads five
 * hues as a scale at a glance, and the two middle ones were indistinguishable
 * in the chart. Three states are a colour people already know.
 */
export type StabilityTone = 'green' | 'amber' | 'red';

export function toneOf(level: StabilityLevel): StabilityTone {
  if (level <= 2) return 'green';
  if (level === 3) return 'amber';
  return 'red';
}

/**
 * The number the UI shows: 100 = nothing went wrong, and every piece of bad
 * news takes percentage points off. Exactly the inverse of the stored penalty
 * score, rounded once here so a chart bar, a chip and a tooltip can never
 * print three different roundings of the same patch.
 */
export function stabilityPercent(score: number | null): number | null {
  if (score === null || !Number.isFinite(score)) return null;
  return Math.round((1 - Math.min(1, Math.max(0, score))) * 100);
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

/** Does the registry carry an end-state for this line at all? */
function hasEndState(patch: StabilityPatchRow): boolean {
  return patch.final_replies !== null
    || patch.final_ticket_share !== null
    || patch.final_ticket_vote_share !== null
    || patch.final_outage_min_per_day !== null;
}

/**
 * The verdict a line ended on, from the registry's `final_*` numbers.
 *
 * This is the right reading for every line that is no longer current — its
 * threads stopped moving when the next patch shipped, so today's reply count
 * divided by today's date is not what that patch felt like. Lines that predate
 * the sampler have nothing else; lines the sampler caught late (4.9: one
 * sample, taken ten days after 4.10 replaced it) used to fall into the daily
 * path and come back `insufficient` — a patch with a full end-state showing no
 * stability at all. Whichever way the data arrived, a superseded line reads its
 * end-state.
 */
function endStateVerdict(
  patch: StabilityPatchRow,
  base: { line: string; liveAt: string; daysLive: number; early: boolean },
): StabilityVerdict {
  const replies = patch.final_replies ?? 0;
  const components: StabilityComponents = {
    community: hasEndState(patch)
      ? communityScore({
          velocity: replies / Math.max(1, base.daysLive),
          ticketShare: patch.final_ticket_share ?? 0,
          ticketVoteShare: patch.final_ticket_vote_share ?? 0,
        })
      : null,
    service: patch.final_outage_min_per_day === null
      ? null
      : serviceScore({ outageMinPerDay: patch.final_outage_min_per_day, openIncident: false }),
    cig: null,
  };
  const score = combineScore(components);
  const insufficient = score === null || replies < MIN_REPLIES;
  const level = insufficient ? null : levelOf(score as number);
  return {
    ...base,
    level,
    score: insufficient ? null : score,
    stability: insufficient ? null : stabilityPercent(score),
    tone: level === null ? null : toneOf(level),
    components,
    insufficient,
    historical: true,
    days: [],
    tickets: [],
    kbOpen: null,
    hotfixes: [],
  };
}

/**
 * The whole verdict for one patch line.
 *
 * The CURRENT line reads its daily samples: a day series, the newest day's
 * level, and the early / minimum-data flags. Every SUPERSEDED line reads its
 * end-state (`final_*`), whether or not the sampler ever got a day out of it —
 * see `endStateVerdict`.
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

  const superseded = ctx.endAt !== null;
  if (samples.length === 0 || (superseded && hasEndState(patch))) return endStateVerdict(patch, base);

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
    stability: insufficient ? null : stabilityPercent(last.score),
    tone: insufficient ? null : toneOf(last.level),
    components: last.components,
    insufficient,
    historical: false,
    replies: totalReplies(latest),
    threads: latest.hf_replies === null ? 1 : 2,
    outageMin7d: latest.outage_min_7d,
    days,
    tickets: latest.top_tickets,
    kbOpen: latest.kb_open_total,
    hotfixes: latest.hotfix_events,
  };
}

export type DeductionKey = keyof StabilityComponents;

/**
 * The 100 − S points split over the three components, so the long form can show
 * "Startwert 100 − a − b − c = S". The score is 0.7·worst + 0.3·weighted mean, so
 * each component owns its share of the mean and the worst one additionally the
 * 0.7 term; the integer total (100 − stability) is spread by largest remainder.
 * Components without data stay null.
 */
export function componentDeductions(c: StabilityComponents, stability: number): Record<DeductionKey, number | null> {
  const keys = (Object.keys(WEIGHTS) as DeductionKey[]).filter((k) => c[k] !== null);
  const out: Record<DeductionKey, number | null> = { community: null, service: null, cig: null };
  if (keys.length === 0) return out;
  const weightSum = keys.reduce((s, k) => s + WEIGHTS[k], 0);
  const worstKey = keys.reduce((a, b) => ((c[b] as number) > (c[a] as number) ? b : a));
  const raw = keys.map((k) => 0.3 * (WEIGHTS[k] / weightSum) * (c[k] as number) + (k === worstKey ? 0.7 * (c[k] as number) : 0));
  const rawSum = raw.reduce((s, v) => s + v, 0);
  const total = Math.max(0, Math.round(100 - stability));
  const scaled = raw.map((v) => (rawSum > 0 ? (v / rawSum) * total : 0));
  const floor = scaled.map(Math.floor);
  let rest = total - floor.reduce((s, v) => s + v, 0);
  [...scaled.keys()].sort((a, b) => (scaled[b] - floor[b]) - (scaled[a] - floor[a])).forEach((i) => {
    if (rest > 0) { floor[i]++; rest--; }
  });
  keys.forEach((k, i) => (out[k] = floor[i]));
  return out;
}

/** Raw numbers of one Hotfix / PTU / Evocati build (Spectrum threads) for {@link channelStability}. */
export interface ChannelBuildSample {
  replies: number;
  ticketShare: number | null;
  ticketVoteShare: number | null;
  /** When the build's threads started and where its window closes (now for a running build). */
  fromIso: string | null;
  toIso: string;
}

/**
 * Stability of a test-channel build. Only the community component exists for
 * it — no unplanned-downtime window belongs to a PTU, and the CIG Known-Issues
 * article names LIVE patches only — so the score is `combineScore` over that
 * one component, read through the same `stabilityPercent` / `levelOf` as every
 * LIVE verdict. Null (shown as "–") without ticket data or below MIN_REPLIES.
 */
export function channelStability(b: ChannelBuildSample): { stability: number; level: StabilityLevel } | null {
  if (b.ticketShare === null || b.ticketVoteShare === null || b.fromIso === null) return null;
  if (!(b.replies >= MIN_REPLIES)) return null;
  const days = Math.max(1, daysBetween(b.fromIso, b.toIso));
  const score = combineScore({
    community: communityScore({ velocity: b.replies / days, ticketShare: b.ticketShare, ticketVoteShare: b.ticketVoteShare }),
    service: null,
    cig: null,
  });
  const stability = stabilityPercent(score);
  return score === null || stability === null ? null : { stability, level: levelOf(score) };
}

// ---------------------------------------------------------------------------
// The one three-word scale
// ---------------------------------------------------------------------------

export type StabilityWord = 'stabil' | 'wackelig' | 'instabil';

/** stabil ≥ 75 · wackelig 45–74 · instabil < 45 — the ONE scale, everywhere. */
export const STABIL_MIN = 75;
export const WACKELIG_MIN = 45;

/** Word for a percentage; null when there is no number. Fractions floor into the lower word (74.9 → wackelig). */
export function stabilityWord(percent: number | null): StabilityWord | null {
  if (percent === null || !Number.isFinite(percent)) return null;
  if (percent >= STABIL_MIN) return 'stabil';
  if (percent >= WACKELIG_MIN) return 'wackelig';
  return 'instabil';
}

// ---------------------------------------------------------------------------
// Trend indicator
// ---------------------------------------------------------------------------

/** Below this many points of difference the patches count as equal (≈). */
export const TREND_THRESHOLD = 3;

export type StabilityTrend = 'better' | 'worse' | 'same';

/** Glyph per trend: ▲ better, ▼ worse, ≈ equal. */
export const TREND_GLYPH: Readonly<Record<StabilityTrend, string>> = { better: '▲', worse: '▼', same: '≈' };

/** Current vs previous patch of the same channel/line; null when either number is missing. */
export function stabilityTrend(current: number | null, previous: number | null): StabilityTrend | null {
  if (current === null || previous === null || !Number.isFinite(current) || !Number.isFinite(previous)) return null;
  const delta = current - previous;
  if (Math.abs(delta) < TREND_THRESHOLD) return 'same';
  return delta > 0 ? 'better' : 'worse';
}

// ---------------------------------------------------------------------------
// Community verdict (spec: briefs/implement.md "Community-Urteil")
// ---------------------------------------------------------------------------

/** Band centres the three verdicts count as. */
export const VOTE_VALUE: Readonly<Record<StabilityWord, number>> = { stabil: 90, wackelig: 60, instabil: 20 };
/** Accounts younger than this weigh 0 (enforced by the RPC). */
export const VOTE_MIN_ACCOUNT_DAYS = 7;
/** Half-life of a vote's weight (RPC). */
export const VOTE_HALF_LIFE_DAYS = 7;
/** A vote can be changed at most this often (DB trigger). */
export const VOTE_CHANGE_HOURS = 12;
/** Below this effective sample size there is no correction. */
export const MIN_EFFECTIVE_VOTES = 25;
/** One-sided z of the interval (≈ 90 % two-sided). */
export const VOTE_Z = 1.65;
/** Weight of the computed stability against the votes in the posterior. */
export const VOTE_PRIOR_STRENGTH = 15;
/** No correction while S sits this close to the vote interval. */
export const VOTE_DEAD_BAND = 3;
/** Symmetric cap of the correction in points. */
export const VOTE_CORRECTION_CAP = 10;
/** Both extreme shares at or above this → the votes are split. */
export const VOTE_SPLIT_SHARE = 0.25;
/** Correction multiplier when split. */
export const VOTE_SPLIT_FACTOR = 0.5;

/** What `patch_stability_vote_state` returns, camelCased. */
export interface VoteAggregate {
  /** Weighted counts per verdict. */
  wStabil: number;
  wWackelig: number;
  wInstabil: number;
  /** Σw and Σw². */
  sumW: number;
  sumW2: number;
  /** Raw number of votes (unweighted, every account age). */
  votes: number;
  /** The caller's own vote; null when signed out or not voted. */
  ownVerdict: StabilityWord | null;
  /** ISO time the caller may change the vote again; null without a vote. */
  ownNextChangeAt: string | null;
}

export type CommunityState = 'too-few' | 'confirmed' | 'split' | 'applied';

export interface CommunityCorrection {
  state: CommunityState;
  /** Points added to S (rounded, 0 for too-few / confirmed). */
  correction: number;
  /** Effective sample size (Σw)² / Σw². */
  nEff: number;
  /** Weighted shares 0…1; all 0 when there is no weight. */
  shares: Readonly<Record<StabilityWord, number>>;
  /** Half-width of the interval around the vote mean, in points (0 when too few). */
  halfWidth: number;
  /** Raw vote count (for "N Stimmen"). */
  votes: number;
}

/**
 * The community correction for computed stability `S`. Stateless: recomputed
 * from all current votes every call. Output smoothing (α = 1 − e^(−Δt/24 h),
 * ≤ 2 pt/h) is NOT implemented — it needs a persisted previous value.
 */
export function communityCorrection(S: number, agg: VoteAggregate): CommunityCorrection {
  const sumW = Math.max(0, agg.sumW);
  const nEff = sumW > 0 && agg.sumW2 > 0 ? (sumW * sumW) / agg.sumW2 : 0;
  const shares: Record<StabilityWord, number> = sumW > 0
    ? { stabil: agg.wStabil / sumW, wackelig: agg.wWackelig / sumW, instabil: agg.wInstabil / sumW }
    : { stabil: 0, wackelig: 0, instabil: 0 };
  const base = { nEff, shares, votes: agg.votes };

  if (!(nEff >= MIN_EFFECTIVE_VOTES)) return { ...base, state: 'too-few', correction: 0, halfWidth: 0 };

  const mean = shares.stabil * VOTE_VALUE.stabil + shares.wackelig * VOTE_VALUE.wackelig + shares.instabil * VOTE_VALUE.instabil;
  const variance = shares.stabil * (VOTE_VALUE.stabil - mean) ** 2
    + shares.wackelig * (VOTE_VALUE.wackelig - mean) ** 2
    + shares.instabil * (VOTE_VALUE.instabil - mean) ** 2;
  const halfWidth = VOTE_Z * Math.sqrt(variance) / Math.sqrt(nEff);

  if (S >= mean - halfWidth - VOTE_DEAD_BAND && S <= mean + halfWidth + VOTE_DEAD_BAND) {
    return { ...base, state: 'confirmed', correction: 0, halfWidth };
  }

  const posterior = (nEff * mean + VOTE_PRIOR_STRENGTH * S) / (nEff + VOTE_PRIOR_STRENGTH);
  let target = Math.min(VOTE_CORRECTION_CAP, Math.max(-VOTE_CORRECTION_CAP, posterior - S));
  const split = shares.stabil >= VOTE_SPLIT_SHARE && shares.instabil >= VOTE_SPLIT_SHARE;
  if (split) target *= VOTE_SPLIT_FACTOR;
  return { ...base, state: split ? 'split' : 'applied', correction: Math.round(target) || 0, halfWidth };
}

/** The value the UI shows: S plus the correction, rounded and clamped to 0…100. The word follows this value. */
export function correctedStability(S: number, c: CommunityCorrection): number {
  return Math.min(100, Math.max(0, Math.round(S + c.correction)));
}
