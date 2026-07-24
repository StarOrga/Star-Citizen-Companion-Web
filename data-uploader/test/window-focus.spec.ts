import { describe, it, expect } from 'vitest';
import { raiseWindow, type RaisableWindow } from '../src/lib/window-focus.js';

/** A fake window that records the order of the calls `raiseWindow` makes. */
function fakeWindow(overrides: Partial<RaisableWindow> = {}): {
  win: RaisableWindow;
  calls: string[];
} {
  const calls: string[] = [];
  const win: RaisableWindow = {
    isDestroyed: () => false,
    isMinimized: () => false,
    restore: () => void calls.push('restore'),
    show: () => void calls.push('show'),
    focus: () => void calls.push('focus'),
    setAlwaysOnTop: (flag: boolean) => void calls.push(`setAlwaysOnTop:${flag}`),
    ...overrides,
  };
  return { win, calls };
}

describe('raiseWindow', () => {
  it('pins topmost, shows, focuses, then unpins — in that order', () => {
    const { win, calls } = fakeWindow();
    raiseWindow(win);
    // The always-on-top pin must wrap show()+focus(): that is what forces the
    // window to the front of the z-order when the browser holds the OS
    // foreground lock right after the OAuth handoff.
    expect(calls).toEqual(['setAlwaysOnTop:true', 'show', 'focus', 'setAlwaysOnTop:false']);
  });

  it('restores a minimized window before raising it', () => {
    const { win, calls } = fakeWindow({ isMinimized: () => true });
    raiseWindow(win);
    expect(calls[0]).toBe('restore');
    expect(calls).toEqual(['restore', 'setAlwaysOnTop:true', 'show', 'focus', 'setAlwaysOnTop:false']);
  });

  it('does not restore a window that is not minimized', () => {
    const { win, calls } = fakeWindow();
    raiseWindow(win);
    expect(calls).not.toContain('restore');
  });

  it('is a no-op for a null window', () => {
    expect(() => raiseWindow(null)).not.toThrow();
  });

  it('is a no-op for a destroyed window (never touches it)', () => {
    const { win, calls } = fakeWindow({ isDestroyed: () => true });
    raiseWindow(win);
    expect(calls).toEqual([]);
  });

  it('always drops the topmost pin even if focus() throws', () => {
    const calls: string[] = [];
    const win: RaisableWindow = {
      isDestroyed: () => false,
      isMinimized: () => false,
      restore: () => void calls.push('restore'),
      show: () => void calls.push('show'),
      focus: () => {
        calls.push('focus');
        throw new Error('focus glitched');
      },
      setAlwaysOnTop: (flag: boolean) => void calls.push(`setAlwaysOnTop:${flag}`),
    };
    // The pin MUST be released so the window is never left stuck above everything.
    expect(() => raiseWindow(win)).toThrow('focus glitched');
    expect(calls).toContain('setAlwaysOnTop:false');
    expect(calls[calls.length - 1]).toBe('setAlwaysOnTop:false');
  });
});
