import { Type, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { HangarService } from '../../hangar/hangar.service';
import type { HangarShip } from '../../hangar/hangar.types';
import { ItemPathService } from '../../hq/data/item-path.service';
import { HqOwnershipService } from '../../hq/hq-ownership.service';
import { ScConfirmService } from '../../shared/dialog/sc-confirm.service';
import { fakeItemPath, type FakeItemPath } from '../../shared/item-path/item-path.testing';
import { CodexOwnCardComponent } from './codex-own-card.component';
import { CodexOwnSegmentComponent } from './codex-own-segment.component';

const SHIP = { id: 'sh1', shipClassName: 'AEGS_Avenger_Stalker', customName: 'Schatten', status: 'owned', pinnedRank: 1, notes: null } as unknown as HangarShip;

describe('Codex ownership card + head segment (concept codex-kopf-besitz C2/C5/C7)', () => {
  let path: FakeItemPath;
  let confirm: jasmine.Spy;

  function setup<T>(type: Type<T>, inputs: Record<string, unknown>): ComponentFixture<T> {
    path = fakeItemPath();
    confirm = jasmine.createSpy('confirm').and.resolveTo(true);
    TestBed.configureTestingModule({
      imports: [type],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: ItemPathService, useValue: path },
        { provide: ScConfirmService, useValue: { confirm, prompt: jasmine.createSpy('prompt').and.resolveTo(null) } },
        { provide: HangarService, useValue: { error: signal(null), ships: signal([SHIP]), updateShip: jasmine.createSpy(), pinShip: jasmine.createSpy(), removeShip: jasmine.createSpy() } },
        { provide: HqOwnershipService, useValue: { configsForShip: () => [], invalidate: () => undefined } },
      ],
    });
    const fixture = TestBed.createComponent(type);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture;
  }

  const text = (f: ComponentFixture<unknown>) => (f.nativeElement as HTMLElement).textContent ?? '';

  describe('card', () => {
    it('ship not owned: "Haben?" with Wunschliste and Hangar as secondary pills, no primary', async () => {
      const f = setup(CodexOwnCardComponent, { kind: 'ship', className: 'AEGS_Avenger_Stalker', name: 'Avenger Stalker' });
      const el = f.nativeElement as HTMLElement;
      expect(text(f)).toContain('codex.ownCard.haveTitle');
      expect(el.querySelector('[tier="primary"]')).toBeNull();
      expect(el.querySelectorAll('[tier="secondary"]').length).toBe(2);
      el.querySelector<HTMLButtonElement>('.oc-wish')!.click();
      await f.whenStable();
      expect(path.addWish).toHaveBeenCalledWith('ship', 'AEGS_Avenger_Stalker', 'Avenger Stalker');
      el.querySelector<HTMLButtonElement>('.oc-own')!.click();
      await f.whenStable();
      expect(path.addToHangar).toHaveBeenCalledWith('AEGS_Avenger_Stalker', 'Avenger Stalker');
    });

    it('wished: a quantity stepper and "Wunschliste öffnen" as a real anchor', async () => {
      const f = setup(CodexOwnCardComponent, { kind: 'ship', className: 'AEGS_Avenger_Stalker', name: 'Avenger Stalker' });
      path.current.set({ wished: true, wishQty: 2 });
      f.detectChanges();
      const el = f.nativeElement as HTMLElement;
      const open = el.querySelector<HTMLAnchorElement>('a.oc-link')!;
      expect(open.getAttribute('href')).toContain('cart=1');
      el.querySelectorAll<HTMLButtonElement>('.oc-step .st')[1].click();
      await f.whenStable();
      expect(path.setWishQty).toHaveBeenCalledWith('ship', 'AEGS_Avenger_Stalker', 'Avenger Stalker', 3);
    });

    it('ship owned: "Dein Exemplar" with the name, the own-ship actions, Nachschub hint, Im HQ zeigen and no variant select', () => {
      const f = setup(CodexOwnCardComponent, { kind: 'ship', className: 'AEGS_Avenger_Stalker', name: 'Avenger Stalker', ship: SHIP, nachschubName: 'Kampfflotte' });
      path.current.set({ inHangar: true, hangarQty: 1, hangarShipId: 'sh1' });
      f.detectChanges();
      const el = f.nativeElement as HTMLElement;
      expect(text(f)).toContain('codex.ownCard.mineShip');
      expect(el.querySelector('.oc-name')?.textContent).toContain('Schatten');
      expect(el.querySelector('sc-codex-own-ship-actions .own-remove')?.getAttribute('tone')).toBe('danger');
      expect(el.querySelector('.oc-hq')?.textContent).toContain('codex.ownCard.inNachschub');
      expect(el.querySelector<HTMLAnchorElement>('a.oc-link')!.getAttribute('href')).toContain('/hq');
      expect(el.querySelector('sc-codex-mode-switch')).toBeNull();
      expect(f.componentInstance.owned()).toBeTrue();
    });

    it('no Nachschub hint when the ship sits in none', () => {
      const f = setup(CodexOwnCardComponent, { kind: 'ship', className: 'X', ship: SHIP, forceOwned: true });
      expect((f.nativeElement as HTMLElement).querySelector('.oc-hq')).toBeNull();
    });

    it('item owned: "Dein Bestand" - stepper, remove asks first (danger), Noch eins wünschen', async () => {
      const f = setup(CodexOwnCardComponent, { kind: 'weapon', className: 'KLWE_Laser_S3', name: 'M6A' });
      path.current.set({ inventarQty: 2, places: [{ location: 'Area 18', qty: 2 }] });
      f.detectChanges();
      const el = f.nativeElement as HTMLElement;
      expect(text(f)).toContain('codex.ownCard.mineItem');
      expect(el.querySelector('.oc-step b')?.textContent).toBe('2');
      el.querySelectorAll<HTMLButtonElement>('.oc-step .st')[1].click();
      await f.whenStable();
      expect(path.adjustInventar).toHaveBeenCalledWith('KLWE_Laser_S3', 'M6A', 'Area 18', 1);
      el.querySelector<HTMLButtonElement>('.oc-remove')!.click();
      await f.whenStable();
      expect(confirm).toHaveBeenCalledWith(jasmine.objectContaining({ tone: 'danger' }));
      expect(path.removeFromInventar).toHaveBeenCalledWith('weapon', 'KLWE_Laser_S3', 'M6A');
      el.querySelector<HTMLButtonElement>('.oc-again')!.click();
      await f.whenStable();
      expect(path.addWish).toHaveBeenCalled();
      // Note / pin have no backing service for an inventory item: not offered.
      expect(el.querySelector('sc-codex-own-ship-actions')).toBeNull();
    });

    it('a failed write shows its translated key, never raw text', async () => {
      const f = setup(CodexOwnCardComponent, { kind: 'ship', className: 'X' });
      path.addWish.and.resolveTo({ ok: false, key: 'errors.network' });
      (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.oc-wish')!.click();
      await f.whenStable();
      f.detectChanges();
      expect((f.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain('errors.network');
    });

    it('signed out: a sign-in anchor instead of writes', () => {
      const f = setup(CodexOwnCardComponent, { kind: 'ship', className: 'X' });
      path.current.set({ signedIn: false });
      f.detectChanges();
      const el = f.nativeElement as HTMLElement;
      expect(el.querySelector<HTMLAnchorElement>('a[href="/login"]')).not.toBeNull();
      expect(el.querySelector('.oc-wish')).toBeNull();
    });

    it('reveal() focuses the card and lights it up briefly', () => {
      const f = setup(CodexOwnCardComponent, { kind: 'ship', className: 'X' });
      const host = f.nativeElement as HTMLElement;
      document.body.appendChild(host);
      f.componentInstance.reveal();
      f.detectChanges();
      expect(document.activeElement).toBe(host);
      expect(host.classList).toContain('flash');
      host.remove();
    });
  });

  describe('head segment', () => {
    it('not owned: a quiet button that asks the page to show the card', () => {
      const f = setup(CodexOwnSegmentComponent, { kind: 'ship', className: 'X' });
      const jumped = jasmine.createSpy('jump');
      f.componentInstance.jump.subscribe(jumped);
      const btn = (f.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('button.quiet')!;
      expect(btn.textContent).toContain('codex.head.notOwn.hangar');
      btn.click();
      expect(jumped).toHaveBeenCalled();
    });

    it('owned ship: "Im Hangar" plus the inline variant select (no primary tier)', () => {
      const f = setup(CodexOwnSegmentComponent, {
        kind: 'ship', className: 'X', forceOwned: true, showVariant: true, hangarShipId: 'sh1',
        variants: [{ id: 'c1', name: 'a', active: true }], activeVariantId: 'c1', personal: true,
      });
      const el = f.nativeElement as HTMLElement;
      expect(el.querySelector('.own')?.textContent).toContain('codex.head.own.hangar');
      const sel = el.querySelector<HTMLButtonElement>('sc-codex-mode-switch .isel')!;
      expect(sel.textContent).toContain('a');
      expect(el.querySelector('[tier="primary"]')).toBeNull();
      sel.click();
      f.detectChanges();
      const links = Array.from(el.querySelectorAll<HTMLAnchorElement>('.menu a'));
      expect(links.length).toBe(1);
      expect(links[0].getAttribute('href')).toContain('/hq/hangar/sh1');
    });

    it('item: "Im Inventar · n×" / "Nicht im Inventar"', () => {
      const f = setup(CodexOwnSegmentComponent, { kind: 'weapon', className: 'X' });
      expect(text(f)).toContain('codex.head.notOwn.inventar');
      path.current.set({ inventarQty: 2 });
      f.detectChanges();
      expect(text(f)).toContain('codex.head.own.inventar');
    });
  });
});
