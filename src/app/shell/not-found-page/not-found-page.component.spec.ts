import { provideLocationMocks } from '@angular/common/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { NotFoundPageComponent } from './not-found-page.component';
import { knownTopLevel, suggestRoutes } from './suggest-routes';

const KNOWN = ['verse', 'codex', 'hq', 'apps', 'settings', 'social', 'admin', 'release-notes'];

describe('suggestRoutes', () => {
  it('offers a typo fix', () => {
    expect(suggestRoutes('/cedex/ships', KNOWN)).toEqual(['codex']);
  });

  it('maps retired aliases to their successor', () => {
    expect(suggestRoutes('/news/patches', KNOWN)[0]).toBe('verse');
    expect(suggestRoutes('/hangar', KNOWN)[0]).toBe('hq');
  });

  it('matches by prefix', () => {
    expect(suggestRoutes('/sett', KNOWN)).toEqual(['settings']);
  });

  it('offers at most two', () => {
    expect(suggestRoutes('/s', ['social', 'settings', 'starmap'], 2).length).toBeLessThanOrEqual(2);
  });

  it('offers nothing when nothing fits, and nothing for the bare root', () => {
    expect(suggestRoutes('/qwertzuiop', KNOWN)).toEqual([]);
    expect(suggestRoutes('/', KNOWN)).toEqual([]);
  });

  it('does not suggest the segment that was typed correctly', () => {
    expect(suggestRoutes('/codex/nope', KNOWN)).not.toContain('codex');
  });

  it('knownTopLevel drops wildcards, params and non-destinations', () => {
    expect(knownTopLevel(['**', 'login', ':id', 'codex/index', 'codex', 'hq'])).toEqual(['codex', 'hq']);
  });
});

describe('NotFoundPageComponent', () => {
  async function open(url: string) {
    TestBed.configureTestingModule({
      providers: [
        provideTranslateService(),
        provideLocationMocks(),
        provideRouter([
          { path: 'verse', children: [] },
          { path: 'codex', children: [] },
          { path: '**', component: NotFoundPageComponent },
        ]),
      ],
    });
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    harness.detectChanges();
    return harness.routeNativeElement as HTMLElement;
  }

  it('renders one h1, the typed address with the unknown segment marked, and the primary home link', async () => {
    const el = await open('/gibtsnicht/x');
    expect(el.querySelectorAll('h1').length).toBe(1);
    expect(el.querySelector('code.addr')?.textContent?.replace(/\s/g, '')).toBe('/gibtsnicht/x');
    expect(el.querySelector('code.addr mark')?.textContent).toBe('gibtsnicht');
    expect(el.querySelector('a.home')?.getAttribute('href')).toBe('/');
  });

  it('shows a real suggestion as an anchor', async () => {
    const el = await open('/cedex');
    const links = [...el.querySelectorAll('a.mean-a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/codex']);
  });

  it('hides the block when nothing fits', async () => {
    const el = await open('/qwertzuiop');
    expect(el.querySelector('.mean')).toBeNull();
  });

  it('has no search field', async () => {
    const el = await open('/qwertzuiop');
    expect(el.querySelector('input')).toBeNull();
  });
});
