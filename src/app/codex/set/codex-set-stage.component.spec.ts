import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router, provideRouter } from '@angular/router';
import { provideLocationMocks } from '@angular/common/testing';
import { provideTranslateService } from '@ngx-translate/core';

import { CodexSetStageComponent } from './codex-set-stage.component';
import { CodexBoardFigureComponent } from '../codex-board-figure.component';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';
import { HangarRoleLoadout } from '../../hangar/hangar.types';
import { ArmorRatingRow, SetLensId } from './set-rating';
import { SetArsenalTransition } from './set-arsenal-transition';

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
      expect(href).toContain('/codex/fps?cat=armor&slot=');
      expect(href).toContain('equipInto=set-a');
    }
  });

  it('names the slot only in the tooltip (label tier), with the part icon before the item name', () => {
    const de = fixture.debugElement.query(By.css('a.tile[data-slot="helmet"]'));
    const tip = de.injector.get(ScTooltipDirective);
    expect(tip.scTooltip()).toBe('codex.landing.paperdoll.helmet');
    expect(tip.scTooltipTier()).toBe('label');
    expect(tile('helmet').querySelector('.ic sc-codex-icon')).not.toBeNull();
    expect(tile('helmet').querySelector('.name')?.textContent?.trim()).toBeTruthy();
  });

  it('shows an open slot as "Frei" with its archive depth and the arsenal call to action', () => {
    const arms = tile('arms');
    expect(arms.classList).toContain('open');
    expect(arms.textContent).toContain('codex.set.stage.free');
    expect(arms.textContent).toContain('codex.landing.board.archiveCount');
    expect(arms.querySelector('.cta')?.textContent).toContain('codex.set.equipInArchive');
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
