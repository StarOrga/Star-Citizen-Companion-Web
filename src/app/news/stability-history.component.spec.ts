import { TestBed } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';
import { StabilityHistoryComponent } from './stability-history.component';
import { StabilityVerdict } from './patch-stability';

function v(line: string, level: 1 | 2 | 3 | 4 | 5 | null, early = false): StabilityVerdict {
  return {
    line, liveAt: '2026-01-01T00:00:00Z', daysLive: 30, level, score: level === null ? null : level / 5,
    components: { community: 0, service: 0, cig: null }, early, insufficient: level === null, historical: true,
    days: [], tickets: [], kbOpen: null, hotfixes: [],
  };
}

describe('StabilityHistoryComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [StabilityHistoryComponent, TranslateModule.forRoot()] }));

  it('one button column per verdict, hatched when early, emits the line on click', () => {
    const f = TestBed.createComponent(StabilityHistoryComponent);
    f.componentRef.setInput('verdicts', [v('4.8', 4), v('4.9', 2), v('4.10', 3, true)]);
    const emitted: string[] = [];
    f.componentInstance.showLine.subscribe((l) => emitted.push(l));
    f.detectChanges();
    const el = f.nativeElement as HTMLElement;
    const cols = el.querySelectorAll('button.col');
    expect(cols.length).toBe(3);
    expect(cols[2].classList.contains('early')).toBeTrue();
    (cols[0] as HTMLButtonElement).click();
    expect(emitted).toEqual(['4.8']);
  });

  it('renders nothing with fewer than two verdicts', () => {
    const f = TestBed.createComponent(StabilityHistoryComponent);
    f.componentRef.setInput('verdicts', [v('4.10', 3)]);
    f.detectChanges();
    expect((f.nativeElement as HTMLElement).querySelector('.chart')).toBeNull();
  });
});
