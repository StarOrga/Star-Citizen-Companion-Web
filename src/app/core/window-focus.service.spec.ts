import { TestBed } from '@angular/core/testing';
import { WindowFocusService } from './window-focus.service';

describe('WindowFocusService', () => {
  const root = document.documentElement;
  let service: WindowFocusService;

  beforeEach(() => {
    service = TestBed.inject(WindowFocusService);
  });

  afterEach(() => {
    window.dispatchEvent(new Event('focus'));
    root.classList.remove('sc-unfocused');
  });

  it('starts focused and follows the window, class and listeners alike', () => {
    expect(service.focused()).toBeTrue();
    const seen: boolean[] = [];
    const off = service.onChange((f) => seen.push(f));
    window.dispatchEvent(new Event('blur'));
    expect(service.focused()).toBeFalse();
    expect(root.classList.contains('sc-unfocused')).toBeTrue();
    window.dispatchEvent(new Event('blur'));
    expect(seen).withContext('a repeat changes nothing').toEqual([false]);
    window.dispatchEvent(new Event('focus'));
    expect(root.classList.contains('sc-unfocused')).toBeFalse();
    expect(seen).toEqual([false, true]);
    off();
    window.dispatchEvent(new Event('blur'));
    expect(seen.length).withContext('unsubscribed').toBe(2);
  });

  it('focus moving into an embedded frame does not count as leaving', () => {
    const frame = document.body.appendChild(document.createElement('iframe'));
    frame.focus();
    spyOnProperty(document, 'activeElement').and.returnValue(frame);
    window.dispatchEvent(new Event('blur'));
    expect(service.focused()).toBeTrue();
    frame.remove();
  });
});
