import type { Mock } from 'vitest';
import { ApplicationRef, Component, ErrorHandler, inject } from '@angular/core';
import { ComponentFixtureAutoDetect, TestBed } from '@angular/core/testing';
import { Router, RouterOutlet, provideRouter } from '@angular/router';
import { SET_SLOT_TRANSITION_NAME, SetArsenalTransition, nameForTransition } from './set-arsenal-transition';

const reducedMotion = (): boolean => matchMedia('(prefers-reduced-motion: reduce)').matches;

/** A stand-in for the browser's transition: the test decides when the update callback runs and when it ends. */
function fakeTransition(opts: { skipped?: boolean } = {}) {
  let update: (() => Promise<unknown>) | null = null;
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  const aborted = () => Promise.reject(new DOMException('Transition was skipped', 'AbortError'));
  const transition = {
    ready: opts.skipped ? aborted() : Promise.resolve(),
    updateCallbackDone: opts.skipped ? aborted() : Promise.resolve(),
    finished,
    skipTransition: () => undefined,
  };
  const start = vi.spyOn(document, 'startViewTransition').mockImplementation(((cb: () => Promise<unknown>) => {
    update = cb;
    return transition;
  }) as never);
  return {
    start,
    /** What the browser does once the old page is captured. */
    runUpdate: (): Promise<unknown> => update!(),
    finish: async () => {
      finish();
      await finished;
      await Promise.resolve();
    },
  };
}

describe('SetArsenalTransition', () => {
  let svc: SetArsenalTransition;
  let router: Router;
  let navigate: Mock;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    svc = TestBed.inject(SetArsenalTransition);
    router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    el = document.createElement('div');
  });

  const target = () => router.createUrlTree(['/codex', 'fps'], { queryParams: { slot: 'Legs' } });
  const name = () => el.style.getPropertyValue('view-transition-name');

  it('only navigates when there is nothing to morph from', async () => {
    const start = vi.spyOn(document, 'startViewTransition');
    const tree = target();
    await expect(svc.hop(tree, { slot: 'legs', direction: 'toArsenal' }, null)).resolves.toEqual(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(tree);
    expect(start).not.toHaveBeenCalled();
  });

  it('names the source for the old page, hands the name to the destination for the new one, and clears it when done', async ({ skip }) => {
    if (reducedMotion()) {
      skip('reduced motion navigates without a transition');
      return;
    }
    const fake = fakeTransition();
    const tree = target();
    const hop = svc.hop(tree, { slot: 'legs', direction: 'toArsenal' }, el);
    // Before the browser has captured the old page: only the source is named.
    expect(fake.start).toHaveBeenCalledTimes(1);
    expect(name()).toBe(SET_SLOT_TRANSITION_NAME);
    expect(svc.active()).toBeNull();
    expect(navigate).not.toHaveBeenCalled();
    // Old page captured: the page changes, the destination takes the name.
    const update = fake.runUpdate();
    expect(name()).toBe('');
    expect(svc.isLandingOn('legs', 'toArsenal')).toBe(true);
    expect(svc.isLandingOn('legs', 'toSet')).toBe(false);
    expect(svc.isLandingOn('core', 'toArsenal')).toBe(false);
    await expect(hop).resolves.toEqual(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(tree);
    // The new page is captured after its first render.
    TestBed.inject(ApplicationRef).tick();
    await update;
    await fake.finish();
    expect(svc.active()).toBeNull();
    expect(svc.isLandingOn('legs', 'toArsenal')).toBe(false);
  });

  it('treats a second click while the page is still changing as the same hop', async ({ skip }) => {
    if (reducedMotion()) {
      skip('reduced motion navigates without a transition');
      return;
    }
    const fake = fakeTransition();
    const first = svc.hop(target(), { slot: 'legs', direction: 'toArsenal' }, el);
    const second = svc.hop(target(), { slot: 'legs', direction: 'toArsenal' }, el);
    expect(second).toBe(first);
    expect(fake.start).toHaveBeenCalledTimes(1);
    void fake.runUpdate();
    await first;
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it('still changes the page, silently, when the browser skips the transition', async ({ skip }) => {
    if (reducedMotion()) {
      skip('reduced motion navigates without a transition');
      return;
    }
    // The rejected ready / updateCallbackDone would fail this spec as unhandled.
    const fake = fakeTransition({ skipped: true });
    const hop = svc.hop(target(), { slot: 'core', direction: 'toSet' }, el);
    void fake.runUpdate();
    await expect(hop).resolves.toEqual(true);
    await fake.finish();
    expect(svc.active()).toBeNull();
    expect(name()).toBe('');
  });

  it('falls back to the plain navigation when the transition cannot start', async ({ skip }) => {
    if (reducedMotion()) {
      skip('reduced motion navigates without a transition');
      return;
    }
    vi.spyOn(document, 'startViewTransition').mockImplementation(() => {
      throw new DOMException('not now', 'InvalidStateError');
    });
    await expect(svc.hop(target(), { slot: 'arms', direction: 'toArsenal' }, el)).resolves.toEqual(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(name()).toBe('');
  });

  it('hands a failed navigation to the ErrorHandler instead of rejecting', async () => {
    const boom = new Error('chunk failed');
    navigate.mockRejectedValue(boom);
    const report = vi.spyOn(TestBed.inject(ErrorHandler), 'handleError').mockReturnValue(undefined as never);
    await expect(svc.hop(target(), { slot: 'legs', direction: 'toArsenal' }, null)).resolves.toEqual(false);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenCalledWith(boom);
  });

  // REQ-5 (AUD-203, AUD-287): reduced motion is forced here, so the case runs on
  // every machine — the pending() branches above only cover the opposite setting.
  it('only navigates under prefers-reduced-motion, even with a source to morph from', async () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('prefers-reduced-motion: reduce'),
      media: query,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      onchange: null,
    })) as unknown as typeof window.matchMedia;
    try {
      const start = vi.spyOn(document, 'startViewTransition');
      const tree = target();
      await expect(svc.hop(tree, { slot: 'legs', direction: 'toArsenal' }, el)).resolves.toEqual(true);
      expect(navigate).toHaveBeenCalledTimes(1);
      expect(navigate).toHaveBeenCalledWith(tree);
      expect(start).not.toHaveBeenCalled();
      expect(name()).toBe('');
      expect(svc.active()).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });

  it('leaves active() empty on an ordinary navigation', async () => {
    navigate.mockRestore();
    router.resetConfig([{ path: 'codex', component: FromPage }]);
    await expect(router.navigateByUrl('/codex')).resolves.toEqual(true);
    expect(svc.active()).toBeNull();
    expect(svc.isLandingOn('legs', 'toArsenal')).toBe(false);
  });
});

