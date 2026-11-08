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
    expect(service.focused()).toBe(true);
    const seen: boolean[] = [];
    const off = service.onChange((f) => seen.push(f));
    window.dispatchEvent(new Event('blur'));
    expect(service.focused()).toBe(false);
    expect(root.classList.contains('sc-unfocused')).toBe(true);
    window.dispatchEvent(new Event('blur'));
    expect(seen, 'a repeat changes nothing').toEqual([false]);
    window.dispatchEvent(new Event('focus'));
    expect(root.classList.contains('sc-unfocused')).toBe(false);
    expect(seen).toEqual([false, true]);
    off();
    window.dispatchEvent(new Event('blur'));
    expect(seen.length, 'unsubscribed').toBe(2);
  });

  it('focus moving into an embedded frame does not count as leaving', () => {
    const frame = document.body.appendChild(document.createElement('iframe'));
    frame.focus();
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(frame);
    window.dispatchEvent(new Event('blur'));
    expect(service.focused()).toBe(true);
    frame.remove();
  });
});
