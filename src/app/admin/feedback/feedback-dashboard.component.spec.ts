import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TranslateModule, TranslateService, TranslationObject } from '@ngx-translate/core';
import { FeedbackDashboardComponent } from './feedback-dashboard.component';
import { FeedbackRow, FeedbackStatus, ThreadMap, startOfWeek } from './feedback.types';

/**
 * The progress view after the 2026-09-05 rethink (admin feedback a33ba528).
 *
 * Two things are worth a test here, and they are both about honesty rather than
 * layout. First: the page must not print a number the board's stamps cannot
 * support — an empty week has to render an em dash, never a confident "0 hrs".
 * Second: every key the rewritten template reaches for has to exist in BOTH
 * catalogues, because a missing key does not fail anywhere else — ngx-translate
 * renders the key itself and the page still looks plausible.
 */
describe('FeedbackDashboardComponent (feedback a33ba528)', () => {
  let de: TranslationObject;
  let en: TranslationObject;

  const MONDAY = startOfWeek();
  const DAY = 86_400_000;
  const HOUR = 3_600_000;

  /** A day inside the running week (or, with a negative offset, before it). */
  const at = (days: number, hours = 9): string =>
    new Date(MONDAY + days * DAY + hours * HOUR).toISOString();

  function row(
    id: string,
    status: FeedbackStatus,
    created: string,
    extra: Partial<FeedbackRow> = {},
  ): FeedbackRow {
    return {
      id,
      author_id: 'admin',
      body: `body of ${id}`,
      status,
      ship_ref: null,
      processing_note: null,
      created_at: created,
      updated_at: created,
      shipped_at: null,
      processed_at: null,
      author: null,
      ...extra,
    };
  }

  beforeAll(async () => {
    de = await (await fetch('/i18n/de.json')).json();
    en = await (await fetch('/i18n/en.json')).json();
  });

  function render(rows: FeedbackRow[], threads: ThreadMap = new Map()): ComponentFixture<FeedbackDashboardComponent> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [FeedbackDashboardComponent, TranslateModule.forRoot()],
    });
    const translate = TestBed.inject(TranslateService);
    translate.setTranslation('de', de);
    translate.use('de');

    const fixture = TestBed.createComponent(FeedbackDashboardComponent);
    fixture.componentRef.setInput('rows', rows);
    fixture.componentRef.setInput('threads', threads);
    fixture.detectChanges();
    return fixture;
  }

  const text = (fixture: ComponentFixture<unknown>, selector: string): string =>
    (fixture.nativeElement as HTMLElement).querySelector(selector)?.textContent?.trim() ?? '';

  /** `adminFeedback.dashboard` (or `.stream`) of one catalogue, as a plain map. */
  const block = (cat: TranslationObject, name: 'dashboard' | 'stream'): Record<string, unknown> => {
    const admin = (cat as Record<string, unknown>)['adminFeedback'] as Record<string, unknown>;
    return admin[name] as Record<string, unknown>;
  };

  it('leads with the running week and no longer carries an all-time column', () => {
    const fixture = render([]);
    const host = fixture.nativeElement as HTMLElement;

    // The week block is the first panel on the page.
    expect(host.querySelector('.panel')?.classList).toContain('week');
    expect(host.querySelectorAll('.pulse .cell').length).toBe(3);

    // The retired vanity chrome: an all-time donut whose share moved by a
    // fraction of a percent per week, and its four bars.
    expect(host.querySelector('.donut')).toBeNull();
    expect(host.querySelector('.bars')).toBeNull();
    expect(host.textContent).not.toContain('All-time');
  });

  it('prints an em dash, not a zero, for a week with nothing to measure', () => {
    const fixture = render([]);
    const host = fixture.nativeElement as HTMLElement;

    expect(text(fixture, '.cell[data-cell="median"] .cell-value b')).toBe('—');
    // No delta chip either: there is nothing to compare the missing value to.
    expect(host.querySelector('.cell[data-cell="median"] .delta')).toBeNull();
    expect(host.textContent).not.toContain('NaN');
    expect(text(fixture, '.verdict')).toBe(block(de, 'dashboard')['verdictIdle'] as string);
  });

  it('compares the running week against the previous one', () => {
    // Two ships this week against one last week, and one topic raised today.
    const rows = [
      row('a', 'shipped', at(0), { shipped_at: at(1) }),
      row('b', 'shipped', at(0), { shipped_at: at(2) }),
      row('c', 'shipped', at(-7), { shipped_at: at(-5) }),
      row('d', 'open', at(1)),
    ];
    const fixture = render(rows);

    expect(text(fixture, '.cell[data-cell="shipped"] .cell-value b')).toBe('2');
    expect(text(fixture, '.cell[data-cell="shipped"] .delta')).toBe('▲ 1');
    expect(text(fixture, '.cell[data-cell="raised"] .cell-value b')).toBe('3');
    // 3 raised against 2 shipped — the pile grew, and the verdict says so.
    expect(text(fixture, '.verdict')).toContain('wächst');
  });

  it('keeps the lifecycle map as reference material, collapsed by default', () => {
    const fixture = render([]);
    const details = (fixture.nativeElement as HTMLElement).querySelector('details.flow');
    expect(details).not.toBeNull();
    expect((details as HTMLDetailsElement).open).toBeFalse();
    // …but still rendered, so it stays readable and findable in the page.
    expect(details?.querySelector('.stages')).not.toBeNull();
  });

  it('resolves every dashboard and stream key it renders in BOTH catalogues', () => {
    const fixture = render([row('a', 'shipped', at(0), { shipped_at: at(1) })]);
    const host = fixture.nativeElement as HTMLElement;

    // ngx-translate renders a missing key as the key itself, so an unresolved
    // string is visible in the DOM as a dotted path and nothing else fails.
    expect(host.textContent).not.toMatch(/adminFeedback\.[a-zA-Z.]+/);

    const dashKeys = [
      'weekTitle', 'weekSub', 'shippedLabel', 'raisedLabel', 'medianLabel',
      'prevWeek', 'medianHint', 'medianHintNone', 'shippedAria', 'raisedAria',
      'medianAria', 'verdictDown', 'verdictUp', 'verdictEven', 'verdictIdle',
      'loadTitle', 'loadSub', 'loadWaiting', 'loadWaitingAsk', 'loadWaitingReview',
      'loadWaitingHold', 'loadWaitingNone', 'loadWorking', 'loadWorkingHint',
      'loadTodo', 'loadTodoHint', 'loadTodoAnswered', 'loadTodoContinuation',
      'oldest', 'oldestNone', 'legendRaised', 'legendShipped', 'paceWindow',
      'throughputSub', 'throughputWeek', 'throughputAria', 'lifecycleTeaser',
    ];
    for (const cat of [de, en]) {
      const dash = block(cat, 'dashboard');
      for (const key of dashKeys) {
        expect(typeof dash[key]).withContext(`adminFeedback.dashboard.${key}`).toBe('string');
      }
      expect(typeof block(cat, 'stream')['progressHint']).toBe('string');
    }
  });

  it('keeps the two catalogues in step on the dashboard block', () => {
    const keysOf = (cat: TranslationObject): string[] => Object.keys(block(cat, 'dashboard')).sort();
    expect(keysOf(de)).toEqual(keysOf(en));
  });
});
