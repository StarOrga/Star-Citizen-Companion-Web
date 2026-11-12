import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { armBootSplashFailsafe, dismissBootSplash, SPLASH_FAILSAFE_MS, SPLASH_LEAVE_MS } from './boot-splash';

function mount(stageOpacity: string): HTMLElement {
  const splash = document.createElement('div');
  splash.className = 'scb';
  const stage = document.createElement('div');
  stage.className = 'scb-stage';
  stage.style.opacity = stageOpacity;
  splash.appendChild(stage);
  document.body.appendChild(splash);
  return splash;
}

describe('boot splash', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    document.querySelectorAll('.scb').forEach((n) => n.remove());
  });

  it('is a no-op without a splash', () => {
    expect(() => dismissBootSplash()).not.toThrow();
  });

  it('removes the splash at once while its elements were never visible', () => {
    mount('0');
    dismissBootSplash();
    expect(document.querySelector('.scb')).toBeNull();
  });

  it('leaves with the exit class when the elements were visible, then removes it', () => {
    const splash = mount('1');
    dismissBootSplash();
    expect(splash.classList.contains('scb-leave')).toBe(true);
    expect(document.querySelector('.scb')).not.toBeNull();
    vi.advanceTimersByTime(SPLASH_LEAVE_MS + 300);
    expect(document.querySelector('.scb')).toBeNull();
  });

  it('removes on transitionend of the splash itself', () => {
    const splash = mount('1');
    dismissBootSplash();
    splash.dispatchEvent(new Event('transitionend'));
    expect(document.querySelector('.scb')).toBeNull();
  });

  it('failsafe removes a splash nobody dismissed', () => {
    mount('1');
    armBootSplashFailsafe();
    vi.advanceTimersByTime(SPLASH_FAILSAFE_MS + 1);
    expect(document.querySelector('.scb')).toBeNull();
  });
});
