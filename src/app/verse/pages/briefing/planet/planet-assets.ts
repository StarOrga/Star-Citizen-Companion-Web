import { InjectionToken } from '@angular/core';
import { PlanetSources, loadBakedPlanet } from './planet-bake';

// The bake's loader and types live in planet-bake.ts, free of Angular, so the planet's
// worker can import them without pulling the framework into its bundle.
export { PLANET_ASSET_DIR, loadBakedPlanet, nightSize, worldFromBake } from './planet-bake';
export type { BakedWorld, PlanetNetwork, PlanetSources } from './planet-bake';

/** Loads the planet's sources for a night-texture size; rejects to make the page generate them. */
export type PlanetSourcesLoader = (size: 2048 | 4096) => Promise<PlanetSources>;

/**
 * The loader the live planet uses — the baked assets by default. A token so a
 * spec can answer deterministically: a real download settles outside
 * `fakeAsync`'s clock, so a spec that renders the stage provides a loader that
 * rejects, and the planet is generated in fake time as before.
 */
export const PLANET_SOURCES = new InjectionToken<PlanetSourcesLoader>('PLANET_SOURCES', {
  providedIn: 'root',
  factory: () => loadBakedPlanet,
});
