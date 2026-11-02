// "Passt auf X" — does a row fit the ship the page names? (line B5, data part)
// -----------------------------------------------------------------------------
// Pure. The ship's ports are loaded ONCE per chip (engine: `getDetail('ship')`),
// never per row; each row is then checked against them in memory, with the same
// rule the compatibility RPC uses (accepted attach types + size range).

import type { PolySearchHit } from '../codex-poly-search';

/** The accepted-types + size-range shape of one port (same as codex.service PortQuery). */
export interface FitPort {
  types: readonly string[];
  minSize: number | null;
  maxSize: number | null;
  /** Sub-ports of the mount seated here (a turret's gimbal seats, a gimbal's gun seat). */
  children?: readonly FitPort[];
  /** A mount whose sub-ports are not known: it may take more than its own type says. */
  opaque?: boolean;
}

/** Port types that are mounts for other things (their own type is never the weapon's). */
const CONTAINER_TYPE = /turret|mount|gimbal|rack|launcher/i;

/** The shape of a sub-port as the item payload lists it (`payload.itemPorts`). */
export interface FitItemPort {
  portName?: string | null;
  minSize?: number | null;
  maxSize?: number | null;
  types?: readonly string[] | null;
}

/** One entry of a stock loadout tree (`payload.defaultLoadout`). */
export interface FitLoadoutEntry {
  itemPortName?: string | null;
  entityClassName?: string | null;
  entries?: readonly FitLoadoutEntry[];
}

const MAX_DEPTH = 6;
const lower = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase();

/**
 * The ship's ports with the sub-ports of whatever its stock loadout seats on
 * them, recursively (turret → gimbal → gun seat). `itemPorts` returns the
 * sub-ports of an item class, or undefined when that item's data is unknown.
 * A mount-typed port that cannot be expanded is marked `opaque` — never read
 * as "takes nothing".
 */
export function buildFitPorts(
  ports: readonly (FitItemPort & { portName?: string | null })[],
  loadout: readonly FitLoadoutEntry[] | null | undefined,
  itemPorts: (className: string) => readonly FitItemPort[] | undefined,
  depth = 0,
): FitPort[] {
  const byName = new Map<string, FitLoadoutEntry>();
  for (const e of loadout ?? []) {
    const n = lower(e.itemPortName);
    if (n && !byName.has(n)) byName.set(n, e);
  }
  return ports.map((p): FitPort => {
    const base: FitPort = { types: p.types ?? [], minSize: p.minSize ?? null, maxSize: p.maxSize ?? null };
    const entry = byName.get(lower(p.portName));
    const cls = entry?.entityClassName?.trim();
    const subs = cls && depth < MAX_DEPTH ? itemPorts(cls) : undefined;
    if (subs?.length) return { ...base, children: buildFitPorts(subs, entry?.entries, itemPorts, depth + 1) };
    return base.types.some((t) => CONTAINER_TYPE.test(t)) ? { ...base, opaque: true } : base;
  });
}

function flatten(ports: readonly FitPort[], out: FitPort[] = []): FitPort[] {
  for (const p of ports) {
    out.push(p);
    if (p.children?.length) flatten(p.children, out);
  }
  return out;
}

export type FitVerdict = 'fits' | 'noFit' | 'unknown';

/** ✓ passt / ⚠ passt nicht + reason / ? unbekannt — a badge, not a CTA. */
export interface SearchFit {
  verdict: FitVerdict;
  /** i18n key of the reason (only for `noFit`). */
  reasonKey: string | null;
  reasonParams: Record<string, string | number> | null;
}

const UNKNOWN: SearchFit = { verdict: 'unknown', reasonKey: null, reasonParams: null };
const FITS: SearchFit = { verdict: 'fits', reasonKey: null, reasonParams: null };

/** Kinds that mount on a port. */
const MOUNTABLE = new Set(['weapon', 'component', 'item']);

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * The verdict for one hit against a ship's ports.
 *  - not mountable / no attach type / no ports → unknown
 *  - some port takes the type and the size → fits
 *  - ports take the type, but not the size → noFit (reason: size)
 *  - no port takes the type → noFit (reason: type)
 */
export function fitVerdict(hit: Pick<PolySearchHit, 'kind' | 'attachType' | 'size'>, ports: readonly FitPort[] | null): SearchFit {
  if (!ports?.length || !MOUNTABLE.has(hit.kind) || !hit.attachType) return UNKNOWN;
  const type = norm(hit.attachType);
  // Every level counts: a weapon fits the gun seat inside a turret's gimbal, not the turret itself.
  const all = flatten(ports);
  const hidden = all.some((p) => p.opaque);
  const sameType = all.filter((p) => p.types.some((t) => norm(t) === type));
  if (sameType.length === 0) return hidden ? UNKNOWN : { verdict: 'noFit', reasonKey: 'search.fit.noType', reasonParams: null };
  if (hit.size == null) return UNKNOWN;
  const size = hit.size;
  const ok = sameType.some((p) => (p.minSize == null || size >= p.minSize) && (p.maxSize == null || size <= p.maxSize));
  if (ok) return FITS;
  if (hidden) return UNKNOWN; // an unexpanded mount might take it — never a false warning
  const sizes = sameType.flatMap((p) => [p.minSize, p.maxSize]).filter((n): n is number => n != null);
  return {
    verdict: 'noFit',
    reasonKey: 'search.fit.noSize',
    reasonParams: { size, min: sizes.length ? Math.min(...sizes) : size, max: sizes.length ? Math.max(...sizes) : size },
  };
}
