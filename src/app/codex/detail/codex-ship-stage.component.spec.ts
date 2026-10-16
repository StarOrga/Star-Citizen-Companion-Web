import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexShipStageComponent } from './codex-ship-stage.component';
import { StageCountChip } from './codex-detail.types';

describe('CodexShipStageComponent', () => {
  let fixture: ComponentFixture<CodexShipStageComponent>;

  const stageCounts: StageCountChip[] = [
    { group: 'weapons', count: 3, labelKey: 'codex.moduleSection.weapons', detailKey: null, detailCount: 0 },
    { group: 'remoteTurrets', count: 1, labelKey: 'codex.detail.stageTractorBeam', detailKey: null, detailCount: 0 },
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
    expect(foot.querySelector('.stage-counts')).toBeTruthy();
    expect(foot.querySelector('.ls-count')?.textContent?.trim()).toBe('3');
    // Two chips of the same block (a turret census split into tractor beams) both render.
    expect(foot.querySelectorAll('.ls-item').length).toBe(2);
    // #239: the hangar control left the picture; nothing on the art is a link.
    expect(el.querySelector('sc-hangar-picker')).toBeNull();
    expect(el.querySelector('.stage-art a, .stage-foot a, .stage-ident a')).toBeNull();
    // 'role' is dropped from the chip list — it already lives in the eyebrow.
    const chips = Array.from(el.querySelectorAll('.hchip')).map((c) => c.textContent?.trim());
    expect(chips).toEqual(['2 Crew']);
  });

  it('puts the eyebrow above the name at the top of the stage, not in the foot (#239)', () => {
    const el: HTMLElement = fixture.nativeElement;
    const ident = el.querySelector('.stage-ident') as HTMLElement;
    expect(ident).toBeTruthy();
    expect(ident.closest('.stage-foot')).toBeNull();
    const kids = Array.from(ident.children).map((c) => c.tagName.toLowerCase());
    expect(kids).toEqual(['p', 'h1']);
    expect(ident.querySelector('.mfr')?.textContent?.trim()).toBe('Drake Interplanetary · Multi-role');
    expect(ident.querySelector('h1')?.textContent?.trim()).toBe('Cutlass Black');
  });

  it('gives every figure the same treatment — no category is tinted on its own (#239)', () => {
    const counts = Array.from(fixture.nativeElement.querySelectorAll('.ls-count')) as HTMLElement[];
    const colours = new Set(counts.map((c) => getComputedStyle(c).color));
    expect(colours.size).toBe(1);
    const borders = new Set(
      (Array.from(fixture.nativeElement.querySelectorAll('.ls-item')) as HTMLElement[]).map(
        (c) => getComputedStyle(c).borderTopColor,
      ),
    );
    expect(borders.size).toBe(1);
  });

  it('sets the 3 and the D of the switch on one baseline (#239)', () => {
    fixture.componentRef.setInput('has3dView', true);
    fixture.detectChanges();
    const label = fixture.nativeElement.querySelector('.view-switch .vs-label') as HTMLElement;
    expect(label).toBeTruthy();
    const num = label.querySelector('.vs-num') as HTMLElement;
    const letter = label.querySelector('.vs-letter') as HTMLElement;
    // Both glyphs are inline runs of one line box, so their bottoms meet.
    expect(getComputedStyle(num).display).toBe('inline');
    expect(getComputedStyle(letter).display).toBe('inline');
    expect(getComputedStyle(letter).fontSize).toBe(getComputedStyle(num).fontSize);
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
});
