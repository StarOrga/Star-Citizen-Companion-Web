import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexHoloPerspectivesComponent, HoloPerspectiveView } from './codex-holo-perspectives.component';

function tile(over: Partial<HoloPerspectiveView> = {}): HoloPerspectiveView {
  return {
    id: 'offensive',
    titleKey: 'codex.perspective.offensive',
    pct: 50,
    leadText: '1,200',
    leadLabelKey: 'codex.kpi.dps',
    leadShortKey: 'codex.kpi.dpsShort',
    deltaText: null,
    deltaTone: null,
    ghost: null,
    say: 'Hits harder than most.',
    subs: [
      { key: 'alpha', shortKey: 'codex.kpi.alphaShort', text: '340', ghost: null },
      { key: 'range', shortKey: 'codex.kpi.rangeShort', text: '2.1 km', ghost: null },
    ],
    ...over,
  };
}

const TILES: HoloPerspectiveView[] = [
  tile(),
  tile({ id: 'defensive', titleKey: 'codex.perspective.defensive', pct: 80, leadText: '9,000', say: 'Very sturdy.', subs: [] }),
  tile({ id: 'movement', titleKey: 'codex.perspective.movement', pct: null, leadText: null, say: 'No ranking yet.', subs: [] }),
];

describe('CodexHoloPerspectivesComponent', () => {
  function setup(inputs: Record<string, unknown> = {}): ComponentFixture<CodexHoloPerspectivesComponent> {
    TestBed.configureTestingModule({
      imports: [CodexHoloPerspectivesComponent],
      providers: [provideTranslateService({ fallbackLang: 'en' })],
    });
    const fixture = TestBed.createComponent(CodexHoloPerspectivesComponent);
    fixture.componentRef.setInput('tiles', TILES);
    fixture.componentRef.setInput('missionLabelKey', 'codex.mission.combat');
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    fixture.detectChanges();
    return fixture;
  }

  const root = (f: ComponentFixture<CodexHoloPerspectivesComponent>): HTMLElement => f.nativeElement as HTMLElement;
  const tileEl = (f: ComponentFixture<CodexHoloPerspectivesComponent>, id: string): HTMLElement =>
    root(f).querySelector<HTMLElement>(`article.ptile[data-p="${id}"]`)!;

  afterEach(() => TestBed.resetTestingModule());

  it('renders one tile per input with the tile count in the head', () => {
    const fixture = setup();
    expect(root(fixture).querySelectorAll('article.ptile').length).toBe(3);
    expect(root(fixture).querySelector('.sh .n')!.textContent).toBe('3');
  });

  it('shows the mission label in the head and the cohort size only when given', () => {
    const without = setup();
    expect(root(without).querySelector('.sh .ctx')!.textContent).toContain('codex.mission.combat');
    expect(root(without).querySelector('.sh .ctx')!.textContent).not.toContain('codex.holo.strip.shipCount');
    TestBed.resetTestingModule();

    const withCohort = setup({ cohortSize: 42 });
    expect(root(withCohort).querySelector('.sh .ctx')!.textContent).toContain('codex.holo.strip.shipCount');
  });

  it('shows the headline value, its label and the reading line from the input', () => {
    const el = tileEl(setup(), 'offensive');
    expect(el.querySelector('.big .num')!.textContent).toBe('1,200');
    expect(el.querySelector('.big small')!.textContent).toContain('codex.kpi.dps');
    expect(el.querySelector('.say')!.textContent).toBe('Hits harder than most.');
    expect(el.querySelector('.pt-head .pp')!.textContent).toBe('P50');
  });

  it('draws the gauge from the percentile: label, arc length and text', () => {
    const el = tileEl(setup(), 'defensive');
    const gauge = el.querySelector('.gauge')!;
    expect(gauge.getAttribute('aria-label')).toContain('codex.holo.stage.percentileAria');
    expect(gauge.querySelector('text.p')!.textContent).toBe('P80');
    const circumference = 2 * Math.PI * 36;
    const [on, rest] = gauge.querySelector('circle.va')!.getAttribute('stroke-dasharray')!.split(' ').map(Number);
    expect(on).toBeCloseTo(0.8 * circumference, 0);
    expect(on + rest).toBeCloseTo(circumference, 0);
  });

  it('clamps the arc for out-of-range percentiles', () => {
    const fixture = setup();
    expect(fixture.componentInstance.ringDash(150)).toBe(fixture.componentInstance.ringDash(100));
    expect(fixture.componentInstance.ringDash(-5)).toBe(fixture.componentInstance.ringDash(0));
  });

  it('renders the sub-lines with their short labels and values', () => {
    const fixture = setup();
    const subs = Array.from(tileEl(fixture, 'offensive').querySelectorAll('.subs .sv'));
    expect(subs.map((s) => s.querySelector('.k')!.textContent)).toEqual(['codex.kpi.alphaShort', 'codex.kpi.rangeShort']);
    expect(subs.map((s) => s.querySelector('.v')!.textContent)).toEqual(['340', '2.1 km']);
    expect(tileEl(fixture, 'defensive').querySelector('.subs')).toBeNull();
  });

  it('a tile without a rank has no gauge and shows the gap placeholder', () => {
    const el = tileEl(setup(), 'movement');
    expect(el.querySelector('.gauge')).toBeNull();
    expect(el.querySelector('.pt-head .pp')).toBeNull();
    expect(el.querySelector('.big.gap .num')!.textContent).toBe('—');
    expect(el.querySelector('.pt-main')!.classList).toContain('no-gauge');
  });

  it('shows a patch ghost beside the value and on a sub-line', () => {
    const ghost = { patch: '4.9', text: '+12', tone: 'up' as const };
    const fixture = setup({
      tiles: [
        tile({
          ghost,
          deltaText: '+5%',
          deltaTone: 'up',
          subs: [{ key: 'alpha', shortKey: 'codex.kpi.alphaShort', text: '340', ghost: { patch: '4.9', text: '-3', tone: 'down' } }],
        }),
      ],
    });
    const el = tileEl(fixture, 'offensive');
    expect(el.querySelector('.big .ghost')!.textContent).toContain('4.9 · +12');
    expect(el.querySelector('.big .d')!.textContent).toBe('+5%');
    expect(el.querySelector('.big .d')!.classList).toContain('up');
    expect(el.querySelector('.sv.ghosted .gv')!.textContent).toBe('-3');
  });

  it('pulses only the tile named by the pulse input', () => {
    const fixture = setup({ pulse: 'defensive' });
    expect(tileEl(fixture, 'defensive').classList).toContain('pulse');
    expect(tileEl(fixture, 'offensive').classList).not.toContain('pulse');
  });

  it('"all values" toggles the full analysis panel of that tile', () => {
    const fixture = setup({ offensivePanel: null, defensivePanel: null });
    const off = tileEl(fixture, 'offensive');
    const btn = off.querySelector<HTMLButtonElement>('.tile-expand')!;
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(off.querySelector('sc-codex-offensive-panel')).toBeNull();

    btn.click();
    fixture.detectChanges();
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(btn.textContent).toContain('codex.holo.stage.allValuesHide');
    expect(off.querySelector('sc-codex-offensive-panel')).not.toBeNull();
    expect(tileEl(fixture, 'defensive').querySelector('sc-codex-defensive-panel')).toBeNull();

    btn.click();
    fixture.detectChanges();
    expect(off.querySelector('sc-codex-offensive-panel')).toBeNull();
    expect(btn.textContent).not.toContain('codex.holo.stage.allValuesHide');
    expect(btn.textContent).toContain('codex.holo.stage.allValues');
  });
});
