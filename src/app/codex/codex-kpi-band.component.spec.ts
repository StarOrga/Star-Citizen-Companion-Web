import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { CodexKpiBandComponent } from './codex-kpi-band.component';
import { KpiCell } from './codex-loadout-stats';

describe('CodexKpiBandComponent', () => {
  let fixture: ComponentFixture<CodexKpiBandComponent>;

  const cells: KpiCell[] = [
    { key: 'alpha', labelKey: 'codex.kpi.alpha', format: 'dec', value: 120, delta: null, accent: true, gapKey: null },
    { key: 'burstDps', labelKey: 'codex.kpi.burstDps', format: 'perSec', value: null, delta: null, accent: false, gapKey: 'codex.summary.gap.noFireRate' },
    { key: 'sustainedDps', labelKey: 'codex.kpi.sustainedDps', format: 'perSec', value: null, delta: null, accent: false, gapKey: 'codex.summary.gap.noFireRate' },
    { key: 'missiles', labelKey: 'codex.kpi.missiles', format: 'dec', value: null, delta: null, accent: false, gapKey: 'codex.summary.gap.noMissiles' },
    {
      key: 'shieldHp',
      labelKey: 'codex.kpi.shieldHp',
      format: 'int',
      value: 1200,
      delta: { direction: 'up', good: true, pctText: '+20%', raw: 200 },
      accent: false,
      gapKey: null,
    },
    { key: 'shieldRegen', labelKey: 'codex.kpi.shieldRegen', format: 'perSec', value: 60, delta: null, accent: false, gapKey: null },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodexKpiBandComponent, TranslateModule.forRoot()],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexKpiBandComponent);
    fixture.componentRef.setInput('cells', cells);
    fixture.detectChanges();
  });

  it('renders exactly six cells', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.kpi-cell').length).toBe(6);
  });

  it('marks the mission lead metric as the accent cell', () => {
    const el: HTMLElement = fixture.nativeElement;
    const accents = el.querySelectorAll('.kpi-cell.accent');
    expect(accents.length).toBe(1);
    expect(accents[0].textContent).toContain('120');
  });

  it('renders a gap dash with a title tooltip when the value is absent', () => {
    const el: HTMLElement = fixture.nativeElement;
    const gapCell = el.querySelectorAll('.kpi-cell.gap')[0];
    const dash = gapCell.querySelector('.gap-dash')!;
    expect(dash.textContent?.trim()).toBe('—');
    expect(dash.getAttribute('title')).toBe('codex.summary.gap.noFireRate');
  });

  it('shows the delta chip only for cells that have one', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelectorAll('.kpi-delta').length).toBe(1);
    expect(el.querySelector('.kpi-delta.good')).toBeTruthy();
  });

  it('renders a focusable info tooltip only for cells that carry a tooltip key', () => {
    fixture.componentRef.setInput('cells', [
      { ...cells[1], tooltipKey: 'codex.kpi.tooltipBurstDps', lowerIsBetter: false, fromPower: false },
      { ...cells[4], tooltipKey: null, lowerIsBetter: false, fromPower: false },
    ]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const infos = el.querySelectorAll('.kpi-info');
    expect(infos.length).toBe(1);
    expect(infos[0].getAttribute('tabindex')).toBe('0');
    expect(infos[0].getAttribute('aria-describedby')).toBe('kpi-tip-' + cells[1].key);
  });

  it('marks a cell the energy dock rewrote', () => {
    fixture.componentRef.setInput('cells', [{ ...cells[1], tooltipKey: null, lowerIsBetter: false, fromPower: true }]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.kpi-cell.from-power')).toBeTruthy();
  });
});
