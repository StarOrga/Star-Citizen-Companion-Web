import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexRankCardComponent } from './codex-rank-card.component';
import { rankShip, RankShipInput } from './codex-rank';
import { ScTooltipDirective } from '../shared/tooltip/sc-tooltip.directive';

describe('CodexRankCardComponent', () => {
  let fixture: ComponentFixture<CodexRankCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodexRankCardComponent],
      providers: [provideTranslateService({})],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexRankCardComponent);
    fixture.componentRef.setInput('shipName', 'Nomad');
  });

  it('renders the honest gap state when no cohort result is available yet', () => {
    fixture.componentRef.setInput('result', null);
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.gap-note')).toBeTruthy();
    expect(el.querySelector('.radar')).toBeNull();
    expect(el.querySelector('.rank-skel')).toBeNull();
  });

  it('shows a loading skeleton instead of a gap note while fetching', () => {
    fixture.componentRef.setInput('result', null);
    fixture.componentRef.setInput('loading', true);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.rank-skel')).toBeTruthy();
    expect(el.querySelector('.gap-note')).toBeNull();
  });

  it('renders the radar and a sorted bar per axis once a result is present', () => {
    const target: RankShipInput = { className: 'CNOU_Nomad', sizeClass: 1, career: null, sheet: { alpha: 100 } };
    const cohort: RankShipInput[] = [
      target,
      { className: 'AEGS_Avenger', sizeClass: 1, career: null, sheet: { alpha: 200 } },
    ];
    const result = rankShip(target, cohort, { profile: 'combat', scope: 'sizeClass' });
    fixture.componentRef.setInput('result', result);
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('svg.radar')).toBeTruthy();
    expect(el.querySelectorAll('.bar-row').length).toBe(result.axes.length);
  });

  it('paints an axis where the ship trails its comparison in the warning colour, never in the error colour', () => {
    const target: RankShipInput = { className: 'CNOU_Nomad', sizeClass: 1, career: null, sheet: { alpha: 100, sustainedDps: 900, missiles: 4, shieldHp: 900, agility: 90, boost: 900 } };
    const cohort: RankShipInput[] = [
      target,
      { className: 'AEGS_Avenger', sizeClass: 1, career: null, sheet: { alpha: 200, sustainedDps: 100, missiles: 1, shieldHp: 100, agility: 10, boost: 100 } },
      { className: 'AEGS_Gladius', sizeClass: 1, career: null, sheet: { alpha: 300, sustainedDps: 200, missiles: 2, shieldHp: 200, agility: 20, boost: 200 } },
    ];
    fixture.componentRef.setInput('result', rankShip(target, cohort, { profile: 'combat', scope: 'all' }));
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    // A token as the browser resolves it (styles.scss is part of the test build).
    const resolved = (token: string): string => {
      const probe = document.createElement('span');
      probe.style.color = `var(${token})`;
      document.body.appendChild(probe);
      const color = getComputedStyle(probe).color;
      probe.remove();
      return color;
    };
    const warning = resolved('--sc-warning');
    expect(warning).not.toBe(resolved('--sc-danger'));

    const behind = el.querySelector<SVGLineElement>('.radar .connector.down');
    const behindCaption = el.querySelector<SVGTextElement>('.radar text.down');
    expect(behind).withContext('alpha trails the median').toBeTruthy();
    expect(behindCaption).withContext('alpha caption').toBeTruthy();
    expect(getComputedStyle(behind!).stroke).toBe(warning);
    expect(getComputedStyle(behindCaption!).fill).toBe(warning);
    expect(el.querySelector('.radar .connector.up')).withContext('the other axes lead').toBeTruthy();
    // The old fixed 50 % ring and the unexplained weakest-axis dot are gone.
    expect(el.querySelector('.radar .weak-axis')).toBeNull();
    expect(el.querySelector('.radar .median')).toBeNull();
    expect(el.querySelector('.radar .compare')).toBeTruthy();
  });

  it('disables a profile chip with its reason as an app tooltip', () => {
    fixture.componentRef.setInput('disabledReasons', { transport: 'codex.rank.disabled.noCargo' });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const chip = Array.from(el.querySelectorAll('.profile-chip')).find(
      (b) => (b as HTMLButtonElement).disabled,
    ) as HTMLButtonElement;
    expect(chip).toBeTruthy();
    // A disabled button gets no pointer events, so the tooltip sits on the
    // wrapping span instead — find it via the directive, not the `title` attribute.
    const wrap = fixture.debugElement
      .queryAll(By.directive(ScTooltipDirective))
      .find((de) => de.nativeElement.contains(chip));
    expect(wrap).toBeTruthy();
    expect(wrap!.injector.get(ScTooltipDirective).scTooltip()).toBe('codex.rank.disabled.noCargo');
  });

  it('offers the comparison group as a segmented control; a group without data stays visible but disabled with its reason', () => {
    const target: RankShipInput = { className: 'CNOU_Nomad', sizeClass: null, career: null, role: 'Light Freight', sheet: { alpha: 100 } };
    const cohort: RankShipInput[] = [
      target,
      { className: 'AEGS_Avenger', sizeClass: null, career: 'Combat', role: 'Light Fighter', sheet: { alpha: 200 } },
    ];
    fixture.componentRef.setInput('result', rankShip(target, cohort, { profile: 'combat', scope: 'all' }));
    fixture.componentRef.setInput('scope', 'all');
    const emitted: string[] = [];
    fixture.componentInstance.scopeChange.subscribe((v) => emitted.push(v));
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('select')).toBeNull();
    expect(el.querySelector('.compare-head sc-segmented')).not.toBeNull();
    const segs = Array.from(el.querySelectorAll<HTMLButtonElement>('.compare-head .seg-btn'));
    expect(segs.map((b) => b.textContent!.trim())).toEqual(['codex.rank.scope.all', 'codex.rank.scope.career', 'codex.rank.scope.role']);
    expect(segs[1].getAttribute('aria-disabled')).toBe('true');
    expect(segs[2].getAttribute('aria-disabled')).toBeNull();
    const tip = fixture.debugElement
      .queryAll(By.directive(ScTooltipDirective))
      .find((de) => de.nativeElement === segs[1]);
    expect(tip!.injector.get(ScTooltipDirective).scTooltip()).toBe('codex.rank.disabled.noCareer');

    segs[1].click();
    expect(emitted).toEqual([]);
    segs[2].click();
    expect(emitted).toEqual(['role']);
  });

  it('keeps the legend visible in the Holotable variant', () => {
    const target: RankShipInput = { className: 'CNOU_Nomad', sizeClass: null, career: null, sheet: { alpha: 100, sustainedDps: 1, missiles: 1 } };
    const other: RankShipInput = { className: 'AEGS_Avenger', sizeClass: null, career: null, sheet: { alpha: 200, sustainedDps: 2, missiles: 2 } };
    fixture.componentRef.setInput('holo', true);
    fixture.componentRef.setInput('result', rankShip(target, [target, other], { profile: 'combat', scope: 'all' }));
    fixture.detectChanges();
    const legend = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('.legend');
    expect(legend).toBeTruthy();
    expect(getComputedStyle(legend!).display).not.toBe('none');
    expect(legend!.textContent).toContain('codex.rank.legend.better');
    expect(legend!.textContent).toContain('codex.rank.legend.worse');
  });
});

