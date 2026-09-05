import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexLoadoutSaveBarComponent } from './codex-loadout-save-bar.component';

describe('CodexLoadoutSaveBarComponent', () => {
  let fixture: ComponentFixture<CodexLoadoutSaveBarComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CodexLoadoutSaveBarComponent],
      providers: [provideTranslateService({})],
    }).compileComponents();
    fixture = TestBed.createComponent(CodexLoadoutSaveBarComponent);
  });

  function render(inputs: Partial<{ changed: number; saveable: number; inHangar: boolean; saving: boolean }>): HTMLElement {
    fixture.componentRef.setInput('changed', inputs.changed ?? 0);
    fixture.componentRef.setInput('saveable', inputs.saveable ?? 0);
    fixture.componentRef.setInput('inHangar', inputs.inHangar ?? true);
    fixture.componentRef.setInput('saving', inputs.saving ?? false);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('renders nothing when the draft has no changes', () => {
    const el = render({ changed: 0, saveable: 0 });
    expect(el.querySelector('.bar')).toBeNull();
  });

  it('R8: shows how many of n changes are actually saveable, with a hint when they differ', () => {
    const el = render({ changed: 3, saveable: 1, inHangar: true });
    expect(el.querySelector('.chip')?.textContent).toContain('codex.detail.draftChangedPlural');
    expect(el.querySelector('.hint')?.textContent).toContain('codex.loadout.unsaveableHint');
  });

  it('offers "apply & save to hangar" when the ship is not owned yet', () => {
    const el = render({ changed: 1, saveable: 1, inHangar: false });
    const btn = el.querySelector('.save') as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe('codex.detail.draftApplyAndSave');
  });

  it('disables save while nothing is saveable', () => {
    const el = render({ changed: 2, saveable: 0, inHangar: true });
    const btn = el.querySelector('.save') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('emits discard/save', () => {
    const el = render({ changed: 1, saveable: 1, inHangar: true });
    const saves: void[] = [];
    const discards: void[] = [];
    fixture.componentInstance.save.subscribe(() => saves.push(undefined));
    fixture.componentInstance.discard.subscribe(() => discards.push(undefined));
    (el.querySelector('.save') as HTMLButtonElement).click();
    (el.querySelector('.discard') as HTMLButtonElement).click();
    expect(saves.length).toBe(1);
    expect(discards.length).toBe(1);
  });
});
