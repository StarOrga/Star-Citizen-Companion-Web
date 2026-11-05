import manifest from '../../../../../../public/planet/bodies/manifest.json';
import { bodyMapWidth } from './body-engine';
import { PLANETS } from './body-gl';
import { BODY_MAP_DIR, bodyMapFile } from './body-maps';

/**
 * `node scripts/bake-body-maps.mjs --check` (prebuild) catches an SVG that was not
 * re-baked and compares every file with the raster while baking; this spec catches
 * a map or a width the page asks for that the bake does not have.
 */
describe('Verse bodies — baked maps', () => {
  const files = manifest.files as Record<string, { bytes: number }>;

  it('has every map of every body at every width the page can ask for', () => {
    const widths = new Set([bodyMapWidth(46, 1), bodyMapWidth(115, 1), bodyMapWidth(115, 2), bodyMapWidth(0, 1)]);
    expect([...widths].sort((a, b) => a - b)).toEqual(manifest.widths as (512 | 1024)[]);
    for (const spec of Object.values(PLANETS)) {
      for (const layer of Object.values(spec.layers)) {
        for (const w of widths) expect(files[bodyMapFile(layer, w)]).withContext(`${layer} at ${w}`).toBeDefined();
      }
    }
  });

  it('lives under the service worker\'s planet group', () => {
    expect(BODY_MAP_DIR.startsWith('planet/')).toBeTrue();
  });

  it('was rastered on a GPU: that is the picture browsers with one always showed', () => {
    expect(manifest.renderer).not.toMatch(/swiftshader|llvmpipe|basic render/i);
  });
});
