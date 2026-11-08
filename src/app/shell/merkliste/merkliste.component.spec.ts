import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexService } from '../../codex/codex.service';
import { WishCartService } from '../cart/wish-cart.service';
import { MerklisteComponent } from './merkliste.component';
import { MerklisteService, type QuickContext } from './merkliste.service';
import type { MerkRow } from './merkliste.model';

const row = (id: string, title: string, over: Partial<MerkRow> = {}): MerkRow => ({
  id, type: 'weapon', title, subtitle: null, target: { link: ['/codex', 'weapon', id], queryParams: null }, href: null, kind: 'weapon', className: id, ...over,
});

function mount(over: Partial<Record<string, unknown>> = {}) {
  const svc = {
    type: signal<string | null>('weapon'),
    recent: signal<MerkRow[]>(['a', 'b', 'c', 'd', 'e'].map((i) => row(i, i.toUpperCase()))),
    wished: signal<MerkRow[]>([row('w', 'Arrowhead', { qty: 2 })]),
    wishCount: signal(12),
    cartHref: signal('/codex/index?kind=weapon&cart=1'),
    context: signal<QuickContext | null>({
      ctx: { id: 'inventar', tab: 'inventar', cat: 'weapons' },
      rows: [row('k', 'Karna', { qty: 1 })],
      all: { commands: ['/hq'], fragment: 'inventar', queryParams: { bestand: 'inventar', cat: 'weapons' } },
    }),
    refresh: jasmine.createSpy('refresh'),
    ...over,
  };
  const cart = { open: jasmine.createSpy('open').and.resolveTo(true) };
  TestBed.configureTestingModule({
    providers: [
      provideRouter([]),
      provideTranslateService({}),
      { provide: MerklisteService, useValue: svc },
      { provide: WishCartService, useValue: cart },
      { provide: CodexService, useValue: { silhouettes: async () => new Map() } },
    ],
  });
  const fixture = TestBed.createComponent(MerklisteComponent);
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, svc, cart };
}

const open = (f: ReturnType<typeof mount>) => {
  f.el.querySelector<HTMLButtonElement>('.trigger')!.click();
  f.fixture.detectChanges();
};

describe('MerklisteComponent (Schnellzugriff)', () => {
  it('is the crate icon only: no count, no word until the panel is open', () => {
    const { el } = mount();
    const trigger = el.querySelector<HTMLButtonElement>('.trigger')!;
    expect(trigger.textContent!.trim()).toBe('');
    expect(trigger.querySelector('b')).toBeNull();
    expect(trigger.querySelectorAll('svg path').length).toBe(2);
    expect(trigger.getAttribute('aria-label')).toBe('quick.title');
    expect(el.querySelector('.panel')).toBeNull();
  });

  it('opens the panel: title, three recent tiles, "Mehr anzeigen" lifts them to seven, all real anchors', () => {
    const f = mount();
    open(f);
    expect(f.svc.refresh).toHaveBeenCalled();
    expect(f.el.querySelector('.title')!.textContent).toContain('quick.title');
    expect(f.el.querySelectorAll('a.tile').length).toBe(3);
    expect(f.el.querySelector<HTMLAnchorElement>('a.tile')!.getAttribute('href')).toBe('/codex/weapon/a');
    f.el.querySelector<HTMLButtonElement>('.more')!.click();
    f.fixture.detectChanges();
    expect(f.el.querySelectorAll('a.tile').length).toBe(5);
  });

  it('shows the wishlist rows with their quantity and the whole-wishlist anchor with its own URL', () => {
    const f = mount();
    open(f);
    const rows = f.el.querySelectorAll<HTMLAnchorElement>('a.qrow');
    expect(rows[0].textContent).toContain('Arrowhead');
    expect(rows[0].querySelector('.chip')!.textContent!.trim()).toBe('2×');
    const all = f.el.querySelector<HTMLAnchorElement>('a.all')!;
    expect(all.getAttribute('href')).toBe('/codex/index?kind=weapon&cart=1');
    // A plain click opens the cart in place; a modified click is left to the browser.
    all.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(f.cart.open).toHaveBeenCalledTimes(1);
  });

  it('has the context section with the type-filtered deep link, and no Nachschub section', () => {
    const f = mount();
    open(f);
    const sections = Array.from(f.el.querySelectorAll('.sec h4')).map((h) => h.textContent!.trim());
    expect(sections.some((s) => s.includes('quick.section.inventar'))).toBeTrue();
    expect(sections.join(' ').toLowerCase()).not.toContain('nachschub');
    const links = Array.from(f.el.querySelectorAll<HTMLAnchorElement>('a.all'));
    expect(links[1].getAttribute('href')).toContain('bestand=inventar');
    expect(links[1].getAttribute('href')).toContain('cat=weapons');
  });

  it('has no Bestand section on a page without a type', () => {
    const f = mount({ type: signal(null), context: signal(null) });
    open(f);
    expect(f.el.querySelectorAll('.sec').length).toBe(2);
  });

  it('closes on Escape', () => {
    const f = mount();
    open(f);
    f.el.querySelector('.panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.fixture.detectChanges();
    expect(f.el.querySelector('.panel')).toBeNull();
  });
});
