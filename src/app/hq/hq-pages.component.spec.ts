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
import { hotkeyPage } from './hq-page-scroll';
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
    expect([...HQ_PAGES]).toEqual(['start', 'inventar', 'jetzt', 'planen', 'statistik']);
    expect(hqPageHref('start')).toBe('/hq');
    expect(hqPageHref('jetzt')).toBe('/hq#jetzt');
    expect(hqPage('planen')).toEqual({ commands: ['/hq'], fragment: 'planen' });
    expect(hqPage('start').fragment).toBeUndefined();
    expect(hqPageOfFragment('inventar')).toBe('inventar');
    expect(hqPageOfFragment('#statistik')).toBe('statistik');
    expect(hqPageOfFragment('nope')).toBeNull();
    expect(hqPageOfFragment(null)).toBeNull();
  });

  it('keeps the old #bestand fragment working as an alias of the Inventar page', () => {
    expect(hqPageOfFragment('bestand')).toBe('inventar');
    expect(hqPageOfFragment('#bestand')).toBe('inventar');
    expect(hqPageHref('inventar')).toBe('/hq#inventar');
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
    expect(ids).toEqual(['start', 'inventar', 'jetzt', 'planen', 'statistik']);
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
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['/hq', '/hq#inventar', '/hq#jetzt', '/hq#planen', '/hq#statistik']);
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
    const link = (f.nativeElement as HTMLElement).querySelector<HTMLAnchorElement>('sc-hq-rail a[href="/hq#inventar"]')!;
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
    expect(go.calls.mostRecent().args[0]).toContain('#inventar');
  });

  it('the cue leads to Bestand, the page after Start, as a real anchor', () => {
    const el: HTMLElement = mount().nativeElement;
    const cue = el.querySelector<HTMLAnchorElement>('sc-hq-cue a.more-cue')!;
    expect(cue.getAttribute('href')).toBe('/hq#inventar');
  });

  it('a hotkey moves the rail and the cue along with the page', () => {
    const f = mount();
    TestBed.tick();
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: '3', bubbles: true, cancelable: true }));
    f.detectChanges();
    const el: HTMLElement = f.nativeElement;
    expect(el.querySelector('sc-hq-rail a[aria-current="page"]')?.getAttribute('href')).toBe('/hq#planen');
    expect(el.querySelector('sc-hq-cue a.more-cue')?.getAttribute('href')).toBe('/hq#statistik');
  });

  it('the cue stands back while the page in view runs on below the viewport', () => {
    const f = mount();
    TestBed.tick();
    const el: HTMLElement = f.nativeElement;
    const start = el.querySelector<HTMLElement>('[data-hq-page="start"]')!;
    const measure = (f.componentInstance as unknown as { measureCue(): void });
    const rect = spyOn(start, 'getBoundingClientRect').and.returnValue({ bottom: window.innerHeight + 400 } as DOMRect);
    measure.measureCue();
    f.detectChanges();
    expect(el.querySelector('sc-hq-cue')?.classList).toContain('gone');
    rect.and.returnValue({ bottom: window.innerHeight } as DOMRect);
    measure.measureCue();
    f.detectChanges();
    expect(el.querySelector('sc-hq-cue')?.classList).not.toContain('gone');
  });

  it('only the URL of Planen carries the route focus', () => {
    const f = mount();
    const url = (f.componentInstance as unknown as { urlFor(p: string): string });
    const before = window.location.href;
    history.replaceState(history.state, '', '?einsatz=e1&x=1');
    try {
      expect(url.urlFor('planen')).toBe('/hq?einsatz=e1&x=1#planen');
      expect(url.urlFor('inventar')).toBe('/hq?x=1#inventar');
      history.replaceState(history.state, '', '?einsatz=e1');
      expect(url.urlFor('start')).toBe('/hq');
    } finally {
      history.replaceState(history.state, '', before);
    }
  });

  it('every follow page takes the same column (the subheader width)', () => {
    const f = mount();
    const rects = ['planen', 'jetzt', 'inventar', 'statistik'].map((id) =>
      (f.nativeElement as HTMLElement).querySelector(`#${id}`)!.getBoundingClientRect(),
    );
    expect(new Set(rects.map((r) => Math.round(r.left))).size).toBe(1);
    expect(new Set(rects.map((r) => Math.round(r.width))).size).toBe(1);
  });

  it('the first-visit block, the patch lines, the chips and the friends line are gone', () => {
    const el: HTMLElement = mount().nativeElement;
    for (const sel of ['sc-hq-first-visit', 'sc-hq-start-friends', '.patch', '.chips']) expect(el.querySelector(sel)).toBeNull();
  });

  it('hotkeys 1 to 4 jump to Bestand, Jetzt, Planen, Statistik', () => {
    const ev = (key: string, init: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key, cancelable: true, ...init });
    expect(['1', '2', '3', '4'].map((k) => hotkeyPage(ev(k), false))).toEqual(['inventar', 'jetzt', 'planen', 'statistik']);
    expect(hotkeyPage(ev('5'), false)).toBeNull();
    expect(hotkeyPage(ev('0'), false)).toBeNull();
  });

  it('hotkeys stand back for modifiers, typing and open dialogs', () => {
    const ev = (init: KeyboardEventInit = {}) => new KeyboardEvent('keydown', { key: '1', cancelable: true, bubbles: true, ...init });
    for (const m of ['altKey', 'ctrlKey', 'metaKey', 'shiftKey']) expect(hotkeyPage(ev({ [m]: true }), false)).withContext(m).toBeNull();
    expect(hotkeyPage(ev(), true)).toBeNull();
    for (const html of ['<input />', '<textarea></textarea>', '<div contenteditable="true"></div>']) {
      const host = document.createElement('div');
      host.innerHTML = html;
      document.body.appendChild(host);
      const seen: (string | null)[] = [];
      host.addEventListener('keydown', (e) => seen.push(hotkeyPage(e as KeyboardEvent, false)));
      host.firstElementChild!.dispatchEvent(ev());
      host.remove();
      expect(seen).toEqual([null]);
    }
  });

  it('the rail stops carry their hotkey for assistive tech, Start has none', () => {
    const links = Array.from((mount().nativeElement as HTMLElement).querySelectorAll<HTMLAnchorElement>('sc-hq-rail a'));
    expect(links.map((a) => a.getAttribute('aria-keyshortcuts'))).toEqual([null, '1', '2', '3', '4']);
  });
});
