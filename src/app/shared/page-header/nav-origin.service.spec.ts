import { ChangeDetectionStrategy, Component } from '@angular/core';
import { Location, PlatformLocation } from '@angular/common';
import { MockPlatformLocation } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { NavOriginService, originCrumb } from './nav-origin.service';

@Component({ standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
class Blank {}

describe('NavOriginService', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: '**', component: Blank }]),
        { provide: PlatformLocation, useClass: MockPlatformLocation },
      ],
    });
  });

  it('keeps every query param a list mirrored into the url without a router navigation', async () => {
    const origin = TestBed.inject(NavOriginService);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/codex/index?kind=ship&v=1');
    // The Codex index writes its filters with Location.replaceState (mirrorQueryParams).
    TestBed.inject(Location).replaceState('/codex/index?kind=ship&v=1&mfr=AEG');
    await router.navigateByUrl('/codex/ship/AEGS_Avenger');
    expect(origin.previous()).toEqual({ path: '/codex/index', queryParams: { kind: 'ship', v: '1', mfr: 'AEG' } });
    const crumb = originCrumb(origin, null);
    expect(crumb?.link).toBe('/codex/index');
    expect(crumb?.queryParams).toEqual({ kind: 'ship', v: '1', mfr: 'AEG' });
  });

  it('does not let a url change on another path rewrite the last entry', async () => {
    const origin = TestBed.inject(NavOriginService);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/codex/index?kind=weapon');
    await router.navigateByUrl('/codex/fps');
    TestBed.inject(Location).replaceState('/codex/fps?q=p4');
    await router.navigateByUrl('/codex/item/X');
    expect(origin.previous()?.path).toBe('/codex/fps');
    expect(origin.previous()?.queryParams).toEqual({ q: 'p4' });
  });
});
