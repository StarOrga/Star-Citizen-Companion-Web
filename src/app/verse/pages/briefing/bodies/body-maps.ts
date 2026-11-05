/**
 * The bodies' maps as baked files (scripts/bake-body-maps.mjs → public/planet/bodies/):
 * the SVG's raster as lossless WebP, so it decodes off the main thread instead of
 * running the SVG filters on it. Free of the DOM: the worker loads these itself.
 */

/** Where the bake lives, relative to the document base (`<base href="/">`). */
export const BODY_MAP_DIR = 'planet/bodies/';

export const bodyMapFile = (name: string, width: number): string => `${name}-${width}.webp`;

/**
 * A baked map, byte for byte what reaches the GPU from the raster: straight alpha,
 * no colour conversion. Rejects on any failure (an old tab's dead URL answers HTML);
 * the caller then rasterises the SVG.
 */
export async function loadBakedMap(name: string, width: number, base: string): Promise<ImageBitmap> {
  const res = await fetch(new URL(BODY_MAP_DIR + bodyMapFile(name, width), base).href);
  if (!res.ok) throw new Error(`body map ${name} answered ${res.status}`);
  return createImageBitmap(await res.blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}
