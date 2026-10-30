import { TestBed } from '@angular/core/testing';
import { ToastStackService } from './toast-stack';

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
});
