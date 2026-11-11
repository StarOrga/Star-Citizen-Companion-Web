import { InjectionToken } from '@angular/core';

/**
 * The Verse hub builds in three steps instead of one long frame: the stage and
 * the hero first, then the doors and the beacons, then the hub columns below
 * the fold. On a menu hop the page's content starts rising in 160 ms after it
 * rendered (`sc-switch-in`), and a part that arrives later brings the same
 * animation along, so the steps do not show. `false` renders everything at once.
 */
export const VERSE_STAGED_BUILD = new InjectionToken<boolean>('VERSE_STAGED_BUILD', { factory: () => true });

/** Steps until the hub is complete. */
export const VERSE_BUILD_STEPS = 2;

/** A hidden tab draws no frames: the build goes on without waiting for one. */
export const AFTER_PAINT_FALLBACK_MS = 250;

/** News, Patches, Galerie: the hub reveals them one by one. */
export const HUB_COLUMNS = 3;
/** The longest the hub columns wait for an idle slot after the camera landed. */
export const HUB_IDLE_TIMEOUT_MS = 600;
/** The longest the hub columns wait for their images to decode before they show anyway. */
export const HUB_DECODE_CAP_MS = 800;

/** Runs `run` once the main thread is idle (at the latest after `timeout`); the result cancels it. */
export function whenIdle(run: () => void, timeout: number): () => void {
  if (typeof requestIdleCallback === 'function') {
    const id = requestIdleCallback(() => run(), { timeout });
    return () => cancelIdleCallback(id);
  }
  const id = setTimeout(run, 1);
  return () => clearTimeout(id);
}

/**
 * Decodes every image under `root` off the critical frames (`img.decode()`), resolving when all
 * are done or failed, at the latest after `capMs`: a slow image never holds the hub back for long.
 */
export function decodeImages(root: ParentNode, capMs: number): Promise<void> {
  // Lazy images stay lazy: one inside the browser's load margin decodes here, one far below the
  // fold keeps waiting for the scroll and only the cap ends the wait for it.
  const imgs = Array.from(root.querySelectorAll('img')).filter((i) => i.getAttribute('src'));
  if (!imgs.length) return Promise.resolve();
  const all = Promise.all(imgs.map((i) => typeof i.decode === 'function' ? i.decode().catch(() => undefined) : Promise.resolve())).then(() => undefined);
  return Promise.race([all, new Promise<void>((r) => setTimeout(r, capMs))]);
}

/** Runs `run` once after the next painted frame; the result cancels it. */
export function afterPaint(run: () => void): () => void {
  let done = false;
  let task: ReturnType<typeof setTimeout> | undefined;
  const fire = (): void => {
    if (done) return;
    done = true;
    cancelAnimationFrame(frame);
    clearTimeout(fallback);
    run();
  };
  // A frame callback runs before that frame paints; the task after it runs behind the paint.
  const frame = requestAnimationFrame(() => (task = setTimeout(fire)));
  const fallback = setTimeout(fire, AFTER_PAINT_FALLBACK_MS);
  return () => {
    done = true;
    cancelAnimationFrame(frame);
    clearTimeout(fallback);
    clearTimeout(task);
  };
}

/**
 * The hub's real height, remembered per window width (40 px buckets), so the placeholder that holds
 * the page while the hub is still on its way (`.hub-hold`) has the hub's height and the scrollbar
 * does not jump when the hub replaces it. The hub's height follows its own breakpoints and its
 * content, so a formula only estimates it (verse-briefing-planet.scss); the first visit at a width
 * uses that estimate, every later one the measured value. A per-viewer convenience in localStorage:
 * without storage the estimate stands.
 */
export const HUB_HEIGHT_KEY = 'sc.verse.hubHeight';
const HUB_HEIGHT_BUCKETS = 12;

function hubBucket(width: number): string {
  return String(Math.round(width / 40) * 40);
}

function readHubHeights(): Record<string, number> {
  try {
    const raw = localStorage.getItem(HUB_HEIGHT_KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return v && typeof v === 'object' ? (v as Record<string, number>) : {};
  } catch {
    return {};
  }
}

/** The hub height last measured at this window width, or null (then the CSS estimate holds). */
export function readHubHeight(width: number): number | null {
  const h = readHubHeights()[hubBucket(width)];
  return typeof h === 'number' && Number.isFinite(h) && h > 0 ? Math.round(h) : null;
}

/** Remembers the hub's height at this window width (the newest buckets win). */
export function rememberHubHeight(width: number, height: number): void {
  if (!(height > 0)) return;
  try {
    const all = readHubHeights();
    const key = hubBucket(width);
    delete all[key];
    all[key] = Math.round(height);
    const keys = Object.keys(all);
    for (const k of keys.slice(0, Math.max(0, keys.length - HUB_HEIGHT_BUCKETS))) delete all[k];
    localStorage.setItem(HUB_HEIGHT_KEY, JSON.stringify(all));
  } catch {
    /* no storage: the estimate stands next time */
  }
}
