import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { ItemPathService, ownWordOf, stepsOf } from '../../hq/data/item-path.service';
import type { ItemPathState, PathStep } from '../../hq/data/item-path.service';
import { WishCartService } from '../../shell/cart/wish-cart.service';
import { UndoToastService } from '../undo-toast/undo-toast.service';
import { ItemPathComponent, ItemPathLevel, nextStepOf, ownStepOf } from './item-path.component';
import { FakeItemPath, fakeItemPath, pathState } from './item-path.testing';

interface Opts {
  kind?: string;
  level?: ItemPathLevel;
  state?: Partial<ItemPathState>;
}

function setup(o: Opts = {}) {
  const path: FakeItemPath = fakeItemPath(o.state);
  const cart = { open: jasmine.createSpy('open').and.resolveTo(true) };
  TestBed.configureTestingModule({
    imports: [ItemPathComponent],
    providers: [
      provideRouter([]),
      provideTranslateService(),
      { provide: ItemPathService, useValue: path },
      { provide: WishCartService, useValue: cart },
    ],
  });
  const fixture = TestBed.createComponent(ItemPathComponent);
  fixture.componentRef.setInput('kind', o.kind ?? 'item');
  fixture.componentRef.setInput('className', 'cls');
  fixture.componentRef.setInput('name', 'Helm');
  fixture.componentRef.setInput('level', o.level ?? 'tertiary');
  fixture.detectChanges();
  const el = fixture.nativeElement as HTMLElement;
  const node = (step: PathStep) => el.querySelector<HTMLElement>(`.node[data-step="${step}"]`);
  const settle = async () => {
    // Not whenStable: the undo toast holds a 6 s window open in the zone.
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
  };
  const click = async (b: HTMLElement) => {
    b.click();
    await settle();
  };
  const popover = () => document.querySelector<HTMLElement>('.cdk-overlay-container .rp');
  return { fixture, el, node, click, settle, popover, path, cart, toast: TestBed.inject(UndoToastService) };
}

