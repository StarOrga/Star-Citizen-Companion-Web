// Spec helpers for ship blueprints — imported by specs only.
import { signal } from '@angular/core';
import type { BlueprintLod, ShipBlueprint } from './ship-blueprint.model';
import { parseShipBlueprint } from './ship-blueprint.model';
import type { BlueprintUrls } from './ship-blueprint.service';

/**
 * A 10 m x 4 m hull in the generator's exact format: top view box 100 x 40 at
 * (10, 10), nose (-z) to the right — 10 drawing units per metre.
 */
export function blueprintSvg(lod: BlueprintLod = 'full', extra = ''): string {
  const top =
    `<g class="bp-view" data-view="top" data-projection='{"frame":"gltf-y-up-metres","m":[[0,0,-10,60],[10,0,0,30]],"box":[10,10,100,40]}'>` +
    '<path class="bp-hull" fill-rule="evenodd" stroke-width="2" d="M10 10l100 0 0 40 -100 0z"/>' +
    '<path class="bp-major" stroke-width="1.2" d="M40 20l40 0"/>' +
    (lod === 'full' ? '<path class="bp-minor" stroke-width="0.6" d="M20 30l10 0"/>' : '') +
    '</g>';
  const side =
    lod === 'full'
      ? `<g class="bp-view" data-view="side" data-projection='{"frame":"gltf-y-up-metres","m":[[0,0,-10,60],[0,-10,0,80]],"box":[10,70,100,20]}'>` +
        '<path class="bp-hull" fill-rule="evenodd" stroke-width="2" d="M10 70l100 0 0 20 -100 0z"/></g>'
      : '';
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 ${lod === 'full' ? 100 : 60}" data-sc-blueprint="1" ` +
    `data-lod="${lod}" data-extent-m="10.00 4.00 2.00" fill="none" stroke="currentColor">${top}${side}${extra}</svg>`
  );
}

export function blueprintFixture(lod: BlueprintLod = 'full'): ShipBlueprint {
  return parseShipBlueprint(blueprintSvg(lod))!;
}

/** A stand-in ShipBlueprintService: `set(shipId)` gives a ship drawings, reactive like the real index. */
export function fakeShipBlueprints() {
  const index = signal<ReadonlyMap<string, BlueprintUrls>>(new Map());
  const drawings: Record<BlueprintLod, ShipBlueprint> = { full: blueprintFixture('full'), icon: blueprintFixture('icon') };
  return {
    load: jasmine.createSpy('load').and.resolveTo(undefined),
    ready: () => true,
    urls: (shipId: string | null | undefined) => (shipId ? (index().get(shipId.toLowerCase()) ?? null) : null),
    drawing: jasmine
      .createSpy('drawing')
      .and.callFake((shipId: string, lod: BlueprintLod) =>
        Promise.resolve(index().get(shipId?.toLowerCase()) ? drawings[lod] : null),
      ),
    set(shipId: string): void {
      const next = new Map(index());
      next.set(shipId.toLowerCase(), { full: `https://r2.test/${shipId}.full.svg`, icon: `https://r2.test/${shipId}.icon.svg` });
      index.set(next);
    },
  };
}
