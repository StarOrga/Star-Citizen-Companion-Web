import { TestBed } from '@angular/core/testing';
import type { ViewTransitionInfo } from '@angular/router';
import {
  ARM_TTL_MS,
  SET_SLOT_TRANSITION_NAME,
  SetArsenalTransition,
  nameForTransition,
  onSetArsenalViewTransition,
} from './set-arsenal-transition';

describe('SetArsenalTransition', () => {
  let service: SetArsenalTransition;

  beforeEach(() => {
    service = TestBed.inject(SetArsenalTransition);
  });

  afterEach(() => jasmine.clock().uninstall());

  it('hands an armed hop out exactly once', () => {
    service.arm('helmet', 'toArsenal');
    expect(service.consume()).toEqual({ slot: 'helmet', direction: 'toArsenal' });
    expect(service.consume()).toBeNull();
  });

  it('has nothing to hand out when nothing was armed', () => {
    expect(service.consume()).toBeNull();
  });

  it('lets an arm lapse that no navigation picked up in time', () => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 8, 26, 12, 0, 0));
    service.arm('legs', 'toSet');
    jasmine.clock().tick(ARM_TTL_MS + 1);
    expect(service.consume()).toBeNull();
  });

  it('keeps an arm alive inside the window, and the latest arm wins', () => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date(2026, 8, 26, 12, 0, 0));
    service.arm('legs', 'toArsenal');
    service.arm('core', 'toSet');
    jasmine.clock().tick(ARM_TTL_MS - 100);
    expect(service.consume()).toEqual({ slot: 'core', direction: 'toSet' });
  });
});

describe('onSetArsenalViewTransition', () => {
  const info = (): { info: ViewTransitionInfo; skip: jasmine.Spy } => {
    const skip = jasmine.createSpy('skipTransition');
    return { info: { transition: { skipTransition: skip } } as unknown as ViewTransitionInfo, skip };
  };
  const run = (i: ViewTransitionInfo): void =>
    TestBed.runInInjectionContext(() => onSetArsenalViewTransition(i));

  it('skips every navigation that nobody armed', () => {
    const { info: i, skip } = info();
    run(i);
    expect(skip).toHaveBeenCalledTimes(1);
  });

  it('lets the armed hop run, unless motion is unwelcome — and only that one', () => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    TestBed.inject(SetArsenalTransition).arm('arms', 'toArsenal');
    const first = info();
    run(first.info);
    expect(first.skip).toHaveBeenCalledTimes(reduced ? 1 : 0);

    const next = info();
    run(next.info);
    expect(next.skip).toHaveBeenCalledTimes(1);
  });

  it('marks the running hop active for the destination and clears it once the transition is done', async () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      pending('reduced motion skips every transition');
      return;
    }
    const svc = TestBed.inject(SetArsenalTransition);
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => (finish = resolve));
    const skip = jasmine.createSpy('skipTransition');
    svc.arm('legs', 'toArsenal');
    run({ transition: { skipTransition: skip, finished } } as unknown as ViewTransitionInfo);

    expect(skip).not.toHaveBeenCalled();
    expect(svc.active()).toEqual({ slot: 'legs', direction: 'toArsenal' });
    expect(svc.isLandingOn('legs', 'toArsenal')).toBeTrue();
    expect(svc.isLandingOn('legs', 'toSet')).toBeFalse();
    expect(svc.isLandingOn('core', 'toArsenal')).toBeFalse();

    finish();
    await finished;
    await Promise.resolve();
    expect(svc.active()).toBeNull();
    expect(svc.isLandingOn('legs', 'toArsenal')).toBeFalse();
  });

  it('never marks a skipped navigation active', () => {
    const svc = TestBed.inject(SetArsenalTransition);
    const { info: i } = info();
    run(i);
    expect(svc.active()).toBeNull();
  });
});

describe('nameForTransition', () => {
  it('sets and clears the shared name, and ignores a missing element', () => {
    const el = document.createElement('div');
    nameForTransition(el, true);
    expect(el.style.getPropertyValue('view-transition-name')).toBe(SET_SLOT_TRANSITION_NAME);
    nameForTransition(el, false);
    expect(el.style.getPropertyValue('view-transition-name')).toBe('');
    expect(() => nameForTransition(null, true)).not.toThrow();
  });
});
