import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexSetMissionBarComponent } from './codex-set-mission-bar.component';
import { SET_LENSES } from './set-rating';
import { ScTooltipDirective } from '../../shared/tooltip/sc-tooltip.directive';

describe('CodexSetMissionBarComponent', () => {
  let fixture: ComponentFixture<CodexSetMissionBarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodexSetMissionBarComponent],
      providers: [provideTranslateService({})],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexSetMissionBarComponent);
    fixture.componentRef.setInput('lens', 'all');
    fixture.detectChanges();
  });

  function chips(): HTMLButtonElement[] {
    return Array.from(fixture.nativeElement.querySelectorAll('.mission-chip'));
  }

  it('renders one chip per lens, in the fixed SET_LENSES order', () => {
    const cs = chips();
    expect(cs.length).toBe(SET_LENSES.length);
    SET_LENSES.forEach((l, i) => {
      expect(cs[i].disabled).toBe(l.disabled);
    });
  });

  it('emits lensChange on an enabled chip click', () => {
    const emitted: string[] = [];
    fixture.componentInstance.lensChange.subscribe((id) => emitted.push(id));
    const combat = chips()[SET_LENSES.findIndex((l) => l.id === 'combat')];
    combat.click();
    expect(emitted).toEqual(['combat']);
  });

  it('does not emit on a disabled chip and shows its reason as an app tooltip', () => {
    const emitted: string[] = [];
    fixture.componentInstance.lensChange.subscribe((id) => emitted.push(id));
    const stealthIndex = SET_LENSES.findIndex((l) => l.id === 'stealth');
    const stealthChip = chips()[stealthIndex];
    expect(stealthChip.disabled).toBeTrue();
    stealthChip.click();
    expect(emitted).toEqual([]);

    const wrap = fixture.debugElement
      .queryAll(By.directive(ScTooltipDirective))
      .find((de) => de.nativeElement.contains(stealthChip));
    expect(wrap).toBeTruthy();
    expect(wrap!.injector.get(ScTooltipDirective).scTooltip()).toBe('codex.setLens.tip.stealth');
    expect(stealthChip.getAttribute('aria-disabled')).toBe('true');
  });

  it('shows "Linse zurücksetzen" only when a lens is active, and it resets to all', () => {
    expect(fixture.nativeElement.querySelector('.idle-draft')).toBeNull();

    fixture.componentRef.setInput('lens', 'combat');
    fixture.detectChanges();
    const resetBtn = fixture.nativeElement.querySelector('.idle-draft .btn') as HTMLButtonElement;
    expect(resetBtn).toBeTruthy();

    const emitted: string[] = [];
    fixture.componentInstance.lensChange.subscribe((id) => emitted.push(id));
    resetBtn.click();
    expect(emitted).toEqual(['all']);
  });
});
