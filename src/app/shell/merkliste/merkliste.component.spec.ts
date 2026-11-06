import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { MerklisteComponent } from './merkliste.component';
import { MerklisteService } from './merkliste.service';
import { ShellChromeService } from '../fusion-bar/shell-chrome.service';
import type { MerkRow } from './merkliste.model';

const row = (id: string, title: string): MerkRow => ({ id, type: 'ship', title, subtitle: null, target: { link: ['/codex', 'ship', id], queryParams: null }, href: null });

function mount(over: Partial<Record<string, unknown>> = {}) {
  const svc = {
    count: signal(3),
    supplyOpen: signal(1),
    type: signal<string | null>('ship'),
    recent: signal<MerkRow[]>([row('a', 'Cutter Scout')]),
    wishedShown: signal<MerkRow[]>([row('b', 'Zeus')]),
    newsRead: signal<MerkRow[]>([]),
    newsSaved: signal<MerkRow[]>([]),
    supplyLines: signal<{ id: string; name: string; qty: number }[]>([]),
    refresh: jasmine.createSpy('refresh'),
    ...over,
  };
  TestBed.configureTestingModule({ providers: [provideRouter([]), provideTranslateService({}), { provide: MerklisteService, useValue: svc }] });
  const fixture = TestBed.createComponent(MerklisteComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, svc };
}

describe('MerklisteComponent', () => {
  it('renders nothing while everything is empty', () => {
    const { el } = mount({ count: signal(0) });
    expect(el.querySelector('button')).toBeNull();
  });

  it('shows one icon with the count, opens the panel with real anchors and closes on Escape', async () => {
    const { fixture, el, svc } = mount();
    const trigger = el.querySelector<HTMLButtonElement>('.trigger')!;
    expect(trigger.textContent).toContain('3');
    expect(trigger.getAttribute('aria-label')).toContain('merkliste.aria');
    trigger.click();
    fixture.detectChanges();
    expect(svc.refresh).toHaveBeenCalled();
    const rows = el.querySelectorAll<HTMLAnchorElement>('a.row');
    expect(rows.length).toBe(2);
    expect(rows[0].getAttribute('href')).toBe('/codex/ship/a');
    expect(el.querySelector('a.all')!.getAttribute('href')).toBe('/hq');
    el.querySelector('.panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('.panel')).toBeNull();
  });

  it('news shows read and saved sections, no wishlist link', () => {
    const { fixture, el } = mount({ type: signal('news'), newsRead: signal([row('r', 'Report')]) });
    el.querySelector<HTMLButtonElement>('.trigger')!.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('merkliste.newsRead');
    expect(el.textContent).toContain('merkliste.newsSaved');
    expect(el.querySelector('a.all')).toBeNull();
  });

  it('the Nachschub tab opens the supplies popup through the shell chrome', () => {
    const { fixture, el } = mount();
    const chrome = TestBed.inject(ShellChromeService);
    el.querySelector<HTMLButtonElement>('.trigger')!.click();
    fixture.detectChanges();
    el.querySelectorAll<HTMLButtonElement>('.tab')[1].click();
    fixture.detectChanges();
    el.querySelector<HTMLButtonElement>('.open-sup')!.click();
    fixture.detectChanges();
    expect(chrome.suppliesPopup()).toEqual({ tab: 'nachschub' });
    expect(el.querySelector('.panel')).toBeNull();
  });

  it('the whole-wishlist anchor opens the wishlist tab on a plain click', () => {
    const { fixture, el } = mount();
    const chrome = TestBed.inject(ShellChromeService);
    el.querySelector<HTMLButtonElement>('.trigger')!.click();
    fixture.detectChanges();
    el.querySelector<HTMLAnchorElement>('a.all')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(chrome.suppliesPopup()).toEqual({ tab: 'wishlist' });
  });
});
