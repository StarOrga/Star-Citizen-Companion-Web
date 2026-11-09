import { TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { ToastSlotDirective, ToastStackService, toastLeaveMs } from './toast-stack';

describe('ToastStackService', () => {
  it('stacks later toasts above earlier ones and closes the gap on removal', () => {
    const svc = TestBed.inject(ToastStackService);
    const a = Symbol('a');
    const b = Symbol('b');
    svc.add(a);
    svc.setHeight(a, 60);
    svc.add(b);
    svc.setHeight(b, 40);
    expect(svc.offset(a)()).toBe(0);
    expect(svc.offset(b)()).toBe(60 + ToastStackService.GAP_PX);
    svc.remove(a);
    expect(svc.offset(b)()).toBe(0);
    svc.remove(b);
  });

  it('keeps the slot of a closing toast until its leave animation is over', async () => {
    @Component({
      standalone: true,
      imports: [ToastSlotDirective],
      // Both in blocks: their slots register in template order (the older toast lowest).
      template: `@if (a()) { <div scToastSlot style="height:50px"></div> } @if (b()) { <div scToastSlot id="b" style="height:30px"></div> }`,
    })
    class Host {
      readonly a = signal(true);
      readonly b = signal(true);
    }
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    const b = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('#b')!;
    // The heights arrive through the ResizeObserver after layout.
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(b.style.getPropertyValue('--sc-toast-offset')).toBe(`${50 + ToastStackService.GAP_PX}px`);
    });
    fixture.componentInstance.a.set(false);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r, 60));
    fixture.detectChanges();
    expect(b.style.getPropertyValue('--sc-toast-offset')).toBe(`${50 + ToastStackService.GAP_PX}px`);
    await new Promise((r) => setTimeout(r, toastLeaveMs(false) + 40));
    fixture.detectChanges();
    expect(b.style.getPropertyValue('--sc-toast-offset')).toBe('0px');
  });
});
