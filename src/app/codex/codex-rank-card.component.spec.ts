import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexRankCardComponent } from './codex-rank-card.component';
import { rankShip, RankResult, RankShipInput } from './codex-rank';
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

  it('says why there is nothing to rank when the page passes a reason', () => {
    fixture.componentRef.setInput('result', null);
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.gap-note')?.textContent?.trim()).toBe('codex.rank.gapAxis');
    fixture.componentRef.setInput('gapKey', 'codex.missile.rank.gapNoData');
    fixture.detectChanges();
    expect(el.querySelector('.gap-note')?.textContent?.trim()).toBe('codex.missile.rank.gapNoData');
  });

  it('keeps the group bar when the picked group has nothing to compare, so the way back stays (#331)', () => {
    fixture.componentRef.setInput('result', null);
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('scope', 'sizeClass');
    fixture.componentRef.setInput('scopes', [
      { id: 'all', labelKey: 'codex.missile.scope.all', reasonKey: '' },
      { id: 'sizeClass', labelKey: 'codex.missile.scope.size', reasonKey: 'codex.missile.scopeOff' },
    ]);
    const emitted: string[] = [];
    fixture.componentInstance.scopeChange.subscribe((v) => emitted.push(v));
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.gap-note')).toBeTruthy();
    const segs = Array.from(el.querySelectorAll<HTMLButtonElement>('.compare-head .seg-btn'));
    expect(segs.map((b) => b.textContent!.trim())).toEqual(['codex.missile.scope.all', 'codex.missile.scope.size']);
    segs[0].click();
    expect(emitted).toEqual(['all']);
  });

  it('names a group by the page’s own label when it passes one (#331)', () => {
    fixture.componentRef.setInput('result', null);
    fixture.componentRef.setInput('loading', false);
    fixture.componentRef.setInput('scopes', [
      { id: 'all', labelKey: 'codex.missile.scope.all', label: 'Alle Lenkraketen', reasonKey: '' },
      { id: 'sizeClass', labelKey: 'codex.missile.scope.size', label: 'Alle S2-Lenkraketen', reasonKey: 'codex.missile.scopeOff' },
    ]);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const segs = Array.from(el.querySelectorAll<HTMLButtonElement>('.compare-head .seg-btn'));
    expect(segs.map((b) => b.textContent!.trim())).toEqual(['Alle Lenkraketen', 'Alle S2-Lenkraketen']);
    expect(fixture.componentInstance.activeScopeLabel()).toBe('Alle Lenkraketen');
  });

  it('says "not enough" in place of the verdict for a thin group and keeps bar and bars (#331)', () => {
    const target: RankShipInput = { className: 'CNOU_Nomad', sizeClass: 1, career: null, sheet: { alpha: 100 } };
    const other: RankShipInput = { className: 'AEGS_Avenger', sizeClass: 1, career: null, sheet: { alpha: 200 } };
    const ranked = rankShip(target, [target, other], { profile: 'combat', scope: 'sizeClass' });
    fixture.componentRef.setInput('result', { ...ranked, overall: null, band: null, bandKey: null, thinKey: 'codex.missile.rank.gapThinGroup' });
    fixture.componentRef.setInput('loading', false);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.verdict.thin')?.textContent?.trim()).toBe('codex.missile.rank.gapThinGroup');
    expect(el.querySelector('.compare-head sc-segmented')).not.toBeNull();
    expect(el.querySelectorAll('.bar-row').length).toBe(ranked.bars.length);
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
    expect(behind, 'alpha trails the median').toBeTruthy();
    expect(behindCaption, 'alpha caption').toBeTruthy();
    expect(getComputedStyle(behind!).stroke).toBe(warning);
    expect(getComputedStyle(behindCaption!).fill).toBe(warning);
    expect(el.querySelector('.radar .connector.up'), 'the other axes lead').toBeTruthy();
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

  it('the classic card with holoContent says what the Holotable says, in its own layout (#329)', () => {
    const target: RankShipInput = { className: 'CNOU_Nomad', sizeClass: null, career: null, sheet: { alpha: 100, sustainedDps: 1, missiles: 1 } };
    const other: RankShipInput = { className: 'AEGS_Avenger', sizeClass: null, career: null, sheet: { alpha: 200, sustainedDps: 2, missiles: 2 } };
    fixture.componentRef.setInput('holoContent', true);
    fixture.componentRef.setInput('shipClass', 'combat');
    fixture.componentRef.setInput('roleName', 'Leichter Jäger');
    fixture.componentRef.setInput('result', rankShip(target, [target, other], { profile: 'combat', scope: 'all' }));
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // Classic layout: card chrome, header, verdict row and profile chips stay.
    expect(el.querySelector('.rank-card.sc-card')).toBeTruthy();
    expect(el.querySelector('h2')).toBeTruthy();
    expect(el.querySelector('.profile-row')).toBeTruthy();
    // Holotable content: cohort label, group names, rim note, "Besser als n %".
    expect(el.querySelector('.cohort-line')?.textContent?.trim()).toBe('codex.holo.strip.shipCount');
    expect(el.querySelector('.rim-note')?.textContent?.trim()).toBe('codex.rank.rimNote');
    expect(el.querySelector('.bar-pct')?.textContent?.trim()).toBe('codex.rank.betterThan');
    expect(fixture.componentInstance.compareInfoKey()).toBe('codex.rank.compare.infoHolo');
    const segs = Array.from(el.querySelectorAll('.compare-head .seg-btn')).map((b) => b.textContent?.trim());
    expect(segs).toContain('codex.rank.group.of');
  });

  it('the classic card shows the small-group hint as a tooltip marker, never as a block line (#329)', () => {
    const target: RankShipInput = { className: 'CNOU_Nomad', sizeClass: 1, career: null, sheet: { alpha: 100, sustainedDps: 1, missiles: 1 } };
    const other: RankShipInput = { className: 'AEGS_Avenger', sizeClass: 1, career: null, sheet: { alpha: 200, sustainedDps: 2, missiles: 2 } };
    const base = rankShip(target, [target, other], { profile: 'combat', scope: 'all' });
    fixture.componentRef.setInput('holoContent', true);
    fixture.componentRef.setInput('shipClass', 'combat');
    fixture.componentRef.setInput('result', { ...base, scope: 'all', scopeSizes: { all: 2, sizeClass: 2 } });
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    // No small group: the marker's slot is reserved but invisible.
    const slot = el.querySelector<HTMLElement>('.compare-head .small-group-mark');
    expect(slot?.classList.contains('slot')).toBe(true);
    expect(getComputedStyle(slot!).visibility).toBe('hidden');
    // The live region is mounted up front (so it announces later) but says nothing yet.
    expect(el.querySelector('.compare-head [role="status"]')?.textContent?.trim()).toBe('');
    const slotBox = slot!.getBoundingClientRect();

    fixture.componentRef.setInput('result', { ...base, scope: 'sizeClass', scopeSizes: { all: 2, sizeClass: 2 } });
    fixture.detectChanges();
    expect(el.querySelector('.small-group')).toBeNull();
    const mark = el.querySelector<HTMLElement>('.compare-head button.small-group-mark');
    expect(mark).toBeTruthy();
    expect(mark!.getAttribute('aria-label')).toBe('codex.rank.group.smallHint');
    expect(el.querySelector('.compare-head [role="status"]')?.textContent?.trim()).toBe('codex.rank.group.smallHint');
    // The marker takes exactly the reserved slot's box: nothing beside it moves.
    expect(mark!.getBoundingClientRect().width).toBe(slotBox.width);
    expect(mark!.getBoundingClientRect().height).toBe(slotBox.height);
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

  it('the holotable draws a square-root radius, the classic card a linear one', () => {
    const radius = () => {
      const v = fixture.componentInstance.vertexAt(4, 0, 6).split(',').map(Number);
      return Math.hypot(v[0] - 100, v[1] - 100);
    };
    expect(radius()).toBeCloseTo(3.2, 1);
    fixture.componentRef.setInput('holo', true);
    expect(radius()).toBeCloseTo(16, 1);
    const rim = fixture.componentInstance.vertexAt(100, 0, 6).split(',').map(Number);
    expect(Math.hypot(rim[0] - 100, rim[1] - 100)).toBeCloseTo(80, 1);
  });

  describe('another kind than a ship', () => {
    const axisOf = (key: string) => ({
      key,
      labelKey: 'x.' + key,
      lowerIsBetter: false,
      value: 1,
      percentile: 60,
      medianValue: 1,
      cohortCount: 3,
      weak: false,
      gapKey: null,
      norm: 50,
      compareNorm: 40,
      delta: 10,
    });
    const result = (keys: string[]): RankResult<string> => {
      const axes = keys.map(axisOf);
      return {
        profileId: 'combat',
        scope: 'sizeClass',
        scopeFallbackKey: null,
        cohortSize: 4,
        axes,
        bars: axes,
        overall: 60,
        band: 'mid',
        bandKey: 'codex.rank.band.mid',
        scopeAvailable: { all: true, career: true, role: true, sizeClass: true },
      };
    };

    function render(keys: string[]): HTMLElement {
      const f = TestBed.createComponent(CodexRankCardComponent);
      f.componentRef.setInput('shipName', 'Rattler');
      f.componentRef.setInput('sizeClass', 2);
      f.componentRef.setInput('profiles', []);
      f.componentRef.setInput('scopes', [{ id: 'sizeClass', labelKey: 'x.scope', reasonKey: '' }]);
      f.componentRef.setInput('copy', {
        cohort: { sizeClass: 'x.cohort', all: 'x.all' },
        verdict: 'x.verdict',
        percentileTooltip: 'x.tip',
        radarAria: 'x.aria',
        legendCompare: 'x.compare',
        legendBetter: 'x.up',
        legendWorse: 'x.down',
        compareInfo: 'x.info',
        note: 'x.note',
      });
      f.componentRef.setInput('result', result(keys));
      f.detectChanges();
      return f.nativeElement as HTMLElement;
    }

    it('shows its own wording and no ship profile chips', () => {
      const el = render(['size', 'length', 'width']);
      expect(el.querySelector('.profile-row')).toBeNull();
      expect(el.querySelector('.cohort-line')?.textContent).toContain('x.cohort');
      expect(el.querySelector('.verdict')?.textContent).toContain('x.verdict');
      expect(el.querySelector('.lens-note')?.textContent).toContain('x.note');
    });

    it('draws no radar below three axes, the bars stay', () => {
      const el = render(['length', 'width']);
      expect(el.querySelector('.rank-col-radar')).toBeNull();
      expect(el.querySelectorAll('.bar-row').length).toBe(2);
    });
  });
});
