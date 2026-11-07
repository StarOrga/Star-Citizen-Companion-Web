// The officially announced next LIVE deployment (feedback #317).
//
// RSI publishes no release dates in its patch notes, but it does schedule the
// LIVE deployment on its status site ahead of time: the cState export at
// `status.robertsspaceindustries.com/issues/index.json` lists every issue, and a
// deployment that is announced in advance shows up as an issue titled
// "Live Deployment" whose `createdAt` lies in the future (the planned start of
// the maintenance window) and that is not resolved yet. That is the one
// first-party date we can read; everything else on the patch page is our own
// estimate. Pure so it runs under both Deno and `node --test`.

export interface ScheduledDeployment {
  /** Issue title as published, e.g. "Live Deployment". */
  title: string;
  /** Planned start of the deployment window (ISO, UTC). */
  at: string;
  /** The status-site page that announces it. */
  url: string;
}

interface IssueLike {
  title?: unknown;
  createdAt?: unknown;
  permalink?: unknown;
  resolved?: unknown;
  severity?: unknown;
}

/** cState's `2026-10-09 10:00:00 +0000 UTC` → epoch ms, NaN when malformed. */
export function parseCStateTime(raw: string): number {
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*(?:([+-]\d{2}):?(\d{2}))?/.exec(raw.trim());
  if (!m) return NaN;
  const offset = m[3] ? `${m[3]}:${m[4]}` : 'Z';
  return Date.parse(`${m[1]}T${m[2]}${offset}`);
}

/** A LIVE deployment — not a PTU/Evocati drop, not a platform/website window. */
function isLiveDeployment(title: string): boolean {
  if (/\b(ptu|evocati|tech[- ]?preview|preview)\b/i.test(title)) return false;
  return /\b(deploy(ment)?|release)\b/i.test(title);
}

/** How long an announced window that already started still counts as "the next one". */
const RUNNING_GRACE_MS = 12 * 60 * 60 * 1000;

/**
 * The earliest unresolved LIVE deployment that has not started more than
 * twelve hours ago — or null when RSI has announced none.
 */
export function pickScheduledDeployment(index: unknown, nowMs: number): ScheduledDeployment | null {
  const pages = (index as { pages?: unknown } | null)?.pages;
  if (!Array.isArray(pages)) return null;
  let best: { at: number; d: ScheduledDeployment } | null = null;
  for (const raw of pages as IssueLike[]) {
    if (!raw || typeof raw.title !== 'string' || typeof raw.createdAt !== 'string') continue;
    if (raw.resolved === true || !isLiveDeployment(raw.title)) continue;
    const at = parseCStateTime(raw.createdAt);
    if (!Number.isFinite(at) || at < nowMs - RUNNING_GRACE_MS) continue;
    if (best && best.at <= at) continue;
    const url = typeof raw.permalink === 'string' && raw.permalink.startsWith('https://status.robertsspaceindustries.com/')
      ? raw.permalink
      : 'https://status.robertsspaceindustries.com/';
    best = { at, d: { title: raw.title.trim(), at: new Date(at).toISOString(), url } };
  }
  return best?.d ?? null;
}
