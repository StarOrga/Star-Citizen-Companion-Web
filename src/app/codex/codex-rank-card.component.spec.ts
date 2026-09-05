import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexRankCardComponent } from './codex-rank-card.component';
import { rankShip, RankShipInput } from './codex-rank';

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

  it('disables a profile chip with its reason as the title', () => {
    fixture.componentRef.setInput('disabledReasons', { transport: 'codex.rank.disabled.noCargo' });
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const chip = Array.from(el.querySelectorAll('.profile-chip')).find((b) => b.getAttribute('title') === 'codex.rank.disabled.noCargo');
    expect(chip).toBeTruthy();
    expect((chip as HTMLButtonElement).disabled).toBeTrue();
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