describe('CodexRankCardComponent - a gap axis is never invented', () => {
  let fixture: ComponentFixture<CodexRankCardComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodexRankCardComponent],
      providers: [provideTranslateService({})],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexRankCardComponent);
    fixture.componentRef.setInput('shipName', 'Nomad');
  });

  /** A cohort where `alpha` is present on every ship but `shieldHp` exists on
   * nobody, so the shield axis can never be ranked. */
  function resultWithAnUnrankableAxis() {
    const target: RankShipInput = {
      className: 'CNOU_Nomad', sizeClass: 1, career: null,
      sheet: { alpha: 100, sustainedDps: 200 },
    };
    const cohort: RankShipInput[] = [
      target,
      { className: 'AEGS_Avenger', sizeClass: 1, career: null, sheet: { alpha: 200, sustainedDps: 100 } },
    ];
    return rankShip(target, cohort, { profile: 'combat', scope: 'sizeClass' });
  }

  it('gives an unranked axis no vertex instead of drawing the median there', () => {
    const result = resultWithAnUnrankableAxis();
    const ranked = result.axes.filter((a) => a.percentile != null).length;
    const gaps = result.axes.length - ranked;
    expect(gaps).toBeGreaterThan(0); // the fixture must actually exercise a gap
    fixture.componentRef.setInput('result', result);
    fixture.detectChanges();

    expect(fixture.componentInstance.rankedAxisCount()).toBe(ranked);
    const pts = fixture.componentInstance.shipPolygonPoints();
    if (ranked >= 3) {
      expect(pts.split(' ').length).toBe(ranked);
    } else {
      expect(pts).toBe('');
      expect(fixture.nativeElement.querySelector('polygon.ship')).toBeNull();
    }
  });

  it('never places a vertex outside the ring for an out-of-range percentile', () => {
    const v = fixture.componentInstance.vertexAt(140, 0, 6).split(',').map(Number);
    const r = Math.hypot(v[0] - 100, v[1] - 100);
    expect(r).toBeLessThanOrEqual(80.01);
  });
});
