import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, Router, UrlTree, convertToParamMap, provideRouter } from '@angular/router';
import { constellationsViewToRank } from './starmap/starmap.routes';
import { constellationsToStarmap } from './verse.routes';

describe('old "Meine Sternbilder" URLs lead to the rank page', () => {
  beforeEach(() => TestBed.configureTestingModule({ providers: [provideRouter([])] }));

  it('sends /verse/gallery/constellations to the rank page', () => {
    const out = TestBed.runInInjectionContext(() => constellationsToStarmap(null as never, null as never));
    expect(out instanceof UrlTree).toBe(true);
    expect(TestBed.inject(Router).serializeUrl(out as UrlTree)).toBe('/verse/explorer/rank');
  });

  it('sends ?view=constellations to the rank page and leaves the plain star map alone', () => {
    const snap = (q: Record<string, string>) => ({ queryParamMap: convertToParamMap(q) }) as ActivatedRouteSnapshot;
    const out = TestBed.runInInjectionContext(() => constellationsViewToRank(snap({ view: 'constellations' }), null as never));
    expect(TestBed.inject(Router).serializeUrl(out as UrlTree)).toBe('/verse/explorer/rank');
    expect(TestBed.runInInjectionContext(() => constellationsViewToRank(snap({}), null as never))).toBe(true);
  });
});
