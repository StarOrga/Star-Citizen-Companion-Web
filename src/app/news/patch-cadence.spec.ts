import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { PatchCadenceComponent } from './patch-cadence.component';
import type { PatchKpi } from './patch-stats';

/**
 * Rotation etiquette of the cadence panel (feedback 44e90e30 follow-up).
 *
 * The admin asked for a panel that "sich alle x Sekunden abwechselt". A carousel
 * that cannot be stopped is the exact thing users hate about carousels, so the
 * rules that make it bearable — reduced motion, hover, focus, an explicit pick —
 * are worth a test each: they are all invisible when they work and only notice-
 * able when they regress.
 */

/** Matches ROTATE_MS in the component; a tick past one full turn. */
const ROTATE_MS = 7000;

function kpi(key: PatchKpi['key'], latest: number): PatchKpi {
  return {
    key,
    latest,
    median: 10,
    samples: 4,
    points: [
      { label: '4.8', value: 8, at: '2026-05-01T00:00:00Z' },
      { label: '4.9', value: latest, at: '2026-06-01T00:00:00Z' },
    ],
  };
}

const THREE: PatchKpi[] = [kpi('leadTime', 6), kpi('cadence', 30), kpi('subCadence', 12)];

describe('PatchCadenceComponent — the rotating patch-performance panel (44e90e30)', () => {
  let reduced: boolean;

  beforeEach(() => {
    reduced = false;
    // Stubbed before the component is built: the constructor reads the query
    // once and subscribes to it, and Karma's own preference must not decide
    // whether these tests exercise the rotation.
    spyOn(window, 'matchMedia').and.callFake(
      (query: string) =>
        ({
          matches: query.includes('prefers-reduced-motion') ? reduced : false,
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
          addListener: () => {},
          removeListener: () => {},
          onchange: null,
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    );

    TestBed.configureTestingModule({
      imports: [PatchCadenceComponent, TranslateModule.forRoot()],
    });
  });

  function setup(kpis: PatchKpi[] = THREE): ComponentFixture<PatchCadenceComponent> {
    const f = TestBed.createComponent(PatchCadenceComponent);
    f.componentRef.setInput('kpis', kpis);
    f.detectChanges();
    return f;
  }

  it('advances to the next KPI on its own', fakeAsync(() => {
    const f = setup();
    expect(f.componentInstance.current()?.key).toBe('leadTime');

    tick(ROTATE_MS);
    f.detectChanges();
    expect(f.componentInstance.current()?.key).toBe('cadence');

    tick(ROTATE_MS);
    f.detectChanges();
    expect(f.componentInstance.current()?.key).toBe('subCadence');

    // Wraps rather than stopping on the last slide.
    tick(ROTATE_MS);
    f.detectChanges();
    expect(f.componentInstance.current()?.key).toBe('leadTime');

    discardPeriodicTasks();
  }));

  it('never auto-advances under prefers-reduced-motion, but keeps every slide reachable', fakeAsync(() => {
    reduced = true;
    const f = setup();

    tick(ROTATE_MS * 3);
    f.detectChanges();
    expect(f.componentInstance.current()?.key)
      .withContext('reduced motion holds the first slide')
      .toBe('leadTime');

    // The dots are the only way to slides 2 and 3 here — gating them on the
    // rotation would delete two thirds of the content for these users.
    expect(f.componentInstance.hasSlides()).toBeTrue();
    expect(f.componentInstance.canAutoRotate())
      .withContext('no pause button, because nothing is running')
      .toBeFalse();
    expect(f.nativeElement.querySelectorAll('.dot').length).toBe(3);

    f.componentInstance.show(2);
    f.detectChanges();
    expect(f.componentInstance.current()?.key).toBe('subCadence');

    discardPeriodicTasks();
  }));

  it('holds the current slide while the panel is hovered or focused', fakeAsync(() => {
    const f = setup();
    const c = f.componentInstance;

    c.hovered.set(true);
    f.detectChanges();
    tick(ROTATE_MS * 2);
    f.detectChanges();
    expect(c.current()?.key).withContext('a hovered chart is being read').toBe('leadTime');

    c.hovered.set(false);
    c.focused.set(true);
    f.detectChanges();
    tick(ROTATE_MS * 2);
    f.detectChanges();
    expect(c.current()?.key).withContext('keyboard focus holds it too').toBe('leadTime');

    // Releasing both hands the panel back to the timer.
    c.focused.set(false);
    f.detectChanges();
    tick(ROTATE_MS);
    f.detectChanges();
    expect(c.current()?.key).toBe('cadence');

    discardPeriodicTasks();
  }));

  it('stops rotating for good once a dot is picked — an explicit choice outranks a timer', fakeAsync(() => {
    const f = setup();
    const c = f.componentInstance;

    c.show(1);
    f.detectChanges();
    expect(c.current()?.key).toBe('cadence');
    expect(c.paused()).toBeTrue();

    tick(ROTATE_MS * 3);
    f.detectChanges();
    expect(c.current()?.key).withContext('the pick sticks').toBe('cadence');

    // …and the play button hands the rotation back.
    c.togglePause();
    f.detectChanges();
    tick(ROTATE_MS);
    f.detectChanges();
    expect(c.current()?.key).toBe('subCadence');

    discardPeriodicTasks();
  }));

  it('shows no dots and never rotates with a single KPI', fakeAsync(() => {
    const f = setup([kpi('subCadence', 12)]);

    expect(f.componentInstance.hasSlides()).toBeFalse();
    expect(f.nativeElement.querySelectorAll('.dot').length).toBe(0);

    tick(ROTATE_MS * 2);
    f.detectChanges();
    expect(f.componentInstance.current()?.key).toBe('subCadence');

    discardPeriodicTasks();
  }));

  it('clamps to the last KPI when the list shrinks under it', () => {
    const f = setup();
    f.componentInstance.show(2);
    f.detectChanges();
    expect(f.componentInstance.current()?.key).toBe('subCadence');

    // A feed refresh can drop a KPI (a hotfix thread re-dated a release, say).
    f.componentRef.setInput('kpis', [kpi('leadTime', 12)]);
    f.detectChanges();
    expect(f.componentInstance.current()?.key)
      .withContext('never strands the panel on nothing')
      .toBe('leadTime');
  });

  it('renders nothing at all when there is no KPI to show', () => {
    const f = setup([]);
    expect(f.componentInstance.current()).toBeNull();
    expect(f.nativeElement.querySelector('.cadence')).toBeNull();
  });

  it('grades a faster-than-median duration as good and a slower one as bad', () => {
    const f = setup();
    const c = f.componentInstance;

    // The median is 10 in the fixtures: 6 days lead time is 4 better than usual.
    expect(c.deltaTone(kpi('leadTime', 6))).toBe('good');
    expect(c.deltaTone(kpi('cadence', 30))).toBe('bad');
    // Every KPI is a duration now, so every one of them gets a verdict — the
    // sub-patch cadence included (9c000427).
    expect(c.deltaTone(kpi('subCadence', 4))).toBe('good');
    expect(c.deltaTone(kpi('subCadence', 10))).toBe('neutral');
  });
});
