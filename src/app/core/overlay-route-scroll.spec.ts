import { Location, ViewportScroller } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { ApplicationRef, Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, Routes, provideRouter, withInMemoryScrolling } from '@angular/router';
import {
  OVERLAY_ROUTE_DATA,
  OverlayScrollState,
  keepsScroll,
  provideOverlayRouteScroll,
} from './overlay-route-scroll';
import { VERSE_ROUTES } from '../verse/verse.routes';

@Component({ selector: 'sc-test-page', template: '' })
class PageComponent {}

@Component({ selector: 'sc-test-root', imports: [RouterOutlet], template: '<router-outlet />' })
class RootComponent {}

const board = { path: 'board' };
const ROUTES: Routes = [
  {
    path: 'board',
    component: PageComponent,
    children: [{ path: ':line', component: PageComponent, data: { [OVERLAY_ROUTE_DATA]: true } }],
  },
  { path: 'other', component: PageComponent },
  { path: 'item/:id', component: PageComponent },
];

/** The router's Scroll event waits for a timeout / animation frame. */
const settle = () => new Promise<void>((r) => setTimeout(r, 40));

describe('keepsScroll', () => {
  const st = (overlay: boolean, params = '{}', route: unknown = board): OverlayScrollState => ({
    base: [{ route, params }],
    overlay,
  });

  it('keeps the page scroll when an overlay opens, closes or swaps over the same page', () => {
    expect(keepsScroll(st(false), st(true))).toBeTrue();
    expect(keepsScroll(st(true), st(false))).toBeTrue();
    expect(keepsScroll(st(true), st(true))).toBeTrue();
  });

  it('scrolls for every other navigation', () => {
    expect(keepsScroll(null, st(true))).toBeFalse();
    expect(keepsScroll(st(false), st(false))).toBeFalse();
    expect(keepsScroll(st(true), st(false, '{}', { path: 'other' }))).toBeFalse();
    expect(keepsScroll(st(false, '{"id":"1"}'), st(true, '{"id":"2"}'))).toBeFalse();
  });
});

describe('OverlayRouteScrollService (feedback #245)', () => {
  let router: Router;
  let location: Location;
  let toTop: jasmine.Spy;
  let host: HTMLElement;

  beforeEach(() => {
    const scroller = jasmine.createSpyObj<ViewportScroller>('ViewportScroller', [
      'scrollToPosition', 'getScrollPosition', 'scrollToAnchor', 'setHistoryScrollRestoration', 'setOffset',
    ]);
    scroller.getScrollPosition.and.returnValue([0, 1800]);
    TestBed.configureTestingModule({
      providers: [
        provideRouter(ROUTES, withInMemoryScrolling({ scrollPositionRestoration: 'disabled', anchorScrolling: 'enabled' })),
        provideLocationMocks(),
        { provide: ViewportScroller, useValue: scroller },
        provideOverlayRouteScroll(),
      ],
    });
    // The router starts its scroller on bootstrap, as in the app.
    host = document.createElement('sc-test-root');
    document.body.appendChild(host);
    TestBed.inject(ApplicationRef).bootstrap(RootComponent, host);
    router = TestBed.inject(Router);
    location = TestBed.inject(Location);
    toTop = scroller.scrollToPosition;
  });

  afterEach(() => host.remove());

  async function go(url: string): Promise<void> {
    await router.navigateByUrl(url);
    await settle();
  }

  it('opening and closing the overlay (link, Esc, close button) leaves the board where it was', async () => {
    await go('/board');
    toTop.calls.reset();
    await go('/board/4.10');
    await go('/board?q=ship');
    expect(toTop).not.toHaveBeenCalled();
  });

  it('browser back out of the overlay leaves the board where it was', async () => {
    await go('/board');
    await go('/board/4.10');
    toTop.calls.reset();
    location.back();
    await settle();
    expect(location.path()).toBe('/board');
    expect(toTop).not.toHaveBeenCalled();
  });

  it('any other navigation still lands at the top', async () => {
    await go('/board/4.10');
    toTop.calls.reset();
    await go('/other');
    expect(toTop).toHaveBeenCalledWith([0, 0]);
    toTop.calls.reset();
    location.back();
    await settle();
    expect(toTop).toHaveBeenCalledWith([0, 0], { behavior: 'instant' });
  });

  it('an anchor link stays with the router', async () => {
    await go('/other');
    toTop.calls.reset();
    await go('/item/1#specs');
    expect(toTop).not.toHaveBeenCalled();
  });
});

describe('VERSE_ROUTES', () => {
  it('marks the patch dossier as a routed overlay', () => {
    const patches = VERSE_ROUTES.find((r) => r.path === 'patches');
    expect(patches?.children?.[0].data?.[OVERLAY_ROUTE_DATA]).toBeTrue();
  });
});
