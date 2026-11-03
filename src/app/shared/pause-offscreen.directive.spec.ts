import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { OFFSCREEN_ATTR, PauseOffscreenDirective } from './pause-offscreen.directive';

@Component({
  standalone: true,
  imports: [PauseOffscreenDirective],
  template: `<div scPauseOffscreen class="box" style="position: fixed; left: 0; width: 40px; height: 40px" [style.top.px]="top()"></div>`,
})
class HostComponent {
  readonly top = signal(0);
}

/** Waits (up to 1 s) until the observer delivered the expected state. */
async function settle(el: HTMLElement, offscreen: boolean): Promise<void> {
  for (let i = 0; i < 50 && el.hasAttribute(OFFSCREEN_ATTR) !== offscreen; i++) await new Promise((r) => setTimeout(r, 20));
}

describe('PauseOffscreenDirective', () => {
  it('marks its host only while it is completely out of view', async () => {
    const fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
    const box = (fixture.nativeElement as HTMLElement).querySelector('.box') as HTMLElement;
    await settle(box, false);
    expect(box.hasAttribute(OFFSCREEN_ATTR)).toBeFalse();

    fixture.componentInstance.top.set(-10000);
    fixture.detectChanges();
    await settle(box, true);
    expect(box.hasAttribute(OFFSCREEN_ATTR)).toBeTrue();

    fixture.componentInstance.top.set(10);
    fixture.detectChanges();
    await settle(box, false);
    expect(box.hasAttribute(OFFSCREEN_ATTR)).toBeFalse();
    fixture.destroy();
  });
});
