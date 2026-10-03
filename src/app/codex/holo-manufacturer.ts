/**
 * Manufacturer accent of the concept hologram.
 *
 * The hologram body is the app accent for every ship; only the accents (rim
 * glow, component highlight, slot ring, leader line) take the manufacturer's
 * colour, so a Drake reads warm and an RSI cool without the stage turning
 * into a brand page. The values are evocative, not official brand colours —
 * no CIG asset is used. Every entry is lifted to a minimum luminance so it
 * stays readable as a glow on the dark stage.
 *
 * Pure module (no three.js): the colour resolves anywhere without pulling the
 * renderer into a chunk.
 */

/** sRGB 0-255 triple. */
export type Rgb = readonly [number, number, number];

/**
 * Manufacturer code (the class-name prefix: `DRAK_Cutlass_Black` → `DRAK`) →
 * accent. Codes as they appear in the game's class names.
 */
export const MANUFACTURER_ACCENTS: Readonly<Record<string, Rgb>> = {
  AEGS: [255, 122, 92], // Aegis Dynamics: coral
  ANVL: [126, 219, 120], // Anvil Aerospace: field green
  ARGO: [255, 210, 64], // Argo Astronautics: work yellow
  BANU: [230, 190, 90], // Banu: gold
  CNOU: [255, 140, 60], // Consolidated Outland: orange
  CRUS: [120, 200, 255], // Crusader Industries: sky blue
  DRAK: [255, 176, 46], // Drake Interplanetary: amber
  ESPR: [200, 140, 255], // Esperia: violet
  GAMA: [190, 160, 255], // Gatac Manufacture: lavender
  GRIN: [255, 196, 90], // Greycat Industrial: safety orange
  KRIG: [180, 230, 90], // Kruger Intergalactic: lime
  MISC: [64, 224, 196], // MISC: teal
  MRAI: [255, 110, 200], // Mirai: pink
  ORIG: [245, 214, 140], // Origin Jumpworks: champagne
  RSI: [96, 156, 255], // Roberts Space Industries: royal blue
  TMBL: [220, 170, 110], // Tumbril: sand
  VNCL: [255, 96, 96], // Vanduul: blood red
  XIAN: [150, 255, 220], // Aopoa: mint
  XNAA: [150, 255, 220], // Aopoa (alternate prefix)
};

/** Minimum relative luminance (0..1) an accent is lifted to: a glow, not a stain, on the dark stage. */
export const MIN_ACCENT_LUMINANCE = 0.3;

/** The manufacturer code of a class name (`AEGS_Gladius` → `AEGS`), upper case; null without a prefix. */
export function manufacturerCode(className: string | null | undefined): string | null {
  const m = /^([A-Za-z]{2,5})_/.exec((className ?? '').trim());
  return m ? m[1].toUpperCase() : null;
}

/** WCAG relative luminance of an sRGB triple (0..1). */
export function relativeLuminance(c: Rgb): number {
  const lin = (v: number) => {
    const s = Math.min(Math.max(v, 0), 255) / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
}

function mixWhite(c: Rgb, t: number): Rgb {
  return [
    Math.round(c[0] + (255 - c[0]) * t),
    Math.round(c[1] + (255 - c[1]) * t),
    Math.round(c[2] + (255 - c[2]) * t),
  ];
}

/** Mix `c` toward white until it reaches {@link MIN_ACCENT_LUMINANCE}; unchanged when already bright enough. */
export function readableAccent(c: Rgb): Rgb {
  if (relativeLuminance(c) >= MIN_ACCENT_LUMINANCE) return c;
  let lo = 0;
  let hi = 1;
  // Bisect the white mix: luminance grows monotonically with it.
  for (let i = 0; i < 16; i++) {
    const t = (lo + hi) / 2;
    if (relativeLuminance(mixWhite(c, t)) >= MIN_ACCENT_LUMINANCE) hi = t;
    else lo = t;
  }
  return mixWhite(c, hi);
}

/**
 * Accent for the hologram of `className`: the manufacturer's colour, else
 * `fallback` (the app accent) for an unknown or missing prefix.
 */
export function manufacturerAccent(className: string | null | undefined, fallback: Rgb): Rgb {
  const code = manufacturerCode(className);
  const hit = code ? MANUFACTURER_ACCENTS[code] : undefined;
  return readableAccent(hit ?? fallback);
}

/** `r, g, b` for a CSS custom property (`rgb(var(--x))` / `rgb(from …)`). */
export function rgbToken(c: Rgb): string {
  return `${c[0]}, ${c[1]}, ${c[2]}`;
}
