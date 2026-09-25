import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { OverlayContainer } from '@angular/cdk/overlay';
import { ScTooltipDirective } from './sc-tooltip.directive';

@Component({
  standalone: true,
  imports: [ScTooltipDirective],
  template: `
    <button
      type="button"
      class="a"
      aria-label="Add to hangar"
      [scTooltip]="textA()"
      [scTooltipTier]="tierA()"
      [scTooltipDisabled]="disabledA()"
    >
      +
    </button>
    <button type="button" class="b" aria-label="Pin to compare" [scTooltip]="textB()" scTooltipTier="label">★</button>
    <button type="button" class="c" [scTooltip]="'Clear search'">×</button>
  `,
})
class HostCmp {
  readonly textA = signal<string | null>('Add to hangar');
  readonly tierA = signal<'info' | 'label'>('info');
  readonly disabledA = signal(false);
  readonly textB = signal<string | null>('Pin to compare');
}

describe('ScTooltipDirective', () => {
  let fixture: ComponentFixture<HostCmp>;
  let overlayContainer: OverlayContainer;
  let overlayContainerElement: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HostCmp],
    }).compileComponents();
    fixture = TestBed.createComponent(HostCmp);
    // The overlay's flexibleConnectedTo position strategy needs a real, laid
    // out origin (same reasoning as column-menu.component.spec.ts).
    document.body.appendChild(fixture.nativeElement);
    overlayContainer = TestBed.inject(OverlayContainer);
    overlayContainerElement = overlayContainer.getContainerElement();
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.nativeElement.remove();
    overlayContainer.ngOnDestroy();
  });

  function btnA(): HTMLElement {
    return fixture.nativeElement.querySelector('.a') as HTMLElement;
  }
  function btnB(): HTMLElement {
    return fixture.nativeElement.querySelector('.b') as HTMLElement;
  }
  function btnC(): HTMLElement {
    return fixture.nativeElement.querySelector('.c') as HTMLElement;
  }
  function bubble(): HTMLElement | null {
    return overlayContainerElement.querySelector('.sc-tooltip-bubble');
  }
  // The directive listens for hover on the overlay PANE (the node it holds a
  // reference to), not on the inner `.sc-tooltip-bubble` div — real
  // `mouseenter`/`mouseleave` fire on every ancestor the pointer enters/
  // leaves, a behaviour `dispatchEvent` does not replicate for synthetic
  // events, so tests must target the exact listened-on node.
  function pane(): HTMLElement | null {
    return overlayContainerElement.querySelector('.cdk-overlay-pane');
  }
  // The host listens to pointer events (touch is filtered out), the pane to
  // mouse events — a real mouse fires both, so both are sent.
  function hoverIn(el: HTMLElement, pointerType = 'mouse'): void {
    el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, pointerType }));
    if (pointerType !== 'touch') el.dispatchEvent(new MouseEvent('mouseenter', { bubbles: false }));
  }
  function hoverOut(el: HTMLElement): void {
    el.dispatchEvent(new PointerEvent('pointerleave', { bubbles: false, pointerType: 'mouse' }));
    el.dispatchEvent(new MouseEvent('mouseleave', { bubbles: false }));
  }

  it('renders nothing when the tooltip text is empty', fakeAsync(() => {
    const cmp = fixture.componentInstance;
    cmp.textA.set(null);
    fixture.detectChanges();
    hoverIn(btnA());
    tick(2000);
    expect(bubble()).toBeNull();
  }));

  it('Info tier: not open at 1400ms, open at 1500ms', fakeAsync(() => {
    hoverIn(btnA());
    tick(1400);
    expect(bubble()).toBeNull();
    tick(100);
    expect(bubble()).not.toBeNull();
    expect(bubble()!.textContent).toContain('Add to hangar');
  }));

  it('Label tier: opens at 500ms', fakeAsync(() => {
    hoverIn(btnB());
    tick(499);
    expect(bubble()).toBeNull();
    tick(1);
    expect(bubble()).not.toBeNull();
    expect(bubble()!.textContent).toContain('Pin to compare');
  }));

  it('skip delay: a second tooltip opens instantly within 300ms of the first closing', fakeAsync(() => {
    hoverIn(btnA());
    tick(1500);
    expect(bubble()).not.toBeNull();
    hoverOut(btnA());
    tick(150); // hover grace closes it
    expect(bubble()).toBeNull();

    tick(200); // still inside the 300ms skip window
    hoverIn(btnB());
    fixture.detectChanges();
    tick(0);
    expect(bubble()).not.toBeNull();
    expect(bubble()!.textContent).toContain('Pin to compare');
  }));

  it('keyboard (Tab) focus opens instantly; plain mouse focus does not', fakeAsync(() => {
    // Simulate the last-interaction-was-keyboard heuristic the directive
    // tracks itself (see sc-tooltip.directive.ts — real :focus-visible
    // heuristics are not reproducible with synthetic events).
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true }));
    btnA().focus();
    fixture.detectChanges();
    tick(0);
    expect(bubble()).not.toBeNull();
    btnA().blur();
    tick(200);
    expect(bubble()).toBeNull();

    // Plain mouse-driven focus (mousedown resets the modality heuristic to
    // "not keyboard") must NOT open instantly — only after the normal delay.
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    btnA().focus();
    fixture.detectChanges();
    tick(0);
    expect(bubble()).toBeNull();
  }));

  it('Escape closes the tooltip', fakeAsync(() => {
    hoverIn(btnA());
    tick(1500);
    expect(bubble()).not.toBeNull();
    btnA().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    tick(0);
    expect(bubble()).toBeNull();
  }));

  it('hoverable (WCAG 1.4.13): moving the pointer onto the bubble keeps it open', fakeAsync(() => {
    hoverIn(btnA());
    tick(1500);
    const el = bubble();
    expect(el).not.toBeNull();
    hoverOut(btnA());
    tick(100); // inside the grace period
    hoverIn(pane()!);
    tick(200); // would have closed by now if the bubble hover weren't honoured
    expect(bubble()).not.toBeNull();
    hoverOut(pane()!);
    tick(200);
    expect(bubble()).toBeNull();
  }));

  it('sets aria-describedby only when the tooltip text differs from the accessible name', fakeAsync(() => {
    // btnC has no aria-label and no text other than "×" — tooltip text
    // ("Clear search") differs from the accessible name, so describedby IS set.
    hoverIn(btnC());
    tick(1500);
    expect(btnC().getAttribute('aria-describedby')).toBeTruthy();
    hoverOut(btnC());
    tick(200);
    expect(btnC().hasAttribute('aria-describedby')).toBeFalse();

    // btnB's aria-label ("Pin to compare") equals its tooltip text exactly —
    // describedby would read the name twice, so it must stay unset.
    hoverIn(btnB());
    tick(500);
    expect(bubble()).not.toBeNull();
    expect(btnB().hasAttribute('aria-describedby')).toBeFalse();
  }));

  it('never opens from a touch hover — a tap would otherwise show it a moment later', fakeAsync(() => {
    hoverIn(btnB(), 'touch');
    tick(2000);
    expect(bubble()).toBeNull();
  }));

  it('follows a text change while open, and Escape closes a hover-opened tooltip from anywhere', fakeAsync(() => {
    hoverIn(btnB());
    tick(500);
    expect(bubble()?.textContent?.trim()).toBe('Pin to compare');

    fixture.componentInstance.textB.set('Pinned');
    fixture.detectChanges();
    tick(0);
    fixture.detectChanges();
    expect(bubble()?.textContent?.trim()).toBe('Pinned');

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    tick(0);
    expect(bubble()).toBeNull();
  }));

  it('removes its overlay on destroy', fakeAsync(() => {
    hoverIn(btnA());
    tick(1500);
    expect(bubble()).not.toBeNull();
    fixture.destroy();
    tick(0);
    expect(overlayContainerElement.querySelector('.sc-tooltip-bubble')).toBeNull();
  }));
});