@Component({ template: '<div class="from-tile" style="display: block; width: 120px; height: 32px"></div>' })
class FromPage {}

@Component({
  template: `<div
    class="to-band"
    style="display: block; width: 480px; height: 96px"
    [style.view-transition-name]="transition.isLandingOn('legs', 'toArsenal') ? name : null"
  ></div>`,
})
class ToPage {
  readonly transition = inject(SetArsenalTransition);
  readonly name = SET_SLOT_TRANSITION_NAME;
}

@Component({ imports: [RouterOutlet], template: '<router-outlet />' })
class Shell {}

describe('SetArsenalTransition in a real browser transition', () => {
  it('morphs the source into the destination and leaves no name behind', async ({ skip }) => {
    if (typeof document.startViewTransition !== 'function' || document.visibilityState !== 'visible' || reducedMotion()) {
      skip('needs a visible page, the View Transition API and motion');
      return;
    }
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'from', component: FromPage },
          { path: 'to', component: ToPage },
        ]),
        { provide: ComponentFixtureAutoDetect, useValue: true },
      ],
    });
    const fixture = TestBed.createComponent(Shell);
    const router = TestBed.inject(Router);
    await router.navigateByUrl('/from');
    await fixture.whenStable();
    const host: HTMLElement = fixture.nativeElement;
    const source = host.querySelector<HTMLElement>('.from-tile')!;
    expect(source).toBeTruthy();
    const svc = TestBed.inject(SetArsenalTransition);
    const start = vi.spyOn(document, 'startViewTransition');
    const landed = svc.hop(router.parseUrl('/to'), { slot: 'legs', direction: 'toArsenal' }, source);
    const transition = vi.mocked(start).mock.results.at(-1)?.value as ViewTransition;
    // Rejects when the browser skipped the transition (duplicate name, update timeout).
    await transition.ready;
    // A paired group (old AND new named) is the only kind the browser moves and resizes.
    const pseudo = document.getAnimations().map((a) => (a.effect as KeyframeEffect | null)?.pseudoElement);
    expect(pseudo).toContain(`::view-transition-group(${SET_SLOT_TRANSITION_NAME})`);
    expect(pseudo).toContain(`::view-transition-old(${SET_SLOT_TRANSITION_NAME})`);
    expect(pseudo).toContain(`::view-transition-new(${SET_SLOT_TRANSITION_NAME})`);
    await expect(landed).resolves.toEqual(true);
    expect(host.querySelector('.to-band')).toBeTruthy();
    await transition.finished;
    await Promise.resolve();
    fixture.detectChanges();
    expect(svc.active()).toBeNull();
    expect(host.querySelector<HTMLElement>('.to-band')!.style.getPropertyValue('view-transition-name')).toBe('');
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
