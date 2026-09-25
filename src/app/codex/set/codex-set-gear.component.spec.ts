import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideRouter } from '@angular/router';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';

import { CodexSetGearComponent } from './codex-set-gear.component';
import { ResolvedEntity } from '../codex.service';
import { HangarService } from '../../hangar/hangar.service';
import { HangarRoleLoadout, RoleLoadoutItem, RoleLoadoutRole } from '../../hangar/hangar.types';

let setSlotCalls: Array<[string, string, unknown, string | undefined]>;
let setSlotResult: HangarRoleLoadout | null;
/** When set, `setRoleLoadoutSlot` waits on it — lets a spec look at the busy state. */
let gate: Promise<void> | null;

async function setup(opts: {
  role: RoleLoadoutRole;
  items?: RoleLoadoutItem[];
  resolved?: Map<string, ResolvedEntity>;
}): Promise<ComponentFixture<CodexSetGearComponent>> {
  setSlotCalls = [];
  setSlotResult = { id: 'set-1', items: [] as RoleLoadoutItem[] } as HangarRoleLoadout;
  gate = null;
  await TestBed.configureTestingModule({
    imports: [CodexSetGearComponent],
    providers: [
      provideRouter([]),
      provideTranslateService({}),
      {
        provide: HangarService,
        useValue: {
          error: signal<string | null>(null),
          setRoleLoadoutSlot: async (id: string, slot: string, piece: unknown, expect?: string) => {
            setSlotCalls.push([id, slot, piece, expect]);
            if (gate) await gate;
            return setSlotResult;
          },
        } as Partial<HangarService>,
      },
    ],
  }).compileComponents();
  const fixture = TestBed.createComponent(CodexSetGearComponent);
  fixture.componentRef.setInput('setId', 'set-1');
  fixture.componentRef.setInput('role', opts.role);
  fixture.componentRef.setInput('items', opts.items ?? []);
  if (opts.resolved) fixture.componentRef.setInput('resolved', opts.resolved);
  fixture.detectChanges();
  return fixture;
}

