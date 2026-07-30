import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { SameRouteRefreshService, normalizePath } from './same-route-refresh.service';

/**
 * Guards the "tap the active nav entry to reload" gesture (feedback 7532e639):
 * it must fire ONLY when the click really targets the route we are already on,
 * because a real navigation refreshes the view by itself.
 */
describe('SameRouteRefreshService', () => {
  let url: string;
  let service: SameRouteRefreshService;

  beforeEach(() => {
    url = '/news';
    TestBed.configureTestingModule({
      providers: [{ provide: Router, useValue: { get url() { return url; } } }],
    });
    service = TestBed.inject(SameRouteRefreshService);
  });

  it('notifies the subscriber of the route the user is on', () => {
    let hits = 0;
    service.onRefresh('/news').subscribe(() => hits++);

    expect(service.request('/news')).toBeTrue();
    expect(hits).toBe(1);
  });

  it('stays silent when the click leaves the current route', () => {
    let hits = 0;
    service.onRefresh('/news').subscribe(() => hits++);

    url = '/codex';
    expect(service.request('/news')).toBeFalse();
    expect(hits).toBe(0);
  });

  it('does not cross-notify other routes', () => {
    let hits = 0;
    service.onRefresh('/codex').subscribe(() => hits++);

    service.request('/news');
    expect(hits).toBe(0);
  });

  it('treats query params, fragments and trailing slashes as the same route', () => {
    let hits = 0;
    service.onRefresh('/news').subscribe(() => hits++);

    url = '/news?article=abc';
    expect(service.request('/news')).toBeTrue();

    url = '/news#top';
    expect(service.request('/news')).toBeTrue();

    url = '/news/';
    expect(service.request('/news')).toBeTrue();

    expect(hits).toBe(3);
  });

  it('normalizes paths to a leading-slash, no-trailing-slash form', () => {
    expect(normalizePath('news')).toBe('/news');
    expect(normalizePath('/news/')).toBe('/news');
    expect(normalizePath('/')).toBe('/');
    expect(normalizePath('/?a=1')).toBe('/');
  });
});
