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
