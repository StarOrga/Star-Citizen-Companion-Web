/**
 * Which look the 3D hull viewers render (concept-hologram study, see
 * docs/concepts/holo-shader/README.md).
 *
 * - `a` "Concept Holo": translucent fill, Fresnel rim, crisp panel lines, a slow scan.
 * - `b` "Studio Clay": opaque cool blue-grey design-review model with fine lines.
 * - `c` "Blueprint": dark fill, bright technical lines, faint hatch.
 *
 * Pure module (no three.js) so the choice can be read anywhere without
 * pulling the renderer into a chunk.
 */
export type HoloVariant = 'a' | 'b' | 'c';

export const HOLO_VARIANTS: readonly HoloVariant[] = ['a', 'b', 'c'];

/** The look shipped by default; `?holo=a|b|c` overrides it for comparison. */
export const DEFAULT_HOLO_VARIANT: HoloVariant = 'a';

/** Read `?holo=` from a location search string; anything unknown falls back to the default. */
export function holoVariantFrom(search: string | null | undefined): HoloVariant {
  let raw: string | null = null;
  try {
    raw = new URLSearchParams(search ?? '').get('holo');
  } catch {
    raw = null;
  }
  const v = (raw ?? '').trim().toLowerCase();
  return (HOLO_VARIANTS as readonly string[]).includes(v) ? (v as HoloVariant) : DEFAULT_HOLO_VARIANT;
}

/** The variant for the current page (`location.search`), default outside a browser. */
export function currentHoloVariant(): HoloVariant {
  return holoVariantFrom(typeof location !== 'undefined' ? location.search : '');
}
