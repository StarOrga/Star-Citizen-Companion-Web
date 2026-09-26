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
  const start = spyOn(document, 'startViewTransition').and.callFake(((cb: () => Promise<unknown>) => {
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
  let navigate: jasmine.Spy;
  let el: HTMLElement;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([])] });
    svc = TestBed.inject(SetArsenalTransition);
    router = TestBed.inject(Router);
    navigate = spyOn(router, 'navigateByUrl').and.resolveTo(true);
    el = document.createElement('div');
  });

  const target = () => router.createUrlTree(['/codex', 'fps'], { queryParams: { slot: 'Legs' } });
  const name = () => el.style.getPropertyValue('view-transition-name');

  it('only navigates when there is nothing to morph from', async () => {
    const start = spyOn(document, 'startViewTransition').and.callThrough();
    const tree = target();
    await expectAsync(svc.hop(tree, { slot: 'legs', direction: 'toArsenal' }, null)).toBeResolvedTo(true);
    expect(navigate).toHaveBeenCalledOnceWith(tree);
    expect(start).not.toHaveBeenCalled();
  });

  it('names the source for the old page, hands the name to the destination for the new one, and clears it when done', async () => {
    if (reducedMotion()) {
      pending('reduced motion navigates without a transition');
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
    expect(svc.isLandingOn('legs', 'toArsenal')).toBeTrue();
    expect(svc.isLandingOn('legs', 'toSet')).toBeFalse();
    expect(svc.isLandingOn('core', 'toArsenal')).toBeFalse();
    await expectAsync(hop).toBeResolvedTo(true);
    expect(navigate).toHaveBeenCalledOnceWith(tree);

    // The new page is captured after its first render.
    TestBed.inject(ApplicationRef).tick();
    await update;

    await fake.finish();
    expect(svc.active()).toBeNull();
    expect(svc.isLandingOn('legs', 'toArsenal')).toBeFalse();
  });

  it('treats a second click while the page is still changing as the same hop', async () => {
    if (reducedMotion()) {
      pending('reduced motion navigates without a transition');
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

  it('still changes the page, silently, when the browser skips the transition', async () => {
    if (reducedMotion()) {
      pending('reduced motion navigates without a transition');
      return;
    }
    // The rejected ready / updateCallbackDone would fail this spec as unhandled.
    const fake = fakeTransition({ skipped: true });
    const hop = svc.hop(target(), { slot: 'core', direction: 'toSet' }, el);
    void fake.runUpdate();
    await expectAsync(hop).toBeResolvedTo(true);
    await fake.finish();
    expect(svc.active()).toBeNull();
    expect(name()).toBe('');
  });

  it('falls back to the plain navigation when the transition cannot start', async () => {
    if (reducedMotion()) {
      pending('reduced motion navigates without a transition');
      return;
    }
    spyOn(document, 'startViewTransition').and.throwError(new DOMException('not now', 'InvalidStateError'));
    await expectAsync(svc.hop(target(), { slot: 'arms', direction: 'toArsenal' }, el)).toBeResolvedTo(true);
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(name()).toBe('');
  });

  it('hands a failed navigation to the ErrorHandler instead of rejecting', async () => {
    const boom = new Error('chunk failed');
    navigate.and.rejectWith(boom);
    const report = spyOn(TestBed.inject(ErrorHandler), 'handleError');
    await expectAsync(svc.hop(target(), { slot: 'legs', direction: 'toArsenal' }, null)).toBeResolvedTo(false);
    expect(report).toHaveBeenCalledOnceWith(boom);
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
  it('morphs the source into the destination and leaves no name behind', async () => {
    if (typeof document.startViewTransition !== 'function' || document.visibilityState !== 'visible' || reducedMotion()) {
      pending('needs a visible page, the View Transition API and motion');
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
    const start = spyOn(document, 'startViewTransition').and.callThrough();
    const landed = svc.hop(router.parseUrl('/to'), { slot: 'legs', direction: 'toArsenal' }, source);
    const transition = start.calls.mostRecent().returnValue as ViewTransition;

    // Rejects when the browser skipped the transition (duplicate name, update timeout).
    await transition.ready;
    // A paired group (old AND new named) is the only kind the browser moves and resizes.
    const pseudo = document.getAnimations().map((a) => (a.effect as KeyframeEffect | null)?.pseudoElement);
    expect(pseudo).toContain(`::view-transition-group(${SET_SLOT_TRANSITION_NAME})`);
    expect(pseudo).toContain(`::view-transition-old(${SET_SLOT_TRANSITION_NAME})`);
    expect(pseudo).toContain(`::view-transition-new(${SET_SLOT_TRANSITION_NAME})`);
    await expectAsync(landed).toBeResolvedTo(true);
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
