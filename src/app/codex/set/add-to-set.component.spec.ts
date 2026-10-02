import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { AddToSetComponent } from './add-to-set.component';
import { AuthService } from '../../auth/auth.service';
import { HangarService } from '../../hangar/hangar.service';
import { HangarRoleLoadout } from '../../hangar/hangar.types';
import { CodexService } from '../codex.service';

const FPS_SET: HangarRoleLoadout = { id: 'set-1', name: 'Recon', role: 'fps', items: [], createdAt: '', updatedAt: '' };
const MINING_SET: HangarRoleLoadout = { ...FPS_SET, id: 'set-2', name: 'Rocks', role: 'mining' };

describe('AddToSetComponent (L09)', () => {
  async function setup(opts: {
    signedIn?: boolean;
    sets?: HangarRoleLoadout[];
    piece?: { className: string; kind: 'weapon' | 'item'; subType: string | null; attachType: string | null };
    write?: jasmine.Spy;
  }): Promise<{ fixture: ComponentFixture<AddToSetComponent>; el: HTMLElement; write: jasmine.Spy; loadAll: jasmine.Spy }> {
    const roleLoadouts = signal<HangarRoleLoadout[]>([]);
    const loadAll = jasmine.createSpy('loadAll').and.callFake(async () => roleLoadouts.set(opts.sets ?? []));
    const write = opts.write ?? jasmine.createSpy('setRoleLoadoutSlot').and.resolveTo(null);
    await TestBed.configureTestingModule({
      imports: [AddToSetComponent],
      providers: [
        provideRouter([]),
        provideTranslateService({ fallbackLang: 'en' }),
        { provide: AuthService, useValue: { user: signal(opts.signedIn === false ? null : { id: 'u1' }) } },
        { provide: HangarService, useValue: { roleLoadouts, loadAll, error: signal(null), setRoleLoadoutSlot: write } },
        { provide: CodexService, useValue: { viewingPastPatch: signal(false) } },
      ],
    }).compileComponents();
    const fixture = TestBed.createComponent(AddToSetComponent);
    const piece = opts.piece ?? { className: 'behr_rifle_01', kind: 'weapon', subType: 'Medium', attachType: null };
    fixture.componentRef.setInput('className', piece.className);
    fixture.componentRef.setInput('kind', piece.kind);
    fixture.componentRef.setInput('subType', piece.subType);
    fixture.componentRef.setInput('attachType', piece.attachType);
    fixture.componentRef.setInput('itemName', 'P4-AR');
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement, write, loadAll };
  }

  async function open(fixture: ComponentFixture<AddToSetComponent>): Promise<void> {
    (fixture.nativeElement.querySelector('.ats-trigger') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  it('touches neither auth nor the hangar store until it is opened', async () => {
    const { el, loadAll } = await setup({ sets: [FPS_SET] });
    expect(loadAll).not.toHaveBeenCalled();
    expect(el.querySelector('.ats-pop')).toBeNull();
    expect(el.querySelector('.ats-trigger')!.getAttribute('aria-expanded')).toBe('false');
  });

  it('signed out: offers "create a set" as a link to the hangar', async () => {
    const { fixture, el, loadAll } = await setup({ signedIn: false });
    await open(fixture);
    expect(fixture.componentInstance.view()).toBe('signedOut');
    expect(el.querySelector('a.ats-link')!.getAttribute('href')).toBe('/hangar');
    expect(loadAll).not.toHaveBeenCalled();
  });

  it('no set yet: points to the hangar instead of an empty list', async () => {
    const { fixture, el } = await setup({ sets: [] });
    await open(fixture);
    expect(fixture.componentInstance.view()).toBe('noSet');
    expect(el.querySelector('a.ats-link')!.getAttribute('href')).toBe('/hangar');
  });

  it('asks for the set, then the slot, and writes through the equip-mode merge', async () => {
    const saved: HangarRoleLoadout = { ...FPS_SET, items: [{ slot: 'secondary', className: 'behr_rifle_01', kind: 'weapon' }] };
    const write = jasmine.createSpy('setRoleLoadoutSlot').and.resolveTo(saved);
    const fps2: HangarRoleLoadout = { ...FPS_SET, id: 'set-3', name: 'Assault' };
    const { fixture, el } = await setup({ sets: [FPS_SET, MINING_SET, fps2], write });
    await open(fixture);

    // The mining set has no slot for a rifle, so only the two fps sets are offered.
    const setButtons = Array.from(el.querySelectorAll<HTMLElement>('.ats-opt[data-set]')).map((b) => b.dataset['set']);
    expect(setButtons).toEqual(['set-1', 'set-3']);
    (el.querySelector('.ats-opt[data-set="set-1"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const slots = Array.from(el.querySelectorAll<HTMLElement>('.ats-opt[data-slot]')).map((b) => b.dataset['slot']);
    expect(slots).toEqual(['primary', 'secondary']);
    (el.querySelector('.ats-opt[data-slot="secondary"]') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(write).toHaveBeenCalledOnceWith('set-1', 'secondary', { className: 'behr_rifle_01', kind: 'weapon' }, undefined);
    expect(fixture.componentInstance.view()).toBe('done');
    expect(el.querySelector('a.ats-link')!.getAttribute('href')).toBe('/codex/set/set-1');
  });

  it('skips both questions for armour with one set: one click writes the one home', async () => {
    const saved: HangarRoleLoadout = { ...FPS_SET, items: [{ slot: 'helmet', className: 'rsi_helmet_01', kind: 'item' }] };
    const write = jasmine.createSpy('setRoleLoadoutSlot').and.resolveTo(saved);
    const { fixture, el } = await setup({
      sets: [FPS_SET],
      write,
      piece: { className: 'rsi_helmet_01', kind: 'item', subType: 'Light', attachType: 'Char_Armor_Helmet' },
    });
    await open(fixture);
    expect(write).toHaveBeenCalledOnceWith('set-1', 'helmet', { className: 'rsi_helmet_01', kind: 'item' }, undefined);
    expect(el.querySelector('a.ats-link')!.getAttribute('href')).toBe('/codex/set/set-1');
  });

  it('says so when another tab put a different piece into the slot meanwhile', async () => {
    const helmetSet: HangarRoleLoadout = { ...FPS_SET, items: [{ slot: 'helmet', className: 'old_helmet', kind: 'item' }] };
    const fresh: HangarRoleLoadout = { ...FPS_SET, items: [{ slot: 'helmet', className: 'other_tab_helmet', kind: 'item' }] };
    const write = jasmine.createSpy('setRoleLoadoutSlot').and.resolveTo(fresh);
    const { fixture, el } = await setup({
      sets: [helmetSet],
      write,
      piece: { className: 'rsi_helmet_01', kind: 'item', subType: 'Light', attachType: 'Char_Armor_Helmet' },
    });
    await open(fixture);
    // The piece the popover saw rides along, so the newer one is not overwritten blind.
    expect(write.calls.mostRecent().args[3]).toBe('old_helmet');
    expect(fixture.componentInstance.view()).toBe('pickSlot');
    expect(el.querySelector('.ats-note[role="status"]')).not.toBeNull();
  });

  it('reports a refused write at the control', async () => {
    const { fixture, el } = await setup({
      sets: [FPS_SET],
      piece: { className: 'rsi_helmet_01', kind: 'item', subType: 'Light', attachType: 'Char_Armor_Helmet' },
    });
    await open(fixture);
    expect(el.querySelector('.ats-err[role="alert"]')).not.toBeNull();
  });

  it('closes on Escape inside the popover', async () => {
    const { fixture, el } = await setup({ signedIn: false });
    await open(fixture);
    el.querySelector('.ats-pop')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(el.querySelector('.ats-pop')).toBeNull();
  });
});
