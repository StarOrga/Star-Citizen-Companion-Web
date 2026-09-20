import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexHoloPatchDeltaComponent } from './codex-holo-patch-delta.component';
import { PerspectiveDelta, KpiCellDelta } from '../codex-build-compare';

function cell(key: string, from: number | null, to: number | null, delta: KpiCellDelta['delta']): KpiCellDelta {
  return { key: key as KpiCellDelta['key'], from, to, delta, changed: delta !== null };
}

describe('CodexHoloPatchDeltaComponent', () => {
  let fixture: ComponentFixture<CodexHoloPatchDeltaComponent>;

  function render(group: PerspectiveDelta): HTMLElement {
    fixture.componentRef.setInput('group', group);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodexHoloPatchDeltaComponent],
      providers: [provideTranslateService({})],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexHoloPatchDeltaComponent);
  });

  it('renders "no change" and zero rows when every cell delta is null (±0 renders nothing)', () => {
    const group: PerspectiveDelta = {
      perspective: 'offensive',
      cells: [cell('alpha', 100, 100, null), cell('burstDps', null, null, null)],
      changedCount: 0,
    };
    const el = render(group);
    expect(el.querySelectorAll('tbody tr').length).toBe(0);
    expect(el.querySelector('.none')).toBeTruthy();
  });

  it('renders exactly the cells with a non-null delta, skipping the ±0/gap ones', () => {
    const group: PerspectiveDelta = {
      perspective: 'defensive',
      cells: [
        cell('shieldHp', 100, 100, null),
        cell('hullHp', 100, 120, { direction: 'up', good: true, pctText: '+20%', raw: 20 }),
      ],
      changedCount: 1,
    };
    const el = render(group);
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].classList.contains('up')).toBeTrue();
    expect(rows[0].classList.contains('good')).toBeTrue();
    expect(rows[0].querySelector('.pct')?.textContent?.trim()).toBe('+20%');
  });
});