function slotEls(fixture: ComponentFixture<CodexSetGearComponent>): HTMLElement[] {
  return Array.from((fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>('.gear-slot'));
}

function slotEl(fixture: ComponentFixture<CodexSetGearComponent>, slot: string): HTMLElement {
  const el = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>(`.gear-slot[data-slot="${slot}"]`);
  if (!el) throw new Error('no slot ' + slot);
  return el;
}

const RIFLE: ResolvedEntity = {
  kind: 'weapon',
  className: 'behr_rifle_ballistic_01',
  nameLocalized: 'P4-AR Rifle',
  manufacturerCode: 'BEHR',
  size: null,
  grade: null,
} as ResolvedEntity;

/** Carries a genuine EN/DE payload name, distinct from its slim nameLocalized fallback. */
const RIFLE_LOCALIZED: ResolvedEntity = {
  ...RIFLE,
  name: { key: '@weapon_P4AR', en: 'P4-AR Rifle EN', de: 'P4-AR Gewehr' },
};

describe('CodexSetGearComponent', () => {
  it('lists the role\'s non-anatomical positions in their suggestion order', async () => {
    const fps = await setup({ role: 'fps' });
    expect(slotEls(fps).map((e) => e.dataset['slot'])).toEqual(['primary', 'secondary', 'sidearm', 'melee', 'throwable']);
    TestBed.resetTestingModule();

    const medical = await setup({ role: 'medical' });
    expect(slotEls(medical).map((e) => e.dataset['slot'])).toEqual(['medgun', 'multitool', 'medpen']);
  });

  it('shows a filled position with its resolved name and a clear button', async () => {
    const fixture = await setup({
      role: 'fps',
      items: [
        { slot: 'helmet', className: 'Test_Helmet', kind: 'item' },
        { slot: 'primary', className: 'behr_rifle_ballistic_01', kind: 'weapon' },
      ],
      resolved: new Map([['behr_rifle_ballistic_01', RIFLE]]),
    });
    const primary = slotEl(fixture, 'primary');
    expect(primary.classList).not.toContain('empty');
    expect(primary.querySelector('.t-value')?.textContent?.trim()).toBe('P4-AR Rifle');
    const clear = primary.querySelector('button.gear-clear');
    expect(clear).not.toBeNull();
    // The action sits NEXT to the navigation, never inside it.
    expect(clear?.closest('a')).toBeNull();
  });

  it('falls back to a humanised class name when the piece did not resolve', async () => {
    const fixture = await setup({
      role: 'fps',
      items: [{ slot: 'sidearm', className: 'KSAR_Pistol_Energy_01', kind: 'weapon' }],
    });
    expect(slotEl(fixture, 'sidearm').querySelector('.t-value')?.textContent?.trim()).toBe('KSAR Pistol Energy 01');
  });

  it('shows an open position with the open label and no clear button', async () => {
    const fixture = await setup({ role: 'fps', items: [{ slot: 'secondary', className: null, kind: null }] });
    const secondary = slotEl(fixture, 'secondary');
    expect(secondary.classList).toContain('empty');
    expect(secondary.querySelector('.t-value')?.textContent?.trim()).toBe('codex.set.gear.open');
    expect(secondary.querySelector('button.gear-clear')).toBeNull();
  });

  it('links each archive-backed position to the FPS archive narrowed to that slot', async () => {
    const fixture = await setup({ role: 'salvage' });
    const a = slotEl(fixture, 'tractor').querySelector('a.gear-tile') as HTMLAnchorElement;
    expect(a).not.toBeNull();
    expect(a.getAttribute('href')).toBe('/codex/fps?cat=weapon&equipInto=set-1&equipSlot=tractor');
  });

  it('lists filled slots outside the role\'s positions — clearable, not linked', async () => {
    // The retired editor stored whatever slot name the user typed; readiness
    // still counts those pieces, so the page must show them too.
    const fixture = await setup({
      role: 'fps',
      items: [
        { slot: 'Knife', className: 'kdid_knife_01', kind: 'weapon' },
        { slot: 'multitool', className: 'grin_multitool_01', kind: 'weapon' },
        { slot: 'Grenade belt', className: null, kind: null },
        { slot: 'helmet', className: 'Test_Helmet', kind: 'item' },
      ],
    });
    expect(slotEls(fixture).map((e) => e.dataset['slot'])).toEqual([
      'primary', 'secondary', 'sidearm', 'melee', 'throwable', 'Knife', 'multitool',
    ]);

    const knife = slotEl(fixture, 'Knife');
    expect(knife.querySelector('a')).toBeNull();
    expect(knife.querySelector('.t-label')?.textContent?.trim()).toBe('Knife');
    expect(knife.querySelector('.gear-note')?.textContent).toContain('codex.set.gear.customSlot');
    expect(knife.querySelector('button.gear-clear')).not.toBeNull();
    // A known token keeps its translated label even outside its own role.
    expect(slotEl(fixture, 'multitool').querySelector('.t-label')?.textContent?.trim()).toBe('hangar.slots.multitool');
  });

  it('renders the medpen position muted, without a link, with the no-source note', async () => {
    const fixture = await setup({ role: 'medical' });
    const medpen = slotEl(fixture, 'medpen');
    expect(medpen.classList).toContain('nosource');
    expect(medpen.querySelector('a')).toBeNull();
    expect(medpen.textContent).toContain('codex.set.gear.noSource');
  });

  it('clears a position through setRoleLoadoutSlot(id, slot, null, shown piece) with a busy state', async () => {
    const fixture = await setup({
      role: 'engineering',
      items: [{ slot: 'multitool', className: 'grin_multitool_01', kind: 'weapon' }],
    });
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));

    const btn = slotEl(fixture, 'multitool').querySelector('button.gear-clear') as HTMLButtonElement;
    btn.click();
    fixture.detectChanges();
    // The shown piece rides along: a newer one another tab put there survives.
    expect(setSlotCalls).toEqual([['set-1', 'multitool', null, 'grin_multitool_01']]);
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(btn.textContent?.trim()).toBe('codex.set.gear.clearing');

    release();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.componentInstance.busySlot()).toBeNull();
    expect(slotEl(fixture, 'multitool').querySelector('[role="alert"]')).toBeNull();
  });

  it('holds every clear button while one clear is in flight', async () => {
    const fixture = await setup({
      role: 'fps',
      items: [
        { slot: 'primary', className: 'behr_rifle_ballistic_01', kind: 'weapon' },
        { slot: 'sidearm', className: 'KSAR_Pistol_Energy_01', kind: 'weapon' },
      ],
    });
    let release!: () => void;
    gate = new Promise<void>((r) => (release = r));

    (slotEl(fixture, 'primary').querySelector('button.gear-clear') as HTMLButtonElement).click();
    fixture.detectChanges();
    const sidearm = slotEl(fixture, 'sidearm').querySelector('button.gear-clear') as HTMLButtonElement;
    // Disabled rather than silently ignoring the click, and only the busy one says so.
    expect(sidearm.disabled).toBe(true);
    expect(sidearm.getAttribute('aria-busy')).toBe('false');

    release();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(sidearm.disabled).toBe(false);
    expect(setSlotCalls.length).toBe(1);
  });

  it('offers "undo" after a clear, and undo puts the piece back', async () => {
    const fixture = await setup({
      role: 'fps',
      items: [{ slot: 'primary', className: 'behr_rifle_ballistic_01', kind: 'weapon' }],
    });
    (slotEl(fixture, 'primary').querySelector('button.gear-clear') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const note = slotEl(fixture, 'primary').querySelector('.gear-note');
    expect(note?.textContent).toContain('codex.set.gear.cleared');
    (note!.querySelector('button.gear-undo') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(setSlotCalls[1]).toEqual(['set-1', 'primary', { className: 'behr_rifle_ballistic_01', kind: 'weapon' }, undefined]);
    expect(slotEl(fixture, 'primary').querySelector('.gear-note')).toBeNull();
  });

  it('says so when a clear met a newer piece from another tab — no undo for that', async () => {
    const fixture = await setup({
      role: 'fps',
      items: [{ slot: 'primary', className: 'behr_rifle_ballistic_01', kind: 'weapon' }],
    });
    setSlotResult = {
      id: 'set-1',
      items: [{ slot: 'primary', className: 'gmni_smg_energy_01', kind: 'weapon' }],
    } as HangarRoleLoadout;
    (slotEl(fixture, 'primary').querySelector('button.gear-clear') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const note = slotEl(fixture, 'primary').querySelector('.gear-note');
    expect(note?.textContent).toContain('codex.set.gear.changedElsewhere');
    expect(note?.querySelector('button.gear-undo')).toBeNull();
  });

  it('names a failed clear inline as an alert', async () => {
    const fixture = await setup({
      role: 'fps',
      items: [{ slot: 'primary', className: 'behr_rifle_ballistic_01', kind: 'weapon' }],
    });
    setSlotResult = null;
    (slotEl(fixture, 'primary').querySelector('button.gear-clear') as HTMLButtonElement).click();
    await fixture.whenStable();
    fixture.detectChanges();

    const alert = slotEl(fixture, 'primary').querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('codex.set.gear.clearFailed');
    expect(fixture.componentInstance.busySlot()).toBeNull();
  });

  it('shows the piece name in the current UI language, EN default', async () => {
    const fixture = await setup({
      role: 'fps',
      items: [{ slot: 'primary', className: 'behr_rifle_ballistic_01', kind: 'weapon' }],
      resolved: new Map([['behr_rifle_ballistic_01', RIFLE_LOCALIZED]]),
    });
    expect(slotEl(fixture, 'primary').querySelector('.t-value')?.textContent?.trim()).toBe('P4-AR Rifle EN');
  });

  it('follows a language switch to German and back', async () => {
    const fixture = await setup({
      role: 'fps',
      items: [{ slot: 'primary', className: 'behr_rifle_ballistic_01', kind: 'weapon' }],
      resolved: new Map([['behr_rifle_ballistic_01', RIFLE_LOCALIZED]]),
    });
    const translate = TestBed.inject(TranslateService);

    translate.use('de');
    fixture.detectChanges();
    expect(slotEl(fixture, 'primary').querySelector('.t-value')?.textContent?.trim()).toBe('P4-AR Gewehr');

    translate.use('en');
    fixture.detectChanges();
    expect(slotEl(fixture, 'primary').querySelector('.t-value')?.textContent?.trim()).toBe('P4-AR Rifle EN');
  });

  it('falls back to nameLocalized when the payload carries no localized name', async () => {
    const fixture = await setup({
      role: 'fps',
      items: [{ slot: 'primary', className: 'behr_rifle_ballistic_01', kind: 'weapon' }],
      resolved: new Map([['behr_rifle_ballistic_01', RIFLE]]),
    });
    expect(slotEl(fixture, 'primary').querySelector('.t-value')?.textContent?.trim()).toBe('P4-AR Rifle');
  });
});
