import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { provideTranslateService } from '@ngx-translate/core';
import { CodexLoadoutSaveBarComponent } from './codex-loadout-save-bar.component';
import { DesktopCapabilityService } from '../core/desktop-capability.service';

/**
 * The concept (§5) draws three parts and the app drew four. These specs pin
 * the three, pin where the fourth went, and pin that a finger can still get
 * the answer the fourth used to give away for free.
 */
function configure(coarsePointer: boolean): void {
  TestBed.configureTestingModule({
    imports: [CodexLoadoutSaveBarComponent],
    providers: [
      provideTranslateService({}),
      {
        provide: DesktopCapabilityService,
        useValue: { hasCoarsePointer: signal(coarsePointer) } as Partial<DesktopCapabilityService>,
      },
    ],
  });
}

describe('CodexLoadoutSaveBarComponent', () => {
  let fixture: ComponentFixture<CodexLoadoutSaveBarComponent>;

  function render(
    inputs: Partial<{ changed: number; saveable: number; inHangar: boolean; saving: boolean }>,
    coarsePointer = false,
  ): HTMLElement {
    TestBed.resetTestingModule();
    configure(coarsePointer);
    fixture = TestBed.createComponent(CodexLoadoutSaveBarComponent);
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

  it('shows the concept’s three parts and no fourth line', () => {
    const el = render({ changed: 3, saveable: 3, inHangar: true });
    expect(el.querySelector('.label')?.textContent).toContain('codex.detail.draftLabel');
    expect(el.querySelector('.chip')?.textContent).toContain('codex.detail.draftChangedPlural');
    expect(el.querySelector('.notice')?.textContent).toContain('codex.detail.draftNotice');
    // The implementation-language sentence is not part of the bar any more.
    expect(el.querySelector('.bar')?.textContent).not.toContain('codex.loadout.changesSummary');
  });

  it('R8: an unsaveable draft says so on the button, not in the bar', () => {
    const el = render({ changed: 3, saveable: 1, inHangar: true });
    const btn = el.querySelector('.save') as HTMLButtonElement;
    expect(btn.getAttribute('title')).toContain('codex.loadout.changesSummary');
    expect(btn.getAttribute('title')).toContain('codex.loadout.unsaveableHint');
    // …and the same sentence is reachable without a hover, via the a11y tree.
    const described = btn.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    const reason = el.querySelector('#' + described) as HTMLElement;
    expect(reason.textContent).toContain('codex.loadout.unsaveableHint');
    expect(reason.classList).toContain('sr-only');
  });

  it('offers "apply & save to hangar" when the ship is not owned yet', () => {
    const el = render({ changed: 1, saveable: 1, inHangar: false });
    const btn = el.querySelector('.save') as HTMLButtonElement;
    expect(btn.textContent?.trim()).toBe('codex.detail.draftApplyAndSave');
  });

  it('a blocked save stays focusable and aria-disabled instead of disabled', () => {
    const el = render({ changed: 2, saveable: 0, inHangar: true });
    const btn = el.querySelector('.save') as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute('aria-disabled')).toBe('true');
  });

  it('does not emit while blocked, whatever the pointer', () => {
    const el = render({ changed: 2, saveable: 0, inHangar: true });
    const saves: void[] = [];
    fixture.componentInstance.save.subscribe(() => saves.push(undefined));
    (el.querySelector('.save') as HTMLButtonElement).click();
    expect(saves.length).toBe(0);
  });

  it('touch: the blocked save is not greyed out and reveals the reason on press', () => {
    const el = render({ changed: 2, saveable: 0, inHangar: true }, true);
    const btn = el.querySelector('.save') as HTMLButtonElement;
    // "statt grau zu machen": no dimming where a tooltip cannot be reached.
    expect(btn.classList).not.toContain('dimmed');
    expect((el.querySelector('.reason') as HTMLElement).classList).toContain('sr-only');
    btn.click();
    fixture.detectChanges();
    const reason = el.querySelector('.reason') as HTMLElement;
    expect(reason.classList).not.toContain('sr-only');
    expect(reason.textContent).toContain('codex.loadout.unsaveableHint');
  });

  it('pointer devices keep the greyed-out look and the tooltip', () => {
    const el = render({ changed: 2, saveable: 0, inHangar: true }, false);
    const btn = el.querySelector('.save') as HTMLButtonElement;
    expect(btn.classList).toContain('dimmed');
    expect(btn.getAttribute('title')).toContain('codex.loadout.unsaveableHint');
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
