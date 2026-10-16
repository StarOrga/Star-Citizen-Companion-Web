import { TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexHardpointLayoutComponent, LayoutSection, LayoutSlot } from './codex-hardpoint-layout.component';
import { CodexSwapCandidatesService, SwapSourceQuery } from './codex-swap-candidates.service';

// #244: the loadout view warms the swap picker's lists of the slots it can
// swap — and lets go of the preload queue when it is destroyed.

class SwapSourceStub {
  readonly preloads: SwapSourceQuery[][] = [];
  holders = 0;
  released = 0;
  preload(queries: readonly SwapSourceQuery[]): void {
    this.preloads.push([...queries]);
  }
  retainPreload(): () => void {
    this.holders += 1;
    return () => {
      this.released += 1;
    };
  }
}

function slot(className: string | null, size: number): LayoutSlot {
  return { port: 'Hardpoint', className, kind: className ? 'weapon' : null, name: className, size, grade: null, manufacturerCode: null };
}

describe('CodexHardpointLayoutComponent — swap list preload (#244)', () => {
  it('preloads the fitted slots of swappable sections and releases the queue on destroy', async () => {
    const stub = new SwapSourceStub();
    await TestBed.configureTestingModule({
      imports: [CodexHardpointLayoutComponent],
      providers: [provideTranslateService({}), { provide: CodexSwapCandidatesService, useValue: stub }],
    }).compileComponents();
    const fixture = TestBed.createComponent(CodexHardpointLayoutComponent);
    const sections: LayoutSection[] = [
      { section: 'weapons', slots: [slot('GUN_S3', 3), slot(null, 3)] },
      { section: 'structure', slots: [slot('HULL', 1)] },
    ];
    fixture.componentRef.setInput('sections', sections);
    fixture.detectChanges();
    await fixture.whenStable();

    expect(stub.holders).toBe(1);
    expect(stub.preloads).toEqual([[{ installed: 'GUN_S3', types: [], size: 3 }]]);

    fixture.destroy();
    expect(stub.released).toBe(1);
  });
});
