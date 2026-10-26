import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, UrlTree, provideRouter } from '@angular/router';
import { BetaService } from '../core/beta.service';
import { constellationsToStarmap } from './verse.routes';

describe('constellationsToStarmap (shell beta redirect)', () => {
  function run(shellOn: boolean): unknown {
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: BetaService, useValue: { isEnabled: () => signal(shellOn) } }],
    });
    return TestBed.runInInjectionContext(() => constellationsToStarmap(null as never, null as never));
  }

  it('sends the old route to the star map with the toggle on', () => {
    const out = run(true);
    expect(out instanceof UrlTree).toBeTrue();
    expect(TestBed.inject(Router).serializeUrl(out as UrlTree)).toBe('/verse/explorer?view=constellations');
  });

  it('keeps today\'s page with the beta off', () => {
    expect(run(false)).toBeTrue();
  });
});
