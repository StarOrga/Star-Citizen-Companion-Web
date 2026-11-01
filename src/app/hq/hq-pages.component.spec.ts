import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Location } from '@angular/common';
import { provideLocationMocks } from '@angular/common/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AuthService } from '../auth/auth.service';
import { BetaService } from '../core/beta.service';
import { DesktopConnectionService } from '../desktop/desktop-connection.service';
import { HangarService } from '../hangar/hangar.service';
import { ShellChromeService } from '../shell/fusion-bar/shell-chrome.service';
import { HqLandingComponent } from './hq-landing.component';
import { HqOverviewComponent } from './hq-overview.component';
import { HqPagesComponent } from './hq-pages.component';
import { HQ_PAGES, hqPage, hqPageHref, hqPageOfFragment } from './hq-routes';

@Component({ selector: 'sc-hq-pages', standalone: true, template: 'pages' })
class PagesStub {}
@Component({ selector: 'sc-hq-overview', standalone: true, template: 'overview' })
class OverviewStub {}

function baseProviders(shell: boolean) {
  return [
    provideRouter([]),
    provideLocationMocks(),
    provideTranslateService({ fallbackLang: 'en' }),
    { provide: BetaService, useValue: { isEnabled: () => signal(shell) } },
    { provide: AuthService, useValue: { user: signal(null) } },
    { provide: HangarService, useValue: { ships: signal([]), roleLoadouts: signal([]), loadAll: () => Promise.resolve() } },
    { provide: DesktopConnectionService, useValue: { connections: signal([]), refresh: () => Promise.resolve() } },
  ];
}

describe('hq-routes page helpers', () => {
  it('lists the five pages in scroll order and builds anchors', () => {
    expect([...HQ_PAGES]).toEqual(['start', 'planen', 'jetzt', 'bestand', 'statistik']);
    expect(hqPageHref('start')).toBe('/hq');
    expect(hqPageHref('jetzt')).toBe('/hq#jetzt');
    expect(hqPage('planen')).toEqual({ commands: ['/hq'], fragment: 'planen' });
    expect(hqPage('start').fragment).toBeUndefined();
    expect(hqPageOfFragment('bestand')).toBe('bestand');
    expect(hqPageOfFragment('#statistik')).toBe('statistik');
    expect(hqPageOfFragment('nope')).toBeNull();
    expect(hqPageOfFragment(null)).toBeNull();
  });
});

describe('HqLandingComponent', () => {
  function mount(shell: boolean) {
    TestBed.configureTestingModule({ providers: baseProviders(shell) });
    TestBed.overrideComponent(HqLandingComponent, { set: { imports: [PagesStub, OverviewStub] } });
    const f = TestBed.createComponent(HqLandingComponent);
    f.detectChanges();
    return f.nativeElement as HTMLElement;
  }

  it('beta off: today\'s overview stays', () => {
    const el = mount(false);
    expect(el.querySelector('sc-hq-overview')).not.toBeNull();
    expect(el.querySelector('sc-hq-pages')).toBeNull();
  });

  it('beta on: the five-page landing', () => {
    const el = mount(true);
    expect(el.querySelector('sc-hq-pages')).not.toBeNull();
    expect(el.querySelector('sc-hq-overview')).toBeNull();
  });

  it('references the real overview component (kept unchanged)', () => {
    expect(HqOverviewComponent).toBeDefined();
  });
});

describe('HqPagesComponent', () => {
  function mount() {
    TestBed.configureTestingModule({ imports: [HqPagesComponent], providers: baseProviders(true) });
    const f = TestBed.createComponent(HqPagesComponent);
    (f.nativeElement as HTMLElement).setAttribute('data-layout', 'cinematic');
    f.detectChanges();
    return f;
  }

  it('renders five sections with the page ids and exactly one h1', () => {
    const el: HTMLElement = mount().nativeElement;
    const ids = Array.from(el.querySelectorAll('section.page')).map((s) => s.id);
    expect(ids).toEqual(['start', 'planen', 'jetzt', 'bestand', 'statistik']);
    expect(el.querySelectorAll('h1').length).toBe(1);
    expect(el.querySelector('sc-hq-plan')).not.toBeNull();
    expect(el.querySelector('sc-hq-now')).not.toBeNull();
    expect(el.querySelector('sc-hq-stock')).not.toBeNull();
    expect(el.querySelector('sc-hq-stats')).not.toBeNull();
  });

  it('publishes Start as the page in view and clears it on destroy', () => {
    const f = mount();
    const chrome = TestBed.inject(ShellChromeService);
    expect(chrome.hqPage()).toBe('start');
    f.destroy();
    expect(chrome.hqPage()).toBeNull();
  });

  it('the rail is five real anchors and marks the current page', () => {
    const f = mount();
    const links = Array.from((f.nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('sc-hq-rail a'));
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/hq', '/hq#planen', '/hq#jetzt', '/hq#bestand', '/hq#statistik']);
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual(['page', null, null, null, null]);
    TestBed.inject(ShellChromeService).setHqPage('jetzt');
    f.detectChanges();
    expect(links[2].getAttribute('aria-current')).toBe('page');
    expect(links[0].getAttribute('aria-current')).toBeNull();
  });

  it('a plain click scrolls and adds one history entry; a modified click is left to the browser', () => {
    const f = mount();
    const location = TestBed.inject(Location);
    const go = spyOn(location, 'go').and.callThrough();
    const link = (f.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('sc-hq-rail a[href="/hq#bestand"]')!;
    // A listener registered after the component's own sees whether it already took the click;
    // it then cancels the click so the browser never opens a real tab in the Karma page.
    let preventedByComponent: boolean | null = null;
    link.addEventListener('click', (e) => {
      preventedByComponent = e.defaultPrevented;
      e.preventDefault();
    }, { once: true });
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(preventedByComponent).toBeFalse();
    expect(go).not.toHaveBeenCalled();
    const plain = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(plain);
    expect(plain.defaultPrevented).toBeTrue();
    expect(go).toHaveBeenCalledTimes(1);
    expect(go.calls.mostRecent().args[0]).toContain('#bestand');
  });

  it('the cue leads to Planen as a real anchor', () => {
    const el: HTMLElement = mount().nativeElement;
    const cue = el.querySelector<HTMLAnchorElement>('sc-hq-cue a.more-cue')!;
    expect(cue.getAttribute('href')).toBe('/hq#planen');
  });

  it('every follow page takes the same column (the subheader width)', () => {
    const f = mount();
    const rects = ['planen', 'jetzt', 'bestand', 'statistik'].map((id) =>
      (f.nativeElement as HTMLElement).querySelector(`#${id}`)!.getBoundingClientRect(),
    );
    expect(new Set(rects.map((r) => Math.round(r.left))).size).toBe(1);
    expect(new Set(rects.map((r) => Math.round(r.width))).size).toBe(1);
  });

  it('the first-visit block is absent while nothing is loaded for a signed-out reader, and no feed means no patch lines or chips', () => {
    const el: HTMLElement = mount().nativeElement;
    expect(el.querySelector('sc-hq-first-visit')).toBeNull();
    expect(el.querySelector('.patch')).toBeNull();
    expect(el.querySelector('.chips')).toBeNull();
  });
});
