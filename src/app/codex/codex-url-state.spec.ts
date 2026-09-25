import { Component, inject } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideLocationMocks, SpyLocation } from '@angular/common/testing';
import { ActivatedRoute, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { mirrorQueryParams } from './codex-url-state';

@Component({ standalone: true, template: '' })
class ListHost {
  readonly route = inject(ActivatedRoute);
}

describe('mirrorQueryParams', () => {
  async function at(url: string) {
    TestBed.configureTestingModule({
      providers: [provideRouter([{ path: 'codex/fps', component: ListHost }]), provideLocationMocks()],
    });
    const harness = await RouterTestingHarness.create();
    const host = await harness.navigateByUrl(url, ListHost);
    return {
      router: TestBed.inject(Router),
      location: TestBed.inject(Location) as SpyLocation,
      route: host.route,
    };
  }

  it('rewrites its own keys, drops the null ones and keeps the rest (equipInto)', async () => {
    const { router, location, route } = await at('/codex/fps?cat=weapon&q=old&equipInto=s1');
    const navigate = spyOn(router, 'navigateByUrl').and.callThrough();

    mirrorQueryParams(router, route, location, { cat: 'armor', q: null, slot: 'Helmet' });

    expect(location.path()).toBe('/codex/fps?cat=armor&equipInto=s1&slot=Helmet');
    // An address-bar rewrite, not a navigation: no NavigationEnd, no page view,
    // no scroll to the top.
    expect(navigate).not.toHaveBeenCalled();
  });

  it('builds on the address bar, so a key an earlier call removed stays removed', async () => {
    // The router never hears of a replaceState: merging with ITS url would
    // bring `q=old` back on the next write.
    const { router, location, route } = await at('/codex/fps?cat=weapon&q=old&equipInto=s1');

    mirrorQueryParams(router, route, location, { q: null });
    mirrorQueryParams(router, route, location, { cat: 'armor' });

    expect(location.path()).toBe('/codex/fps?cat=armor&equipInto=s1');
  });

  it('keeps the history entry\'s state, so Back and Forward still line up', async () => {
    const { router, location, route } = await at('/codex/fps?cat=weapon');
    const before = location.getState();

    mirrorQueryParams(router, route, location, { cat: 'armor' });

    expect(location.getState()).toEqual(before);
  });

  it('writes nothing when the URL already says it', async () => {
    const { router, location, route } = await at('/codex/fps?cat=weapon');
    const changes = location.urlChanges.length;

    mirrorQueryParams(router, route, location, { cat: 'weapon', q: null });

    expect(location.urlChanges.length).toBe(changes);
  });
});
