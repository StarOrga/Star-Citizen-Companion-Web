import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ScPopoverDismissDirective } from './sc-popover-dismiss.directive';

@Component({
  standalone: true,
  imports: [ScPopoverDismissDirective],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: `
    <span class="wrap" [scPopoverDismiss]="open()" (dismissed)="open.set(false)">
      <button type="button" class="trigger" [attr.aria-expanded]="open()" (click)="open.set(!open())">T</button>
      @if (open()) { <ul class="pop"><li><button type="button" class="item">I</button></li></ul> }
    </span>
    <button type="button" class="outside">O</button>
  `,
})
class HostComponent {
  readonly open = signal(true);
}

describe('ScPopoverDismissDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  const el = <T extends HTMLElement>(sel: string) => fixture.nativeElement.querySelector(sel) as T;

  beforeEach(() => {
    fixture = TestBed.createComponent(HostComponent);
    document.body.appendChild(fixture.nativeElement);
    fixture.detectChanges();
  });
  afterEach(() => fixture.nativeElement.remove());

  it('closes on Escape, resets aria-expanded and refocuses the trigger', () => {
    el('.item').focus();
    el('.item').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    fixture.detectChanges();
    expect(el('.pop')).toBeNull();
    expect(el('.trigger').getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(el('.trigger'));
  });

  it('closes on a press outside, but not inside', () => {
    el('.item').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(el('.pop')).not.toBeNull();
    el('.outside').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    fixture.detectChanges();
    expect(el('.pop')).toBeNull();
    expect(el('.trigger').getAttribute('aria-expanded')).toBe('false');
  });

  it('ignores Escape while closed', () => {
    fixture.componentInstance.open.set(false);
    fixture.detectChanges();
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });
});
