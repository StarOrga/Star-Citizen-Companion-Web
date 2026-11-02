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
  const sameType = ports.filter((p) => p.types.some((t) => norm(t) === type));
  if (sameType.length === 0) return { verdict: 'noFit', reasonKey: 'search.fit.noType', reasonParams: null };
  if (hit.size == null) return UNKNOWN;
  const size = hit.size;
  const ok = sameType.some((p) => (p.minSize == null || size >= p.minSize) && (p.maxSize == null || size <= p.maxSize));
  if (ok) return FITS;
  const sizes = sameType.flatMap((p) => [p.minSize, p.maxSize]).filter((n): n is number => n != null);
  return {
    verdict: 'noFit',
    reasonKey: 'search.fit.noSize',
    reasonParams: { size, min: sizes.length ? Math.min(...sizes) : size, max: sizes.length ? Math.max(...sizes) : size },
  };
}
