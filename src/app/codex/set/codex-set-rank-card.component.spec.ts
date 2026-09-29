import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexSetRankCardComponent } from './codex-set-rank-card.component';
import { ArmorRatingRow } from './set-rating';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';

function row(partial: Partial<ArmorRatingRow> & { slot: ArmorRatingRow['slot'] }): ArmorRatingRow {
  return {
    className: `Test_${partial.slot}`,
    itemType: null,
    values: {
      damageReduction: null,
      tempMin: null,
      tempMax: null,
      radCapacity: null,
      radRate: null,
      gForce: null,
      mass: null,
      carryMicroScu: null,
    },
    pct: {
      protection: null,
      mobility: null,
      gForce: null,
      heat: null,
      cold: null,
      radiation: null,
      scrub: null,
      carry: null,
    },
    ...partial,
  };
}

describe('CodexSetRankCardComponent', () => {
  let fixture: ComponentFixture<CodexSetRankCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodexSetRankCardComponent],
      providers: [provideTranslateService({})],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexSetRankCardComponent);
  });

  it('renders the honest unavailable state when rows is null', () => {
    fixture.componentRef.setInput('rows', null);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('codex.setRank.unavailable');
    expect(el.querySelector('.radar')).toBeNull();
  });

  it('tells an empty set apart from missing values: nothing is equipped yet', () => {
    fixture.componentRef.setInput('rows', []);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.textContent).toContain('codex.setRank.empty');
    expect(el.textContent).not.toContain('codex.setRank.unavailable');
    expect(el.querySelector('.radar')).toBeNull();
  });

  it('shows a loading skeleton instead of the unavailable text while fetching', () => {
    fixture.componentRef.setInput('rows', null);
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.rank-skel')).toBeTruthy();
    expect(el.textContent).not.toContain('codex.setRank.unavailable');
  });

  it('renders a radar and bar list once rows are present, with permanent gaps drawn as gaps', () => {
    const rows: ArmorRatingRow[] = [
      row({ slot: 'core', itemType: 'Heavy Armor', values: { damageReduction: 20, tempMin: null, tempMax: null, radCapacity: null, radRate: null, gForce: 0.1, mass: 5, carryMicroScu: null }, pct: { protection: 80, mobility: 40, gForce: 60, heat: null, cold: null, radiation: null, scrub: null, carry: null } }),
    ];
    fixture.componentRef.setInput('rows', rows);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('svg.radar')).toBeTruthy();
    const gapRows = Array.from(el.querySelectorAll('.bar-row.gap-row'));
    expect(gapRows.length).toBeGreaterThan(0); // stealth/activeScan/eva are permanent gaps
    gapRows.forEach((r) => {
      expect(r.querySelector('.bar-fill')).toBeNull();
      expect(r.querySelector('.bar-gap-hatch')).toBeTruthy();
      // AUD-119: the hatch is decoration, the dash carries the reason and is keyboard-reachable.
      expect(r.querySelector('.bar-gap-hatch')!.getAttribute('aria-hidden')).toBe('true');
      const dash = r.querySelector('.gap-dash')!;
      expect(dash.getAttribute('tabindex')).toBe('0');
      expect(dash.getAttribute('role')).toBe('img');
      expect(dash.getAttribute('aria-label')).toBe('codex.setRank.gap.noData');
    });
  });

  it('marks a weak axis (below the weak threshold) with the warning class', () => {
    const rows: ArmorRatingRow[] = [
      row({ slot: 'core', pct: { protection: 10, mobility: null, gForce: null, heat: null, cold: null, radiation: null, scrub: null, carry: null } }),
    ];
    fixture.componentRef.setInput('rows', rows);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.bar-fill.weak')).toBeTruthy();
  });

  it('switches the profile and re-ranks against a different axis set', () => {
    const rows: ArmorRatingRow[] = [
      row({ slot: 'undersuit', values: { damageReduction: null, tempMin: -10, tempMax: 60, radCapacity: 100, radRate: 0.5, gForce: null, mass: null, carryMicroScu: 500 }, pct: { protection: null, mobility: null, gForce: null, heat: 70, cold: 30, radiation: 55, scrub: 45, carry: 65 } }),
    ];
    fixture.componentRef.setInput('rows', rows);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const chips = Array.from(el.querySelectorAll('.profile-chip')) as HTMLButtonElement[];
    expect(chips.length).toBe(2);
    chips[1].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.profile()).toBe('env');
    expect(el.querySelectorAll('.bar-row').length).toBe(5); // env profile has 5 axes
  });

  it('names the limiting armour piece by its resolved name, not the raw class name', () => {
    const rows: ArmorRatingRow[] = [
      row({ className: 'Armor_TCS_Core', slot: 'core', values: { tempMax: 115 } as ArmorRatingRow['values'], pct: { heat: 70 } as ArmorRatingRow['pct'] }),
      row({ className: 'Armor_TCS_Undersuit', slot: 'undersuit', values: { tempMax: 60 } as ArmorRatingRow['values'], pct: { heat: 20 } as ArmorRatingRow['pct'] }),
    ];
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('names', new Map([
      ['Armor_TCS_Undersuit', { kind: 'item' as const, className: 'Armor_TCS_Undersuit', nameLocalized: 'TCS Undersuit', name: { en: 'TCS Undersuit', de: 'TCS-Unteranzug', key: 'item_Name_TCS' } }],
    ]));
    fixture.detectChanges();
    fixture.componentInstance.profile.set('env');
    fixture.detectChanges();
    expect(fixture.componentInstance.result()?.noteParams['item']).toBe('TCS Undersuit');
    // Without a resolved entity the class name is at least humanized, never raw.
    fixture.componentRef.setInput('names', new Map());
    fixture.detectChanges();
    expect(fixture.componentInstance.result()?.noteParams['item']).not.toBe('Armor_TCS_Undersuit');
  });

  it('offers the gap reason as an app tooltip on a gap row, not a native title', () => {
    const rows: ArmorRatingRow[] = [row({ slot: 'core' })];
    fixture.componentRef.setInput('rows', rows);
    fixture.detectChanges();
    const gapHatch = fixture.debugElement.query(By.directive(ScTooltipDirective));
    expect(gapHatch).toBeTruthy();
    expect(gapHatch.injector.get(ScTooltipDirective).scTooltip()).toBe('codex.setRank.gap.noData');
  });
});
