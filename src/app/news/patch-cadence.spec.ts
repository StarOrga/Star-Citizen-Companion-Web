import { ComponentFixture, TestBed, discardPeriodicTasks, fakeAsync, tick } from '@angular/core/testing';
import { TranslateModule } from '@ngx-translate/core';

import { PatchCadenceComponent } from './patch-cadence.component';
import { VerseNewsItem } from './news.service';
import { groupPatchNotes } from './patch-notes';
import type { PatchKpi } from './patch-stats';

/**
 * Rotation etiquette + the window/forecast follow-up of the cadence panel.
 *
 * The admin asked for a panel that "sich alle x Sekunden abwechselt". A carousel
 * that cannot be stopped is the exact thing users hate about carousels, so the
 * rules that make it bearable — reduced motion, hover, focus, an explicit pick —
 * are worth a test each: they are all invisible when they work and only notice-
 * able when they regress. The panel now also owns a six-months-vs-all-time
 * toggle and a forecast slide, so those get the same treatment.
 */

/** Matches ROTATE_MS in the component; a tick past one full turn. */
const ROTATE_MS = 7000;

function item(id: string, title: string, publishedAt: string): VerseNewsItem {
  return {
    id,
    title,
    url: `https://robertsspaceindustries.com/spectrum/community/SC/forum/1/thread/${id}`,
    publishedAt,
    channel: 'patch',
    source: 'patch-notes',
  };
}

