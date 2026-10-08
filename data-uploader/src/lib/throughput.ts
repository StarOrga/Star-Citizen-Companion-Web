/**
 * Items/second over a rolling window that ends NOW, not at the last event.
 *
 * The progress card used to divide the counter delta by the time between its
 * first and last *event* in a 6 s window. Two failure modes followed:
 *  - a burst (a run of cache hits, a batch flushed at once) produced a high
 *    rate, and because the window was only trimmed on new events, a stall
 *    afterwards kept showing that burst rate — and an ETA built on it — forever;
 *  - between events the rate never decayed, so "~1.8/s" sat next to a counter
 *    that had not moved for a minute.
 * Measuring against `now` makes idle time count, and the longer window smooths
 * bursty work so the shown rate and the ETA agree with what the user sees.
 */

export interface ThroughputSample {
  t: number;
  current: number;
}

/** Window the shown rate and the ETA are averaged over. */
export const THROUGHPUT_WINDOW_MS = 60_000;
/** Below this much observed time there is no honest rate yet. */
export const THROUGHPUT_MIN_SPAN_MS = 5_000;

/**
 * Drop samples that can no longer be the window's base: keep exactly one
 * sample at or before `now - windowMs` so the window always starts at a real
 * observation.
 */
export function pruneSamples(samples: ThroughputSample[], now: number, windowMs = THROUGHPUT_WINDOW_MS): void {
  while (samples.length > 1 && samples[1].t <= now - windowMs) samples.shift();
}

/** Rate in items/s over the window ending at `now`, or null without a meaningful span or progress. */
export function throughput(
  samples: readonly ThroughputSample[],
  now: number,
  windowMs = THROUGHPUT_WINDOW_MS,
): number | null {
  if (samples.length < 2) return null;
  const last = samples[samples.length - 1];
  // The base is the newest sample at or before the window start; without one
  // (a young phase) the phase's first sample.
  let base = samples[0];
  for (const s of samples) {
    if (s.t <= now - windowMs) base = s;
    else break;
  }
  const span = now - base.t;
  const done = last.current - base.current;
  if (span < THROUGHPUT_MIN_SPAN_MS || done <= 0) return null;
  return (done / span) * 1000;
}
