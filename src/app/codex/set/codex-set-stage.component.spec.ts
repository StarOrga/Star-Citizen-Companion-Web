import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { provideLocationMocks } from '@angular/common/testing';
import { TranslateService, provideTranslateService } from '@ngx-translate/core';

import { CodexSetStageComponent } from './codex-set-stage.component';
import { CodexBoardFigureComponent } from '../codex-board-figure.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { HangarRoleLoadout } from '../../hangar/hangar.types';
import { ResolvedEntity } from '../codex.service';
import { ArmorRatingRow, SetLensId } from './set-rating';
import { SetArsenalTransition } from './set-arsenal-transition';
import { HangarService } from '../../hangar/hangar.service';
import { RoleLoadoutItem } from '../../hangar/hangar.types';

let setSlotCalls: [string, string, unknown, string | undefined][] = [];
let setSlotResult: HangarRoleLoadout | null = null;
const hangarStub = {
  provide: HangarService,
  useValue: {
    setRoleLoadoutSlot: async (id: string, slot: string, piece: unknown, expect?: string) => {
      setSlotCalls.push([id, slot, piece, expect]);
      return setSlotResult;
    },
  } as Partial<HangarService>,
};

const SET: HangarRoleLoadout = {
  id: 'set-a',
  name: 'Tech Set',
  role: 'engineering',
  items: [
    { slot: 'helmet', className: 'Test_Helmet', kind: 'item' },
    { slot: 'core', className: 'Test_Torso', kind: 'item' },
    { slot: 'arms', className: null, kind: null },
    { slot: 'legs', className: null, kind: null },
    { slot: 'undersuit', className: null, kind: null },
    { slot: 'backpack', className: null, kind: null },
  ],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};

function row(className: string, slot: ArmorRatingRow['slot'], tempMin: number, tempMax: number): ArmorRatingRow {
  return {
    className,
    slot,
    itemType: null,
    values: {
      damageReduction: null, tempMin, tempMax, radCapacity: 26800, radRate: null,
      gForce: null, mass: null, carryMicroScu: null,
    },
    pct: { protection: null, mobility: null, gForce: null, heat: null, cold: null, radiation: null, scrub: null, carry: null },
  };
}

@Component({ standalone: true, template: '' })
class ArsenalStub {}

@Component({
  standalone: true,
  imports: [CodexSetStageComponent],
  template: `<sc-codex-set-stage [set]="set" [archiveDepth]="depth" [ratingRows]="rows()" [lens]="lens()" />`,
})
class HostComponent {
  readonly set = SET;
  readonly depth = new Map([['Char_Armor_Arms', 42]]);
  readonly rows = signal<ArmorRatingRow[] | null>(null);
  readonly lens = signal<SetLensId>('all');
}

