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
 * Where a ship value sits on the hull hologram when its real hardpoint is not
 * known ({@link SHIP_ANCHOR_PORTS} is tried first): the hull ZONE the value
 * lives in (upper armour, hull centre, engine plane, cargo bay). A value without a zone
 * (SCM speed, crew, mass) is no callout: it goes into the bars pane.
 */
export const SHIP_ANCHORS: Readonly<Record<string, HoloAnchor>> = {
  armorHp: { x: 38, y: 36 },
  'hull.hp': { x: 47, y: 50 },
  cargoScu: { x: 56, y: 58 },
  'flight.maxSpeed': { x: 30, y: 64 },
};

/**
 * Real hardpoints behind a ship value (concept 2026-11-01 cx-anchors): the
 * mount on the 3D model a callout's leader line ends at — the main thrusters
 * carry the top speed, the cargo grid the SCU, the armour item the armour HP.
 * Matched against the ship's raw port names (the same strings the glb's
 * locator nodes carry). A value without a pattern — or a ship whose model has
 * no such locator — keeps its hull zone from {@link SHIP_ANCHORS}.
 */
export const SHIP_ANCHOR_PORTS: Readonly<Record<string, RegExp>> = {
  'flight.maxSpeed': /(thruster|engine)[_-]?main|main[_-]?(thruster|engine)|hardpoint[_-]engine/i,
  cargoScu: /cargo[_-]?grid|cargogrid|hardpoint[_-]cargo/i,
  armorHp: /hardpoint[_-]armou?r/i,
};
/** Candidates kept per value — enough for a pair of mains plus spares. */
const MAX_ANCHOR_CANDIDATES = 6;

/**
 * Candidate raw port names per callout value of a ship, in payload order
 * (item ports, then default loadout, then the hardpoint transforms). Values
 * without a matching port are left out.
 */
export function shipAnchorPorts(payload: unknown): Record<string, string[]> {
  const p = (payload ?? {}) as {
    itemPorts?: readonly { portName?: string | null }[] | null;
    defaultLoadout?: readonly { itemPortName?: string | null }[] | null;
    hardpointTransforms?: Record<string, unknown> | null;
  };
  const names: string[] = [];
  const seen = new Set<string>();
  const add = (n: unknown) => {
    if (typeof n !== 'string' || !n || seen.has(n)) return;
    seen.add(n);
    names.push(n);
  };
  for (const port of Array.isArray(p.itemPorts) ? p.itemPorts : []) add(port?.portName);
  for (const e of Array.isArray(p.defaultLoadout) ? p.defaultLoadout : []) add(e?.itemPortName);
  if (p.hardpointTransforms && typeof p.hardpointTransforms === 'object') Object.keys(p.hardpointTransforms).forEach(add);
  const out: Record<string, string[]> = {};
  for (const [key, re] of Object.entries(SHIP_ANCHOR_PORTS)) {
    const hits = names.filter((n) => re.test(n)).slice(0, MAX_ANCHOR_CANDIDATES);
    if (hits.length) out[key] = hits;
  }
  return out;
}

/** Largest plausible coordinate (metres) of a hardpoint — a ship is not 10 km long. */
const MAX_ABS_COORD = 10_000;

/**
 * Where the candidate ports sit on the hull according to the codex data
 * (`hardpointTransforms`, else the port's own `position`), converted from
 * CryEngine model space (+X starboard, +Y nose, +Z up) to the glb's Y-up
 * space: (x, y, z) -> (x, z, -y) — see glb-hardpoints.ts. The viewer uses
 * these when the glb itself carries no locator nodes (the texture-free hulls
 * do not). A port without a finite, plausible position is left out.
 */
export function shipAnchorPositions(
  payload: unknown,
  ports: Readonly<Record<string, readonly string[]>>,
): Record<string, [number, number, number]> {
  const p = (payload ?? {}) as {
    itemPorts?: readonly { portName?: string | null; position?: unknown }[] | null;
    hardpointTransforms?: Record<string, { position?: unknown } | null> | null;
  };
  const wanted = new Set(Object.values(ports).flat());
  const read = (v: unknown): [number, number, number] | null => {
    if (!Array.isArray(v) || v.length !== 3) return null;
    if (!v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= MAX_ABS_COORD)) return null;
    const [x, y, z] = v as number[];
    return [x, z, y === 0 ? 0 : -y];
  };
  const out: Record<string, [number, number, number]> = {};
  const transforms = p.hardpointTransforms && typeof p.hardpointTransforms === 'object' ? p.hardpointTransforms : {};
  for (const name of wanted) {
    const hit = read(transforms[name]?.position);
    if (hit) out[name] = hit;
  }
  for (const port of Array.isArray(p.itemPorts) ? p.itemPorts : []) {
    const name = port?.portName;
    if (!name || !wanted.has(name) || out[name]) continue;
    const hit = read(port.position);
    if (hit) out[name] = hit;
  }
  return out;
}

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
