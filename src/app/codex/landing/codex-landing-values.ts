import { TranslateService } from '@ngx-translate/core';
import { formatNumber, humanizeClassName } from '../codex-format';
import { LandingCategory, LandingValue } from './codex-landing-data.types';

/** Callouts at the hologram (round 1 look): at most three, the rest goes to the bars pane. */
export const MAX_CALLOUTS = 3;

/** A point on the hologram, in % of the hologram box (0,0 = top left). */
export interface HoloAnchor {
  x: number;
  y: number;
}

/**
 * Where a ship value sits on the hull hologram. The hull turns in the viewer,
 * so an anchor names the hull ZONE the value lives in (upper armour, hull
 * centre, engine plane, cargo bay) — not a hardpoint. A value without a zone
 * (SCM speed, crew, mass) is no callout: it goes into the bars pane.
 */
export const SHIP_ANCHORS: Readonly<Record<string, HoloAnchor>> = {
  armorHp: { x: 38, y: 36 },
  'hull.hp': { x: 47, y: 50 },
  cargoScu: { x: 56, y: 58 },
  'flight.maxSpeed': { x: 30, y: 64 },
};

/**
 * Items without a 3D hull stand on the table as one icon silhouette: a value
 * of the item describes the whole object, so its three most telling values
 * anchor on the body of the icon (upper, middle, lower third).
 */
export const BODY_ANCHORS: readonly HoloAnchor[] = [
  { x: 38, y: 34 },
  { x: 36, y: 52 },
  { x: 39, y: 70 },
];

/** Anchor of a value, or null (= no callout). */
export function anchorFor(category: LandingCategory, key: string, index: number): HoloAnchor | null {
  if (category === 'ship') return SHIP_ANCHORS[key] ?? null;
  return BODY_ANCHORS[index] ?? null;
}

export interface CalloutValue {
  value: LandingValue;
  anchor: HoloAnchor;
}

/**
 * Splits the top values into callouts (with a known anchor, max
 * {@link MAX_CALLOUTS}, most telling first) and the rest for the bars pane.
 * The callouts come back ordered top to bottom by anchor height, so their
 * leader lines never cross.
 */
export function splitCallouts(
  category: LandingCategory,
  values: readonly LandingValue[],
): { callouts: CalloutValue[]; rest: LandingValue[] } {
  const callouts: CalloutValue[] = [];
  const rest: LandingValue[] = [];
  for (const v of values) {
    const anchor = callouts.length < MAX_CALLOUTS ? anchorFor(category, v.key, callouts.length) : null;
    if (anchor) callouts.push({ value: v, anchor });
    else rest.push(v);
  }
  callouts.sort((a, b) => a.anchor.y - b.anchor.y);
  return { callouts, rest };
}

/**
 * Label for a top value: `codex.landing.value.<key>` when translated, else the
 * humanised last path segment (non-ship categories emit generic payload keys).
 */
export function valueLabel(t: Pick<TranslateService, 'instant'>, key: string): string {
  const k = `codex.landing.value.${key}`;
  const out = t.instant(k);
  if (typeof out === 'string' && out !== k) return out;
  const last = key.split('.').pop() ?? key;
  return humanizeClassName(last.replace(/([a-z])([A-Z])/g, '$1 $2'));
}

export function valueText(v: Pick<LandingValue, 'value' | 'unit'>): string {
  const n = formatNumber(v.value);
  if (!v.unit) return n;
  return v.unit === 'scu' ? `${n} SCU` : v.unit === 'hp' ? `${n} HP` : `${n} ${v.unit}`;
}

/** How a value compares with its class, ready for the template. */
export interface ValueComparison {
  /** `delta` = "+12 % ggü. Klasse"; `avg` = neutral "Klasse Ø …"; `top` = best of its class. */
  kind: 'delta' | 'avg' | 'top';
  /** Signed, rounded percentage for `delta` (e.g. "+12", "−4"). */
  delta: string;
  /** Formatted class mean. */
  avg: string;
  /** The value is worse than its class: rendered in the warning token (never danger). */
  worse: boolean;
}

/** Comparison of a value with its class; null without class data. */
export function compareValue(v: LandingValue): ValueComparison | null {
  const avg = v.classAvg;
  if (avg === null || avg === undefined || !Number.isFinite(avg) || avg === 0) return null;
  const avgText = valueText({ value: avg, unit: v.unit });
  if (v.higherIsBetter === null || v.higherIsBetter === undefined) {
    return { kind: 'avg', delta: '', avg: avgText, worse: false };
  }
  const max = v.classMax;
  if (v.higherIsBetter && max !== null && max !== undefined && v.value >= max && v.value > avg) {
    return { kind: 'top', delta: '', avg: avgText, worse: false };
  }
  const pct = Math.round(((v.value - avg) / Math.abs(avg)) * 100);
  const worse = v.higherIsBetter ? pct < 0 : pct > 0;
  const delta = pct > 0 ? `+${pct}` : pct < 0 ? `−${Math.abs(pct)}` : '±0';
  return { kind: 'delta', delta, avg: avgText, worse };
}

/** Bar fill (value) and average tick, both in % of the class maximum; null without class data. */
export function barOf(v: LandingValue): { fill: number; avg: number | null } | null {
  const max = Math.max(v.classMax ?? 0, v.value);
  if (!(max > 0)) return null;
  const clamp = (n: number) => Math.max(2, Math.min(100, Math.round((n / max) * 100)));
  const avg = v.classAvg && v.classAvg > 0 ? clamp(v.classAvg) : null;
  if (avg === null && !v.classMax) return null;
  return { fill: clamp(v.value), avg };
}