describe('CodexSetStageComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let el: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        provideRouter([{ path: 'codex/fps', component: ArsenalStub }]),
        provideLocationMocks(),
        provideTranslateService({}),
        hangarStub,
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  const tile = (slot: string) => el.querySelector<HTMLAnchorElement>(`a.tile[data-slot="${slot}"]`)!;
  const stage = () => fixture.debugElement.query(By.directive(CodexSetStageComponent)).componentInstance as CodexSetStageComponent;
  const figure = () => fixture.debugElement.query(By.directive(CodexBoardFigureComponent)).componentInstance as CodexBoardFigureComponent;

  it('renders one figure and one anchor tile per slot, left and right of it', () => {
    expect(el.querySelectorAll('sc-codex-board-figure').length).toBe(1);
    const left = Array.from(el.querySelectorAll<HTMLElement>('.col.left a.tile')).map((t) => t.dataset['slot']);
    const right = Array.from(el.querySelectorAll<HTMLElement>('.col.right a.tile')).map((t) => t.dataset['slot']);
    expect(left).toEqual(['helmet', 'core', 'arms']);
    expect(right).toEqual(['backpack', 'legs', 'undersuit']);
  });

  it('links every tile to the arsenal filtered to its slot, with the equip intent', () => {
    for (const slot of ['helmet', 'core', 'arms', 'legs', 'undersuit', 'backpack']) {
      const href = tile(slot).getAttribute('href')!;
      // One equip param for armour and weapons (L20): the set's position.
      expect(href).toContain('/codex/fps?cat=armor');
      expect(href).toContain('equipSlot=' + slot);
      expect(href).not.toContain('slot=Helmet');
      expect(href).toContain('equipInto=set-a');
    }
  });

  // L10: the slot's name is visible on every tile, not only a tooltip / sr-only text.
  it('shows the slot name visibly on every armour tile', () => {
    const keys: Record<string, string> = {
      helmet: 'codex.landing.paperdoll.helmet', core: 'codex.landing.paperdoll.torso',
      arms: 'codex.landing.paperdoll.arms', legs: 'codex.landing.paperdoll.legs',
    };
    for (const slot of ['helmet', 'core', 'arms', 'legs', 'undersuit', 'backpack']) {
      const lbl = tile(slot).querySelector<HTMLElement>('.lbl');
      expect(lbl).withContext(slot).not.toBeNull();
      expect(lbl!.classList).not.toContain('sr');
      if (keys[slot]) expect(lbl!.textContent?.trim()).toBe(keys[slot]);
      else expect(lbl!.textContent?.trim()).toBeTruthy();
    }
    expect(tile('helmet').querySelector('.ic sc-codex-icon')).not.toBeNull();
  });

  it('gives a filled tile its name (full name as label-tier tooltip) and "Change", an empty one "+ Choose"', () => {
    const helmet = tile('helmet');
    expect(helmet.querySelector('.name')?.textContent?.trim()).toBeTruthy();
    expect(helmet.querySelector('.change')?.textContent?.trim()).toBe('codex.set.gear.change');
    expect(helmet.querySelector('.cta')).toBeNull();
    const tip = fixture.debugElement.query(By.css('a.tile[data-slot="helmet"]')).injector.get(ScTooltipDirective);
    expect(tip.scTooltip()).toBe(helmet.querySelector('.name')!.textContent!.trim());
    expect(tip.scTooltipTier()).toBe('label');

    const arms = tile('arms');
    expect(arms.querySelector('.cta')?.textContent).toContain('codex.set.gear.choose');
    expect(arms.querySelector('.change')).toBeNull();
    expect(arms.querySelector('.name')).toBeNull();
  });

  it('never cuts a filled name to one line: it wraps to at most two', () => {
    const name = tile('helmet').querySelector<HTMLElement>('.name')!;
    const cs = getComputedStyle(name);
    expect(cs.whiteSpace).not.toBe('nowrap');
    expect(cs.webkitLineClamp).toBe('2');
  });

  // L21: armour gets the same clear + undo as the weapon tiles.
  it('offers a clear button beside a filled armour tile only — never inside the anchor', () => {
    const btn = el.querySelector<HTMLButtonElement>('.slot[data-slot="helmet"] button.clear');
    expect(btn).not.toBeNull();
    expect(btn!.closest('a')).toBeNull();
    expect(btn!.getAttribute('aria-label')).toBe('codex.set.gear.clearAria');
    expect(el.querySelector('.slot[data-slot="arms"] button.clear')).toBeNull();
  });

  it('clears an armour slot through the hangar service and offers undo, which puts it back', async () => {
    setSlotCalls = [];
    setSlotResult = { ...SET, items: SET.items.map((i) => (i.slot === 'helmet' ? { ...i, className: null } : i)) as RoleLoadoutItem[] };
    el.querySelector<HTMLButtonElement>('.slot[data-slot="helmet"] button.clear')!.click();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(setSlotCalls[0]).toEqual(['set-a', 'helmet', null, 'Test_Helmet']);
    const note = el.querySelector<HTMLElement>('.slot[data-slot="helmet"] .note[role="status"]');
    expect(note?.textContent).toContain('codex.set.gear.cleared');
    note!.querySelector<HTMLButtonElement>('button.undo')!.click();
    await fixture.whenStable();
    expect(setSlotCalls[1]).toEqual(['set-a', 'helmet', { className: 'Test_Helmet', kind: 'item' }, undefined]);
  });

  it('gives every readiness icon a keyboard-reachable, labelled image (AUD-119)', () => {
    const items = Array.from(el.querySelectorAll<HTMLElement>('.rdy-ic'));
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) {
      expect(item.getAttribute('role')).toBe('listitem');
      const img = item.querySelector<HTMLElement>('[role="img"]');
      expect(img).not.toBeNull();
      expect(img!.getAttribute('tabindex')).toBe('0');
      expect(img!.getAttribute('aria-label')).toBeTruthy();
    }
  });

  it('shows an open slot with its archive depth and the choose call to action', () => {
    const arms = tile('arms');
    expect(arms.classList).toContain('open');
    expect(arms.textContent).toContain('codex.landing.board.archiveCount');
    expect(arms.querySelector('.cta')?.textContent).toContain('codex.set.gear.choose');
  });

  it('lights figure part, tile and line while a tile is hovered', () => {
    tile('helmet').dispatchEvent(new Event('pointerenter'));
    fixture.detectChanges();
    expect(figure().highlight()).toBe('helmet');
    expect(tile('helmet').classList).toContain('lit');
    const line = el.querySelector('polyline.lead[data-slot="helmet"]');
    if (line) expect(line.classList).toContain('lit');

    tile('helmet').dispatchEvent(new Event('pointerleave'));
    fixture.detectChanges();
    expect(figure().highlight()).toBeNull();
  });

  it('lights the same way on keyboard focus', () => {
    tile('legs').dispatchEvent(new Event('focus'));
    fixture.detectChanges();
    expect(figure().highlight()).toBe('legs');
    tile('legs').dispatchEvent(new Event('blur'));
    fixture.detectChanges();
    expect(figure().highlight()).toBeNull();
  });

  it('lights the tile when its body part is hovered on the figure', () => {
    figure().partHover.emit('undersuit');
    fixture.detectChanges();
    expect(tile('undersuit').classList).toContain('lit');
    expect(tile('helmet').classList).not.toContain('lit');
  });

  it('draws one leader line per slot, dashed for the open ones', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
    const lines = stage().lines();
    expect(lines.length).toBe(6);
    expect(lines.find((l) => l.slot === 'arms')?.open).toBe(true);
    expect(lines.find((l) => l.slot === 'helmet')?.open).toBe(false);
  });

  it('adds the lens readout to every equipped tile once a lens is chosen', () => {
    fixture.componentInstance.rows.set([row('Test_Helmet', 'helmet', -90, 115), row('Test_Torso', 'core', -40, 60)]);
    fixture.detectChanges();
    expect(el.querySelector('.lens')).toBeNull();

    fixture.componentInstance.lens.set('env');
    fixture.detectChanges();
    expect(tile('helmet').querySelector('.lens')?.textContent).toContain('°C');
    expect(tile('core').querySelector('.lens')?.textContent).toContain('°C');
    expect(tile('arms').querySelector('.lens')).toBeNull();
  });

  it('hops into the arsenal on a plain left click only, leaving every other click to the anchor', () => {
    const hop = spyOn(TestBed.inject(SetArsenalTransition), 'hop').and.resolveTo(true);
    const helmet = tile('helmet');
    const t = stage().tiles().find((x) => x.slot === 'helmet')!;

    // Called directly: a dispatched modified click would open a real tab in Karma.
    const modified = new MouseEvent('click', { button: 0, ctrlKey: true, cancelable: true });
    stage().onTileClick(modified, t, helmet);
    expect(hop).not.toHaveBeenCalled();
    expect(modified.defaultPrevented).toBeFalse();

    const plain = new MouseEvent('click', { button: 0, cancelable: true });
    stage().onTileClick(plain, t, helmet);
    expect(plain.defaultPrevented).toBeTrue();
    expect(hop).toHaveBeenCalledTimes(1);
    const [tree, landing, source] = hop.calls.mostRecent().args;
    // The hop goes exactly where the href points.
    expect(TestBed.inject(Router).serializeUrl(tree)).toBe(helmet.getAttribute('href')!);
    expect(landing).toEqual({ slot: 'helmet', direction: 'toArsenal' });
    expect(source).toBe(helmet);
  });

  it('names the tile the returning arsenal hop lands on', () => {
    TestBed.inject(SetArsenalTransition).active.set({ slot: 'legs', direction: 'toSet' });
    fixture.detectChanges();
    expect(tile('legs').style.getPropertyValue('view-transition-name')).toBe('set-slot');
    expect(tile('helmet').style.getPropertyValue('view-transition-name')).toBe('');
  });
});

