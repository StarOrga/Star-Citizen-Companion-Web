import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexService } from '../../codex/codex.service';
import type { CartItem } from '../cart/wish-cart.model';
import { WishCartService } from '../cart/wish-cart.service';
import { HeaderPopoutService } from '../header-popout.service';
import { MerklisteComponent } from './merkliste.component';
import { MerklisteService } from './merkliste.service';

const item = (n: number, name: string, over: Partial<CartItem> = {}): CartItem => ({
  key: `weapon:w${n}`, kind: 'weapon', className: `w${n}`, name, qty: 1, forClassName: null, createdAt: '2026-11-0' + (n % 9 + 1),
  manufacturer: 'Behring', shipId: null, ...over,
} as CartItem);

function mount(items: CartItem[]) {
  const all = signal(items);
  const cart = {
    items: all,
    count: () => all().length,
    newest: (n: number) => all().slice(0, n),
    nameOf: (i: CartItem) => i.name ?? i.className,
    open: vi.fn().mockName('open').mockResolvedValue(true),
    setQty: vi.fn().mockName('setQty').mockResolvedValue(true),
    remove: vi.fn().mockName('remove'),
  };
  const svc = { refresh: vi.fn().mockName('refresh'), cartHref: signal('/codex/index?cart=1') };
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
  return { fixture, el: fixture.nativeElement as HTMLElement, svc, cart, popouts: TestBed.inject(HeaderPopoutService) };
}

const open = (f: ReturnType<typeof mount>) => {
  f.el.querySelector<HTMLButtonElement>('.trigger')!.click();
  f.fixture.detectChanges();
};

const many = (n: number) => Array.from({ length: n }, (_, i) => item(i, `Gun ${i}`));

describe('MerklisteComponent (wishlist popout)', () => {
  it('is an icon-only wishlist trigger: no count, no word until the panel is open', () => {
    const { el } = mount(many(2));
    const trigger = el.querySelector<HTMLButtonElement>('.trigger')!;
    expect(trigger.textContent!.trim()).toBe('');
    expect(trigger.getAttribute('aria-label')).toBe('quick.wish');
    expect(el.querySelector('.panel')).toBeNull();
  });

  it('is the wishlist only: no title, no recent section, at most 7 rows, then the whole-list link', () => {
    const f = mount(many(12));
    open(f);
    expect(f.svc.refresh).toHaveBeenCalled();
    expect(f.el.querySelector('.title')).toBeNull();
    expect(f.el.querySelector('.tiles')).toBeNull();
    expect(f.el.querySelectorAll('.sec').length).toBe(0);
    expect(f.el.querySelectorAll('.qrow').length).toBe(7);
    const all = f.el.querySelector<HTMLAnchorElement>('a.all')!;
    expect(all.textContent).toContain('quick.allWish');
    expect(all.getAttribute('href')).toBe('/codex/index?cart=1');
    // A plain click opens the cart in place.
    all.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
    expect(f.cart.open).toHaveBeenCalledTimes(1);
  });

  it('draws the name as a real anchor and the move-into-Nachschub link with exactly this pick', () => {
    const f = mount([item(1, 'Arrowhead', { qty: 3 })]);
    open(f);
    expect(f.el.querySelector<HTMLAnchorElement>('a.open')!.getAttribute('href')).toBe('/codex/weapon/w1');
    const move = f.el.querySelector<HTMLAnchorElement>('a.move')!;
    expect(move.getAttribute('href')).toContain('/hq?pick=');
    expect(decodeURIComponent(move.getAttribute('href')!)).toContain('weapon:w1~3');
    expect(move.getAttribute('href')).toContain('#planen');
  });

  it('removes a position and steps its quantity', () => {
    const f = mount([item(1, 'Arrowhead', { qty: 2 })]);
    open(f);
    const [less, more] = Array.from(f.el.querySelectorAll<HTMLButtonElement>('.step button'));
    more.click();
    expect(f.cart.setQty).toHaveBeenLastCalledWith(expect.objectContaining({ className: 'w1' }), 3);
    less.click();
    expect(f.cart.setQty).toHaveBeenLastCalledWith(expect.objectContaining({ className: 'w1' }), 1);
    f.el.querySelector<HTMLButtonElement>('button.del')!.click();
    expect(f.cart.remove).toHaveBeenCalledWith([expect.objectContaining({ className: 'w1' })]);
  });

  it('disables "less" at quantity 1', () => {
    const f = mount([item(1, 'Arrowhead', { qty: 1 })]);
    open(f);
    expect(f.el.querySelector<HTMLButtonElement>('.step button')!.disabled).toBe(true);
  });

  it('claims the header popout slot and folds away when another popout takes it', () => {
    const f = mount(many(1));
    open(f);
    expect(f.popouts.active()).toBe('wishlist');
    f.popouts.claim('apps');
    f.fixture.detectChanges();
    expect(f.el.querySelector('.panel')).toBeNull();
  });

  it('closes on Escape and frees the slot', () => {
    const f = mount(many(1));
    open(f);
    f.el.querySelector('.panel')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    f.fixture.detectChanges();
    expect(f.el.querySelector('.panel')).toBeNull();
    expect(f.popouts.active()).toBeNull();
  });
});
