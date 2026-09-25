import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexShipStageComponent } from './codex-ship-stage.component';
import { StageCountChip } from '../codex-detail.component';

describe('CodexShipStageComponent', () => {
  let fixture: ComponentFixture<CodexShipStageComponent>;

  const stageCounts: StageCountChip[] = [
    { group: 'weapons', count: 3, labelKey: 'codex.moduleSection.weapons', detailKey: null, detailCount: 0 },
  ];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodexShipStageComponent],
      providers: [provideRouter([]), provideTranslateService()],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexShipStageComponent);
    fixture.componentRef.setInput('kind', 'ship');
    fixture.componentRef.setInput('displayName', 'Cutlass Black');
    fixture.componentRef.setInput('heroEyebrow', 'Drake Interplanetary · Multi-role');
    fixture.componentRef.setInput('heroChips', [
      { key: 'role', text: 'Multi-role', accent: false },
      { key: 'crew', text: '2 Crew', accent: false },
    ]);
    fixture.componentRef.setInput('stageCounts', stageCounts);
    fixture.detectChanges();
  });

  it('renders the stage with the name and the module census, with no clickable content on the art itself', () => {
    const el: HTMLElement = fixture.nativeElement;
    const foot = el.querySelector('.stage-foot') as HTMLElement;
    expect(foot).toBeTruthy();
    expect(foot.querySelector('.stage-ident h1')?.textContent?.trim()).toBe('Cutlass Black');
    expect(foot.querySelector('.stage-counts')).toBeTruthy();
    expect(foot.querySelector('.ls-count')?.textContent?.trim()).toBe('3');
    // 'role' is dropped from the chip list — it already lives in the eyebrow.
    const chips = Array.from(el.querySelectorAll('.hchip')).map((c) => c.textContent?.trim());
    expect(chips).toEqual(['2 Crew']);
  });

  it('shows no 2D/3D switch until a 3D model is confirmed available', () => {
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('.view-switch')).toBeNull();
  });

  it('emits viewToggle when the 2D/3D switch is pressed', () => {
    fixture.componentRef.setInput('has3dView', true);
    fixture.detectChanges();
    const spy = jasmine.createSpy('viewToggle');
    fixture.componentInstance.viewToggle.subscribe(spy);
    const btn = fixture.nativeElement.querySelector('.view-switch') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    btn.click();
    expect(spy).toHaveBeenCalled();
  });

  it('emits hangarPick when the hangar picker fires a pick', () => {
    const spy = jasmine.createSpy('hangarPick');
    fixture.componentInstance.hangarPick.subscribe(spy);
    fixture.componentInstance.hangarPick.emit('DRAK_Cutlass_Black');
    expect(spy).toHaveBeenCalledWith('DRAK_Cutlass_Black');
  });
});