@Component({
  standalone: true,
  imports: [CodexSetStageComponent],
  template: `<sc-codex-set-stage [set]="set" [resolved]="resolved" />`,
})
class LocalizedHostComponent {
  readonly set = SET;
  readonly resolved = new Map<string, ResolvedEntity>([
    [
      'Test_Helmet',
      {
        kind: 'item',
        className: 'Test_Helmet',
        nameLocalized: null,
        name: { en: 'Field Helmet', de: 'Feldhelm', key: '@item_Name_Test_Helmet' },
        manufacturerCode: null,
        size: null,
      } as ResolvedEntity,
    ],
  ]);
}

describe('CodexSetStageComponent language and eyebrow (REQ-15, REQ-19)', () => {
  let fixture: ComponentFixture<LocalizedHostComponent>;
  let el: HTMLElement;
  let t: TranslateService;
  let instant: jasmine.Spy;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LocalizedHostComponent],
      providers: [
        provideRouter([{ path: 'codex/fps', component: ArsenalStub }]),
        provideLocationMocks(),
        provideTranslateService({ fallbackLang: 'en', lang: 'en' }),
        hangarStub,
      ],
    }).compileComponents();
    t = TestBed.inject(TranslateService);
    instant = spyOn(t, 'instant').and.callThrough();
    fixture = TestBed.createComponent(LocalizedHostComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = fixture.nativeElement;
  });

  const helmetName = () => el.querySelector('a.tile[data-slot="helmet"] .name')?.textContent?.trim();

  // AUD-118: the tile names followed the language only on a reload.
  it('re-renders the tile names on a language switch', async () => {
    expect(helmetName()).toBe('Field Helmet');
    t.use('de');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(helmetName()).toBe('Feldhelm');
    t.use('en');
    await fixture.whenStable();
    fixture.detectChanges();
    expect(helmetName()).toBe('Field Helmet');
  });

  // AUD-228: "2 / 6 armour" — the count comes from the filled slots, the total is the six armour slots.
  it('says how many of the six armour slots are filled in the eyebrow', () => {
    expect(instant).toHaveBeenCalledWith('codex.stage.armorEquipped', { filled: 2, total: 6 });
    const suffix = el.querySelector('.stage-eyebrow__suffix');
    expect(suffix?.textContent).toContain('codex.stage.armorEquipped');
  });
});