describe('ItemPathComponent: the two-node path', () => {
  afterEach(() => {
    TestBed.inject(UndoToastService).flush();
    document.querySelector('.cdk-overlay-container')?.replaceChildren();
  });

  it('has two nodes only: Wunschliste and Inventar, no Nachschub node', () => {
    const { el } = setup();
    const steps = Array.from(el.querySelectorAll('.node')).map((n) => n.getAttribute('data-step'));
    expect(steps).toEqual(['wish', 'inventar']);
  });

  it('a ship ends at the Hangar, a blueprint at the Sammlung, an announced ship at the wish', () => {
    expect(stepsOf('ship')).toEqual(['wish', 'hangar']);
    expect(stepsOf('item')).toEqual(['wish', 'inventar']);
    expect(stepsOf('upcoming')).toEqual(['wish']);
    expect(ownWordOf('ship')).toBe('hangar');
    expect(ownWordOf('blueprint')).toBe('sammlung');
    expect(ownWordOf('weapon')).toBe('inventar');
    expect(ownWordOf('upcoming')).toBeNull();
  });

  it('renders the Hangar node for a ship and only the wish node for an announced ship', () => {
    expect(setup({ kind: 'ship' }).node('hangar')).not.toBeNull();
    TestBed.resetTestingModule();
    expect(setup({ kind: 'upcoming' }).el.querySelectorAll('.node').length).toBe(1);
  });

  it('an empty wish node puts one piece on the wishlist, with an undo toast', async () => {
    const t = setup();
    await t.click(t.node('wish')!);
    expect(t.path.addWish).toHaveBeenCalledOnceWith('item', 'cls', 'Helm');
    expect(t.cart.open).not.toHaveBeenCalled();
    expect(t.toast.current()?.messageKey).toBe('itemPath.done.wishOn');
  });

  it('a filled wish node shows the quantity and opens the cart instead of adding more', async () => {
    const t = setup({ state: { wished: true, wishQty: 3 } });
    expect(t.node('wish')!.querySelector('.n')!.textContent!.trim()).toBe('3');
    await t.click(t.node('wish')!);
    expect(t.cart.open).toHaveBeenCalledTimes(1);
    expect(t.path.addWish).not.toHaveBeenCalled();
  });

  it('a filled Inventar node is a real link to the item in HQ Bestand', () => {
    const t = setup({ state: { inventarQty: 2 } });
    const a = t.node('inventar') as HTMLAnchorElement;
    expect(a.tagName).toBe('A');
    const href = a.getAttribute('href')!;
    expect(href).toContain('/hq');
    expect(href).toContain('bestand=inventar');
    expect(href).toContain('focus=cls');
    expect(href).toContain('#inventar');
    expect(a.querySelector('.n')!.textContent!.trim()).toBe('2');
  });

  it('a collected blueprint links to the Sammlung tab', () => {
    const t = setup({ kind: 'blueprint', state: { inventarQty: 1 } });
    expect((t.node('inventar') as HTMLAnchorElement).getAttribute('href')).toContain('bestand=sammlung');
  });

  it('an owned ship links to its page in the Hangar', () => {
    const t = setup({ kind: 'ship', state: { inHangar: true, hangarShipId: 'abc' } });
    expect((t.node('hangar') as HTMLAnchorElement).getAttribute('href')).toBe('/hq/hangar/abc');
  });

  it('an empty Inventar node asks for the place first, then stores one piece', async () => {
    const t = setup();
    await t.click(t.node('inventar')!);
    const pop = t.popover()!;
    expect(pop).not.toBeNull();
    pop.querySelector<HTMLButtonElement>('.place')!.click();
    await t.settle();
    expect(t.path.moveToInventar).toHaveBeenCalledOnceWith('item', 'cls', 'Helm', 'Bei mir', 1);
  });

  it('an empty Hangar node adds the ship; an empty Sammlung node collects the blueprint', async () => {
    const ship = setup({ kind: 'ship' });
    await ship.click(ship.node('hangar')!);
    expect(ship.path.addToHangar).toHaveBeenCalledOnceWith('cls', 'Helm');
    TestBed.resetTestingModule();
    const bp = setup({ kind: 'blueprint' });
    await bp.click(bp.node('inventar')!);
    expect(bp.path.moveToInventar).toHaveBeenCalledOnceWith('blueprint', 'cls', 'Helm', 'Blueprints', 1);
  });

  it('a failure shows its translated key at the node, no toast', async () => {
    const t = setup();
    t.path.addWish.and.resolveTo({ ok: false, key: 'errors.itemPath.failed' });
    await t.click(t.node('wish')!);
    expect(t.popover()!.textContent).toContain('errors.itemPath.failed');
    expect(t.toast.current()).toBeNull();
  });

  describe('the detail page (primary level)', () => {
    it('shows a stepper at the wish and sets the quantity; below 1 it takes the entry off', async () => {
      const t = setup({ level: 'primary', state: { wished: true, wishQty: 2 } });
      const [less, more] = Array.from(t.el.querySelectorAll<HTMLButtonElement>('.stop .st button'));
      await t.click(more);
      expect(t.path.setWishQty).toHaveBeenCalledWith('item', 'cls', 'Helm', 3);
      await t.click(less);
      expect(t.path.setWishQty).toHaveBeenCalledWith('item', 'cls', 'Helm', 1);
    });

    it('says "not in the inventory" with an add button, and adds on click', async () => {
      const t = setup({ level: 'primary' });
      const stops = t.el.querySelectorAll('.stop');
      expect(stops.length).toBe(2);
      await t.click(stops[1].querySelector<HTMLButtonElement>('button')!);
      expect(t.popover()).not.toBeNull();
    });

    it('with stock: a stepper on the first place and a link to the item', async () => {
      const t = setup({ level: 'primary', state: { inventarQty: 2, places: [{ location: 'Bei mir', qty: 2 }] } });
      const stop = t.el.querySelectorAll('.stop')[1];
      await t.click(stop.querySelectorAll<HTMLButtonElement>('.st button')[1]);
      expect(t.path.adjustInventar).toHaveBeenCalledWith('cls', 'Helm', 'Bei mir', 1);
      expect(stop.querySelector('a.alink')!.getAttribute('href')).toContain('focus=cls');
    });
  });

  describe('the pill (secondary level)', () => {
    it('offers the wish first, then the Inventar, then nothing', () => {
      expect(nextStepOf(pathState('item'))).toBe('wish');
      expect(nextStepOf(pathState('item', { wished: true }))).toBe('inventar');
      expect(nextStepOf(pathState('item', { wished: true, inventarQty: 1 }))).toBeNull();
      expect(nextStepOf(pathState('ship', { wished: true }))).toBe('hangar');
      expect(nextStepOf(pathState('ship', { inHangar: true }))).toBeNull();
      expect(nextStepOf(pathState('upcoming'))).toBe('wish');
      expect(nextStepOf(pathState('upcoming', { wished: true }))).toBeNull();
      expect(ownStepOf(pathState('ship'))).toBe('hangar');
      expect(ownStepOf(pathState('upcoming'))).toBeNull();
    });

    it('renders the next step as a button', async () => {
      const t = setup({ level: 'secondary' });
      await t.click(t.el.querySelector<HTMLButtonElement>('button.go')!);
      expect(t.path.addWish).toHaveBeenCalledTimes(1);
    });
  });
});
