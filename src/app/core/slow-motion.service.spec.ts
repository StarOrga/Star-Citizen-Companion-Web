import { TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { SLOW_TICK_MS, SlowMotionService } from './slow-motion.service';
import { WindowFocusService } from './window-focus.service';

describe('SlowMotionService', () => {
  let host: HTMLElement, style: HTMLStyleElement, stop: (() => void) | null;
  let slow: SlowMotionService, focus: WindowFocusService;

  const add = (css: string, tag = 'sc-fusion-bar'): HTMLElement => {
    const scope = document.createElement(tag);
    const el = document.createElement('div');
    el.style.cssText = css;
    scope.appendChild(el);
    host.appendChild(scope);
    return el;
  };
  const only = (el: Element): CSSAnimation => el.getAnimations()[0] as CSSAnimation;

  beforeEach(() => {
    // A spec that ran earlier may have left it: it pauses these animations from the stylesheet.
    document.documentElement.classList.remove('sc-unfocused');
    host = document.body.appendChild(document.createElement('div'));
    style = document.head.appendChild(document.createElement('style'));
    style.textContent = '@keyframes sm-test { to { opacity: 0.5; } }';
    stop = null;
    slow = TestBed.inject(SlowMotionService);
    focus = TestBed.inject(WindowFocusService);
  });

  afterEach(() => {
    stop?.();
    document.documentElement.classList.remove('sc-unfocused');
    host.remove();
    style.remove();
  });

  it('pauses an endless background animation and advances it by the clock', fakeAsync(() => {
    const el = add('animation: sm-test 10s linear infinite');
    stop = slow.start();
    const a = only(el);
    expect(a.playState === 'paused' || a.pending).toBe(true);
    // Its first step ends a pending pause, whose time still follows the real clock.
    // (The step runs in the frame after the timer: one 16 ms frame later.)
    tick(SLOW_TICK_MS + 16);
    const t0 = Number(a.currentTime);
    tick(SLOW_TICK_MS * 3);
    expect(Number(a.currentTime) - t0).toBeCloseTo(SLOW_TICK_MS * 3, -1);
    stop();
    stop = null;
    discardPeriodicTasks();
  }));

  it('leaves finite animations and anything outside the background alone', fakeAsync(() => {
    const finite = add('animation: sm-test 10s linear 3');
    const foreign = add('animation: sm-test 10s linear infinite', 'section');
    stop = slow.start();
    tick(SLOW_TICK_MS);
    expect(only(finite).playState).toBe('running');
    expect(only(foreign).playState).toBe('running');
    stop();
    stop = null;
    discardPeriodicTasks();
  }));

  it('stands still while the CSS holds the animation', fakeAsync(() => {
    const el = add('animation: sm-test 10s linear infinite paused');
    stop = slow.start();
    const t0 = Number(only(el).currentTime);
    tick(SLOW_TICK_MS * 3);
    expect(Number(only(el).currentTime)).toBe(t0);
    stop();
    stop = null;
    discardPeriodicTasks();
  }));

  it('stops without the window focus and takes no jump when it returns', fakeAsync(() => {
    const el = add('animation: sm-test 10s linear infinite');
    stop = slow.start();
    tick(SLOW_TICK_MS);
    const window_ = window;
    window_.dispatchEvent(new Event('blur'));
    expect(focus.focused()).toBe(false);
    const t0 = Number(only(el).currentTime);
    tick(5000);
    expect(Number(only(el).currentTime), 'no focus').toBe(t0);
    window_.dispatchEvent(new Event('focus'));
    tick(SLOW_TICK_MS);
    expect(Number(only(el).currentTime) - t0, 'no jump').toBeLessThan(SLOW_TICK_MS * 2);
    stop();
    stop = null;
    discardPeriodicTasks();
  }));

  it('takes over an animation as soon as it starts', fakeAsync(() => {
    stop = slow.start();
    const el = add('animation: sm-test 10s linear infinite');
    expect(only(el).playState).toBe('running');
    el.dispatchEvent(new AnimationEvent('animationstart', { bubbles: true }));
    expect(only(el).pending || only(el).playState === 'paused').toBe(true);
    stop();
    stop = null;
    discardPeriodicTasks();
  }));

  it('finishes an adopted animation at its end, so its finish handlers run', fakeAsync(() => {
    const el = document.createElement('div');
    host.appendChild(el);
    const a = el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
    const finish = vi.spyOn(a, 'finish');
    stop = slow.start();
    slow.adopt(a);
    tick(SLOW_TICK_MS * 5);
    expect(finish).toHaveBeenCalled();
    stop();
    stop = null;
    discardPeriodicTasks();
  }));

  it('hands the animations back when stopped', fakeAsync(() => {
    const el = add('animation: sm-test 10s linear infinite');
    stop = slow.start();
    tick(SLOW_TICK_MS);
    stop();
    stop = null;
    expect(only(el).playState === 'running' || only(el).pending).toBe(true);
    discardPeriodicTasks();
  }));
});