// Two shipped lines plus a 4.10 still in the PTU: enough for all three duration
// KPIs AND a forecast, so the carousel carries four slides
// (leadTime, cadence, subCadence, forecast).
const RICH = groupPatchNotes([
  item('p48-ptu', '[All Waves] Star Citizen Alpha 4.8 PTU Patch Notes 11900000', '2026-05-01T00:00:00.000Z'),
  item('p48-live', 'Star Citizen Alpha 4.8 LIVE Release Notes', '2026-05-13T00:00:00.000Z'),
  item('p49-ptu', '[All Waves] Star Citizen Alpha 4.9 PTU Patch Notes 12218630', '2026-07-01T00:00:00.000Z'),
  item('p49-live', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-15T00:00:00.000Z'),
  item('p410-ptu', '[Wave 1] Star Citizen Alpha 4.10 PTU Patch Notes 12358556', '2026-07-30T00:00:00.000Z'),
]);

// A single shipped line: one leadTime point, nothing to space apart and nothing
// to forecast → exactly one slide.
const ONE = groupPatchNotes([
  item('p49-ptu', '[All Waves] Star Citizen Alpha 4.9 PTU Patch Notes 12218630', '2026-07-01T00:00:00.000Z'),
  item('p49-live', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2026-07-15T00:00:00.000Z'),
]);

// The same shape as RICH but years in the past: every measurement predates the
// six-month window, so the default view is empty while all-time is full.
const STALE = groupPatchNotes([
  item('o48-ptu', '[All Waves] Star Citizen Alpha 4.8 PTU Patch Notes 11900000', '2020-05-01T00:00:00.000Z'),
  item('o48-live', 'Star Citizen Alpha 4.8 LIVE Release Notes', '2020-05-13T00:00:00.000Z'),
  item('o49-ptu', '[All Waves] Star Citizen Alpha 4.9 PTU Patch Notes 12218630', '2020-07-01T00:00:00.000Z'),
  item('o49-live', 'Star Citizen Alpha 4.9 LIVE Release Notes', '2020-07-15T00:00:00.000Z'),
]);

/** A bare PatchKpi for the pure delta-tone check. */
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

describe('PatchCadenceComponent — rotation, window and forecast', () => {
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

  /** Build the panel and pin the window so the slide set is date-independent. */
  function setup(
    groups = RICH,
    win: 'all' | '6m' = 'all',
  ): ComponentFixture<PatchCadenceComponent> {
    const f = TestBed.createComponent(PatchCadenceComponent);
    f.componentRef.setInput('groups', groups);
    f.componentInstance.window.set(win);
    f.detectChanges();
    return f;
  }

  /** The identity of the current slide — a KPI key, or `forecast`. */
  function currentKey(f: ComponentFixture<PatchCadenceComponent>): string | null {
    const slide = f.componentInstance.current();
    return slide ? f.componentInstance.slideKey(slide) : null;
  }

  it('advances through the charts and the forecast, then wraps', fakeAsync(() => {
    const f = setup();
    expect(currentKey(f)).toBe('leadTime');

    tick(ROTATE_MS);
    f.detectChanges();
    expect(currentKey(f)).toBe('cadence');

    tick(ROTATE_MS);
    f.detectChanges();
    expect(currentKey(f)).toBe('subCadence');

    tick(ROTATE_MS);
    f.detectChanges();
    expect(currentKey(f)).withContext('the forecast is the fourth slide').toBe('forecast');

    // Wraps rather than stopping on the last slide.
    tick(ROTATE_MS);
    f.detectChanges();
    expect(currentKey(f)).toBe('leadTime');

    discardPeriodicTasks();
  }));

  it('never auto-advances under prefers-reduced-motion, but keeps every slide reachable', fakeAsync(() => {
    reduced = true;
    const f = setup();

    tick(ROTATE_MS * 4);
    f.detectChanges();
    expect(currentKey(f)).withContext('reduced motion holds the first slide').toBe('leadTime');

    expect(f.componentInstance.hasSlides()).toBeTrue();
    expect(f.componentInstance.canAutoRotate())
      .withContext('no pause button, because nothing is running')
      .toBeFalse();
    expect(f.nativeElement.querySelectorAll('.dot').length).toBe(4);

    // The dots are the only way to the forecast here.
    f.componentInstance.show(3);
    f.detectChanges();
    expect(currentKey(f)).toBe('forecast');

    discardPeriodicTasks();
  }));

  it('holds the current slide while the panel is hovered or focused', fakeAsync(() => {
    const f = setup();
    const c = f.componentInstance;

    c.hovered.set(true);
    f.detectChanges();
    tick(ROTATE_MS * 2);
    f.detectChanges();
    expect(currentKey(f)).withContext('a hovered chart is being read').toBe('leadTime');

    c.hovered.set(false);
    c.focused.set(true);
    f.detectChanges();
    tick(ROTATE_MS * 2);
    f.detectChanges();
    expect(currentKey(f)).withContext('keyboard focus holds it too').toBe('leadTime');

    c.focused.set(false);
    f.detectChanges();
    tick(ROTATE_MS);
    f.detectChanges();
    expect(currentKey(f)).toBe('cadence');

    discardPeriodicTasks();
  }));

  it('stops rotating for good once a dot is picked — an explicit choice outranks a timer', fakeAsync(() => {
    const f = setup();
    const c = f.componentInstance;

    c.show(1);
    f.detectChanges();
    expect(currentKey(f)).toBe('cadence');
    expect(c.paused()).toBeTrue();

    tick(ROTATE_MS * 3);
    f.detectChanges();
    expect(currentKey(f)).withContext('the pick sticks').toBe('cadence');

    c.togglePause();
    f.detectChanges();
    tick(ROTATE_MS);
    f.detectChanges();
    expect(currentKey(f)).toBe('subCadence');

    discardPeriodicTasks();
  }));

  it('shows no dots and never rotates with a single slide, but keeps the window toggle', fakeAsync(() => {
    const f = setup(ONE);

    expect(f.componentInstance.hasSlides()).toBeFalse();
    expect(f.nativeElement.querySelectorAll('.dot').length).toBe(0);
    // The toggle is reachable even when there is nothing to page through.
    expect(f.nativeElement.querySelectorAll('.win-opt').length).toBe(2);

    tick(ROTATE_MS * 2);
    f.detectChanges();
    expect(currentKey(f)).toBe('leadTime');

    discardPeriodicTasks();
  }));

  it('clamps to the first slide when the list shrinks under it', () => {
    const f = setup();
    f.componentInstance.show(3);
    f.detectChanges();
    expect(currentKey(f)).toBe('forecast');

    // A feed refresh can collapse the panel down to a single slide.
    f.componentRef.setInput('groups', ONE);
    f.detectChanges();
    expect(currentKey(f)).withContext('never strands the panel on nothing').toBe('leadTime');
  });

  it('renders nothing at all when there is no data to show', () => {
    const f = setup([]);
    expect(f.componentInstance.current()).toBeNull();
    expect(f.nativeElement.querySelector('.cadence')).toBeNull();
  });

  it('defaults to six months and switches the whole panel to all-time', () => {
    const f = setup(RICH, '6m');
    expect(f.componentInstance.window()).toBe('6m');

    f.componentInstance.setWindow('all');
    f.detectChanges();
    expect(f.componentInstance.window()).toBe('all');
    // Switching re-scopes to the first slide rather than clamping onto a dropped one.
    expect(currentKey(f)).toBe('leadTime');
  });

  it('keeps the toggle reachable when the six-month window is empty but all-time is not', () => {
    // Everything in STALE predates the window, so the default view is blank.
    const f = setup(STALE, '6m');
    expect(f.componentInstance.current()).withContext('nothing recent to show').toBeNull();
    // The panel still renders — with its empty hint and, crucially, the toggle.
    expect(f.nativeElement.querySelector('.cadence')).not.toBeNull();
    expect(f.nativeElement.querySelector('.cad-empty')).not.toBeNull();
    expect(f.nativeElement.querySelectorAll('.win-opt').length).toBe(2);

    // One click on "all time" brings the history back.
    f.componentInstance.setWindow('all');
    f.detectChanges();
    expect(currentKey(f)).toBe('leadTime');
  });

  it('grades a faster-than-median duration as good and a slower one as bad', () => {
    const f = setup();
    const c = f.componentInstance;

    // The median is 10 in the fixtures: 6 days lead time is 4 better than usual.
    expect(c.deltaTone(kpi('leadTime', 6))).toBe('good');
    expect(c.deltaTone(kpi('cadence', 30))).toBe('bad');
    expect(c.deltaTone(kpi('subCadence', 4))).toBe('good');
    expect(c.deltaTone(kpi('subCadence', 10))).toBe('neutral');
  });
});
