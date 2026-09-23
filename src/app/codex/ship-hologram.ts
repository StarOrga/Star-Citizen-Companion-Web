/**
 * Hologram look for a ship hull in `<model-viewer>`.
 *
 * The hull glb is geometry only: the data uploader strips every texture before
 * upload (`glb_materials.strip_to_geometry`), because the public bucket must
 * not serve CIG's texture art for "download by others" (RSI Fankit & Fandom
 * FAQ). What the viewer shows is the ship's shape in the site's accent colour,
 * the way RSI's own holoviewer does. Applied on every load, it also neutralises
 * any glb uploaded before that rule, so an old textured hull never renders as
 * such.
 */

/** The slice of model-viewer's scene-graph API this module touches. */
export interface HoloTextureSlot {
  setTexture(texture: null): void;
}

export interface HoloMaterial {
  name: string;
  pbrMetallicRoughness: {
    baseColorFactor: readonly number[];
    setBaseColorFactor(rgba: [number, number, number, number]): void;
    setMetallicFactor(value: number): void;
    setRoughnessFactor(value: number): void;
    baseColorTexture: HoloTextureSlot;
    metallicRoughnessTexture: HoloTextureSlot;
  };
  normalTexture: HoloTextureSlot;
  occlusionTexture: HoloTextureSlot;
  emissiveTexture: HoloTextureSlot;
  setEmissiveFactor(rgb: [number, number, number]): void;
  getAlphaMode(): string;
  setAlphaMode(mode: 'OPAQUE' | 'MASK' | 'BLEND'): void;
}

/** sRGB 0-255 triple. */
export type Rgb = readonly [number, number, number];

/** `--accent-primary` of the StarUI tokens, used when the token can't be read. */
export const HOLO_FALLBACK_ACCENT: Rgb = [82, 193, 230];

// Surfaces that are light sources in the game keep glowing in the hologram.
const GLOW_HINTS = ['glow', 'light', 'emissive', 'screen'];

/** glTF colour factors are linear; CSS colours are sRGB. */
function toLinear(channel: number): number {
  const c = Math.min(Math.max(channel, 0), 255) / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Parse an `r, g, b` custom property (`--accent-primary-rgb`); null if unusable. */
export function parseRgbToken(value: string | null | undefined): Rgb | null {
  const parts = (value ?? '').split(',').map((p) => Number(p.trim()));
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return null;
  return [parts[0], parts[1], parts[2]];
}

/**
 * Recolour every material as hologram and drop whatever textures it carries.
 *
 * A material an old export hid through alpha (a MASK proxy below the cutoff)
 * stays hidden: its alpha is kept and so is its alpha mode. Everything else
 * becomes opaque — without the texture's alpha, a MASK decal would otherwise
 * decide visibility from a stale factor.
 */
export function applyHologram(materials: readonly HoloMaterial[], accent: Rgb): void {
  const [r, g, b] = accent.map(toLinear);
  for (const m of materials) {
    const pbr = m.pbrMetallicRoughness;
    for (const slot of [
      pbr.baseColorTexture,
      pbr.metallicRoughnessTexture,
      m.normalTexture,
      m.occlusionTexture,
      m.emissiveTexture,
    ]) {
      slot.setTexture(null);
    }
    const alpha = pbr.baseColorFactor[3] ?? 1;
    const hidden = m.getAlphaMode() === 'MASK' && alpha < 0.5;
    if (!hidden) m.setAlphaMode('OPAQUE');
    const glow = GLOW_HINTS.some((h) => m.name.toLowerCase().includes(h));
    pbr.setBaseColorFactor([r * 0.2, g * 0.2, b * 0.2, hidden ? alpha : 1]);
    pbr.setMetallicFactor(0.5);
    pbr.setRoughnessFactor(0.35);
    // Low self-glow on the hull: the environment reflections carry the shape.
    const e = glow ? 0.9 : 0.08;
    m.setEmissiveFactor([r * e, g * e, b * e]);
  }
}
